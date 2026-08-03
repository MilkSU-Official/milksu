package ctf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
	"github.com/google/uuid"
)

const (
	TrainingMemorySchemaVersion = "ctf-memory.milksu.dev/v1alpha3"

	// SupportedCTFMemoryDatabaseVersion is the numbered SQLite migration
	// version recorded in schema_migrations. It is independent of
	// TrainingMemorySchemaVersion, which describes serialized memory records.
	SupportedCTFMemoryDatabaseVersion = 1

	ctfMemoryV1MigrationName = "create CTF memory store"
)

type TrainingMemoryVerification string

const (
	TrainingMemoryJudgeVerified   TrainingMemoryVerification = "judge-verified"
	TrainingMemoryUserConfirmed   TrainingMemoryVerification = "user-confirmed"
	TrainingMemoryFailureObserved TrainingMemoryVerification = "failure-observed"
	TrainingMemoryLegacyUntyped   TrainingMemoryVerification = "legacy-untyped"
)

var (
	memoryFlagPattern      = regexp.MustCompile(`(?i)\b(?:flag|nssctf|ctf)\{[^}\r\n]{1,512}\}`)
	memoryAPIKeyPattern    = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{12,}\b`)
	memoryBearerPattern    = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}`)
	memoryURLSecretPattern = regexp.MustCompile(`(?i)([?&](?:token|key|secret|auth)=)[^&#\s]+`)
)

type TrainingMemory struct {
	ID              string                     `json:"id"`
	SchemaVersion   string                     `json:"schemaVersion"`
	Kind            string                     `json:"kind"`
	Verification    TrainingMemoryVerification `json:"verification"`
	Actor           LearningActor              `json:"actor"`
	Assistance      LearningAssistance         `json:"assistance"`
	Title           string                     `json:"title"`
	Summary         string                     `json:"summary"`
	Category        string                     `json:"category"`
	Tags            []string                   `json:"tags"`
	SourceJobID     string                     `json:"sourceJobId"`
	SourceSessionID string                     `json:"sourceSessionId,omitempty"`
	EvidenceRefs    []string                   `json:"evidenceRefs"`
	Confidence      float64                    `json:"confidence"`
	Path            string                     `json:"path"`
	CreatedAt       time.Time                  `json:"createdAt"`
	UpdatedAt       time.Time                  `json:"updatedAt"`
	ArchivedAt      time.Time                  `json:"archivedAt,omitempty"`
	ArchivedReason  string                     `json:"archivedReason,omitempty"`
	Recall          *TrainingMemoryRecall      `json:"recall,omitempty"`
}

type TrainingMemoryRecallContext struct {
	Category        string
	Title           string
	KnowledgePoints []string
	SourceJobID     string
}

type TrainingMemoryRecall struct {
	SchemaVersion string                       `json:"schemaVersion"`
	Score         float64                      `json:"score"`
	Reasons       []string                     `json:"reasons"`
	Evidence      []TrainingMemoryEvidenceLink `json:"evidence"`
}

type TrainingMemoryEvidenceLink struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Label string `json:"label"`
}

type MemoryStore struct {
	database  *sql.DB
	directory string
}

func NewMemoryStore(databasePath, directory string) (*MemoryStore, error) {
	if strings.TrimSpace(databasePath) == "" || strings.TrimSpace(directory) == "" {
		return nil, fmt.Errorf("CTF memory database path and directory are required")
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		return nil, fmt.Errorf("create CTF memory database directory: %w", err)
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create CTF memory directory: %w", err)
	}
	migrator, err := sqlitemigrate.Open(
		databasePath,
		[]sqlitemigrate.Migration{{
			Version: 1,
			Name:    ctfMemoryV1MigrationName,
			Up:      ctfMemoryV1Up,
		}},
		sqlitemigrate.WithPragmas([]string{
			"PRAGMA journal_mode = WAL",
			"PRAGMA foreign_keys = ON",
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("open CTF memory database: %w", err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		migrator.Close()
		return nil, fmt.Errorf("migrate CTF memory database: %w", err)
	}
	return &MemoryStore{database: migrator.DB(), directory: directory}, nil
}

// ctfMemoryV1Up creates the current memory schema and upgrades the one
// pre-migrator legacy shape that lacked verification. The ALTER, conservative
// confidence downgrade, indexes, and migration-history row all share the
// transaction owned by sqlitemigrate.
func ctfMemoryV1Up(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS ctf_memories (
	id TEXT PRIMARY KEY,
	schema_version TEXT NOT NULL,
	kind TEXT NOT NULL,
	verification TEXT NOT NULL DEFAULT 'legacy-untyped',
	title TEXT NOT NULL,
	summary TEXT NOT NULL,
	category TEXT NOT NULL,
	tags_json TEXT NOT NULL,
	source_job_id TEXT NOT NULL UNIQUE,
	source_session_id TEXT,
	evidence_refs_json TEXT NOT NULL,
	confidence REAL NOT NULL,
	path TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	archived_at TEXT,
	archived_reason TEXT
)`); err != nil {
		return fmt.Errorf("create CTF memory table: %w", err)
	}

	addedVerification, err := ensureTrainingMemoryVerificationColumn(ctx, tx)
	if err != nil {
		return fmt.Errorf("migrate CTF memory verification column: %w", err)
	}
	if addedVerification {
		if _, err := tx.ExecContext(ctx, `
UPDATE ctf_memories
SET verification = 'legacy-untyped',
	confidence = CASE WHEN confidence > 0.6 THEN 0.6 ELSE confidence END
`); err != nil {
			return fmt.Errorf("downgrade untyped legacy CTF memory confidence: %w", err)
		}
	}

	for _, statement := range []string{
		`CREATE INDEX IF NOT EXISTS idx_ctf_memories_category
			ON ctf_memories(category, archived_at, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_ctf_memories_source
			ON ctf_memories(source_job_id)`,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create CTF memory index: %w", err)
		}
	}
	return nil
}

func ensureTrainingMemoryVerificationColumn(
	ctx context.Context,
	tx *sql.Tx,
) (bool, error) {
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(ctf_memories)`)
	if err != nil {
		return false, err
	}
	found := false
	for rows.Next() {
		var (
			position     int
			name         string
			columnType   string
			notNull      int
			defaultValue sql.NullString
			primaryKey   int
		)
		if err := rows.Scan(
			&position,
			&name,
			&columnType,
			&notNull,
			&defaultValue,
			&primaryKey,
		); err != nil {
			rows.Close()
			return false, err
		}
		if name == "verification" {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, err
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	if found {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx, `
ALTER TABLE ctf_memories
ADD COLUMN verification TEXT NOT NULL DEFAULT 'legacy-untyped'
`); err != nil {
		return false, err
	}
	return true, nil
}

func (s *MemoryStore) Close() error {
	if s == nil || s.database == nil {
		return nil
	}
	return s.database.Close()
}

func (s *MemoryStore) SaveFromProjection(
	ctx context.Context,
	projection Projection,
	sourceSessionID string,
	now time.Time,
) (TrainingMemory, error) {
	if projection.Job.ID == "" || projection.Challenge.ID == "" {
		return TrainingMemory{}, fmt.Errorf("CTF memory source projection is incomplete")
	}
	if projection.Debrief.Status == "" || projection.Debrief.Status == "in_progress" {
		return TrainingMemory{}, fmt.Errorf("题目尚未结束；先取得 Judge 结果或结束本次尝试，再沉淀为记忆")
	}
	normalizedLearning := make([]LearningRecord, 0, len(projection.Learning))
	hasUserReflection := false
	for _, record := range projection.Learning {
		normalized, valid := normalizeLearningAttribution(
			record,
			projection.Challenge.CollaborationMode,
		)
		if !valid {
			return TrainingMemory{}, fmt.Errorf("CTF memory source has invalid learning attribution")
		}
		normalizedLearning = append(normalizedLearning, normalized)
		if normalized.Kind == "reflection" &&
			normalized.Actor == LearningActorUser {
			hasUserReflection = true
		}
	}
	if !hasUserReflection {
		return TrainingMemory{}, fmt.Errorf("先用自己的话完成一次复盘，再沉淀为记忆")
	}
	projection.Learning = normalizedLearning
	contribution := contributionForProjection(
		projection.Challenge.CollaborationMode,
		projection.Learning,
		len(projection.AgentRuns) > 0 || len(projection.AgentCandidates) > 0,
	)
	projection.HumanOutcome.Contribution = contribution
	projection.HumanOutcome.IndependentSteps = contribution.UserIndependentSteps
	now = now.UTC()
	memoryID := ""
	createdAt := now
	path := ""
	var existingCreated string
	err := s.database.QueryRowContext(
		ctx,
		`SELECT id, path, created_at FROM ctf_memories WHERE source_job_id = ?`,
		projection.Job.ID,
	).Scan(&memoryID, &path, &existingCreated)
	if err != nil && err != sql.ErrNoRows {
		return TrainingMemory{}, fmt.Errorf("find existing CTF memory: %w", err)
	}
	if err == sql.ErrNoRows {
		memoryID = "ctfmem_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		path = filepath.Join(s.directory, memoryID+".md")
	} else if parsed, parseErr := time.Parse(time.RFC3339Nano, existingCreated); parseErr == nil {
		createdAt = parsed
	}

	kind := "technique"
	verification, confidence := classifyTrainingMemory(projection)
	if projection.Debrief.Status != "succeeded" {
		kind = "failure-lesson"
	}
	candidates := memoryCandidateSecrets(projection)
	redact := func(value string) string {
		return redactMemoryText(value, candidates)
	}
	summary := redact(strings.TrimSpace(projection.Debrief.Summary))
	if summary == "" {
		summary = redact(strings.TrimSpace(projection.HumanOutcome.Summary))
	}
	if summary == "" {
		summary = "本次训练留下了可复用观察与失败分支。"
	}
	title := redact(fmt.Sprintf("[%s] %s", projection.Challenge.Category, projection.Challenge.Title))
	tags := normalizeMemoryValues(projection.Challenge.KnowledgePoints, 24, 80)
	evidenceRefs := []string{"job:" + projection.Job.ID}
	if value := strings.TrimSpace(sourceSessionID); value != "" {
		evidenceRefs = append(evidenceRefs, "session:"+value)
	}
	for _, run := range projection.AgentRuns {
		if value := strings.TrimSpace(run.TrajectoryArtifactID); value != "" {
			evidenceRefs = append(evidenceRefs, "trajectory:"+value)
		}
	}
	for _, receipt := range projection.JudgeReceipts {
		if value := strings.TrimSpace(receipt.Reference); value != "" {
			evidenceRefs = append(evidenceRefs, "judge:"+redact(value))
		}
	}
	for _, record := range projection.Learning {
		switch record.Kind {
		case "hint":
			if value := learningRecordReference(record); value != "" {
				evidenceRefs = append(evidenceRefs, "hint:"+redact(value))
			}
		case "independent_step":
			if value := learningRecordReference(record); value != "" {
				evidenceRefs = append(evidenceRefs, "step:"+redact(value))
			}
		}
	}
	for index, branch := range projection.Debrief.FailureBranches {
		if value := strings.TrimSpace(redact(branch)); value != "" {
			evidenceRefs = append(
				evidenceRefs,
				fmt.Sprintf("failure:%02d:%s", index+1, truncateRunes(value, 160)),
			)
		}
	}
	evidenceRefs = normalizeMemoryValues(evidenceRefs, 32, 240)
	memory := TrainingMemory{
		ID:              memoryID,
		SchemaVersion:   TrainingMemorySchemaVersion,
		Kind:            kind,
		Verification:    verification,
		Actor:           contribution.PrimaryActor,
		Assistance:      contribution.Assistance,
		Title:           title,
		Summary:         truncateRunes(summary, 1200),
		Category:        strings.ToLower(strings.TrimSpace(projection.Challenge.Category)),
		Tags:            tags,
		SourceJobID:     projection.Job.ID,
		SourceSessionID: strings.TrimSpace(sourceSessionID),
		EvidenceRefs:    evidenceRefs,
		Confidence:      confidence,
		Path:            path,
		CreatedAt:       createdAt,
		UpdatedAt:       now,
	}
	markdown := renderTrainingMemory(memory, projection, redact)
	if err := atomicWrite(path, []byte(markdown), 0o600); err != nil {
		return TrainingMemory{}, fmt.Errorf("write CTF memory file: %w", err)
	}
	tagsJSON, _ := json.Marshal(memory.Tags)
	refsJSON, _ := json.Marshal(memory.EvidenceRefs)
	_, err = s.database.ExecContext(
		ctx,
		`INSERT INTO ctf_memories (
			id, schema_version, kind, verification, title, summary, category, tags_json,
			source_job_id, source_session_id, evidence_refs_json, confidence,
			path, created_at, updated_at, archived_at, archived_reason
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
		ON CONFLICT(source_job_id) DO UPDATE SET
			schema_version=excluded.schema_version,
			kind=excluded.kind,
			verification=excluded.verification,
			title=excluded.title,
			summary=excluded.summary,
			category=excluded.category,
			tags_json=excluded.tags_json,
			source_session_id=excluded.source_session_id,
			evidence_refs_json=excluded.evidence_refs_json,
			confidence=excluded.confidence,
			path=excluded.path,
			updated_at=excluded.updated_at,
			archived_at=NULL,
			archived_reason=NULL`,
		memory.ID,
		memory.SchemaVersion,
		memory.Kind,
		memory.Verification,
		memory.Title,
		memory.Summary,
		memory.Category,
		string(tagsJSON),
		memory.SourceJobID,
		memory.SourceSessionID,
		string(refsJSON),
		memory.Confidence,
		memory.Path,
		memory.CreatedAt.Format(time.RFC3339Nano),
		memory.UpdatedAt.Format(time.RFC3339Nano),
	)
	if err != nil {
		return TrainingMemory{}, fmt.Errorf("register CTF memory: %w", err)
	}
	return memory, nil
}

func (s *MemoryStore) Recall(
	ctx context.Context,
	category string,
	query string,
	limit int,
) ([]TrainingMemory, error) {
	if limit <= 0 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}
	category = strings.ToLower(strings.TrimSpace(category))
	query = strings.ToLower(strings.TrimSpace(query))
	queryPattern := "%"
	if query != "" {
		queryPattern = "%" + query + "%"
	}
	rows, err := s.database.QueryContext(
		ctx,
		`SELECT id, schema_version, kind, verification, title, summary, category, tags_json,
			source_job_id, COALESCE(source_session_id, ''), evidence_refs_json,
			confidence, path, created_at, updated_at,
			COALESCE(archived_at, ''), COALESCE(archived_reason, '')
		FROM ctf_memories
		WHERE archived_at IS NULL
			AND (? = '' OR lower(category) = ?)
			AND (? = '' OR lower(title || ' ' || summary || ' ' || tags_json) LIKE ?)
		ORDER BY confidence DESC, updated_at DESC
		LIMIT ?`,
		category,
		category,
		query,
		queryPattern,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("recall CTF memories: %w", err)
	}
	defer rows.Close()
	memories := make([]TrainingMemory, 0, limit)
	for rows.Next() {
		memory, scanErr := scanTrainingMemory(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		memories = append(memories, memory)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan CTF memories: %w", err)
	}
	return memories, nil
}

// RecallForChallenge keeps retrieval local and explainable. Category is the
// primary partition; title and knowledge-point overlap only re-rank that
// bounded candidate set. A job never recalls its own synthesis.
func (s *MemoryStore) RecallForChallenge(
	ctx context.Context,
	recall TrainingMemoryRecallContext,
	limit int,
) ([]TrainingMemory, error) {
	if limit <= 0 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}
	candidates, err := s.Recall(ctx, recall.Category, "", 20)
	if err != nil {
		return nil, err
	}
	keywords := memoryRecallKeywords(
		append([]string{recall.Title}, recall.KnowledgePoints...),
	)
	type scoredMemory struct {
		memory  TrainingMemory
		score   float64
		reasons []string
	}
	scored := make([]scoredMemory, 0, len(candidates))
	for _, memory := range candidates {
		if memory.SourceJobID == strings.TrimSpace(recall.SourceJobID) {
			continue
		}
		haystack := strings.ToLower(strings.Join(
			append([]string{memory.Title, memory.Summary}, memory.Tags...),
			" ",
		))
		score := memory.Confidence * 10
		reasons := []string{
			fmt.Sprintf("验证等级：%s", trainingMemoryVerificationLabel(memory.Verification)),
		}
		for _, keyword := range keywords {
			if strings.Contains(haystack, keyword) {
				score += 3
				reasons = append(reasons, "匹配当前题关键词："+keyword)
			}
			for _, tag := range memory.Tags {
				if strings.EqualFold(strings.TrimSpace(tag), keyword) {
					score += 3
					reasons = append(reasons, "匹配旧题标签："+tag)
					break
				}
			}
		}
		if memory.Kind == "failure-lesson" {
			score += 0.25
			reasons = append(reasons, "包含失败分支，可用于避免重复走错路")
		}
		scored = append(scored, scoredMemory{
			memory:  memory,
			score:   score,
			reasons: normalizeMemoryValues(reasons, 8, 120),
		})
	}
	sort.SliceStable(scored, func(left, right int) bool {
		if scored[left].score == scored[right].score {
			return scored[left].memory.UpdatedAt.After(scored[right].memory.UpdatedAt)
		}
		return scored[left].score > scored[right].score
	})
	if len(scored) > limit {
		scored = scored[:limit]
	}
	result := make([]TrainingMemory, 0, len(scored))
	for _, item := range scored {
		memory := item.memory
		memory.Recall = &TrainingMemoryRecall{
			SchemaVersion: "ctf-memory-recall.milksu.dev/v1alpha1",
			Score:         item.score,
			Reasons:       item.reasons,
			Evidence:      trainingMemoryEvidenceLinks(memory.EvidenceRefs),
		}
		result = append(result, memory)
	}
	return result, nil
}

func (s *MemoryStore) Archive(ctx context.Context, id, reason string, now time.Time) error {
	id = strings.TrimSpace(id)
	reason = strings.TrimSpace(reason)
	if id == "" || reason == "" {
		return fmt.Errorf("CTF memory id and archive reason are required")
	}
	result, err := s.database.ExecContext(
		ctx,
		`UPDATE ctf_memories SET archived_at=?, archived_reason=?, updated_at=?
		 WHERE id=? AND archived_at IS NULL`,
		now.UTC().Format(time.RFC3339Nano),
		reason,
		now.UTC().Format(time.RFC3339Nano),
		id,
	)
	if err != nil {
		return fmt.Errorf("archive CTF memory: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		return fmt.Errorf("active CTF memory not found")
	}
	return nil
}

func WriteAgentMemoryContext(workspacePath string, memories []TrainingMemory) error {
	var builder strings.Builder
	builder.WriteString("# 可复用训练记忆\n\n")
	builder.WriteString("这些是过去训练中由用户明确保存的经验缓存，不是当前题目的事实或最终答案。")
	builder.WriteString("每条记忆分别标注正确性证据和实际贡献归属；Agent 代做不会变成用户能力事实。")
	builder.WriteString("使用前必须用当前题面、附件和实验重新验证；不要复制过去的 Flag 或秘密。\n")
	if len(memories) == 0 {
		builder.WriteString("\n当前没有匹配本题分类的已保存记忆。\n")
	} else {
		for _, memory := range memories {
			builder.WriteString("\n## ")
			builder.WriteString(memory.Title)
			builder.WriteString("\n\n")
			builder.WriteString(memory.Summary)
			builder.WriteString("\n\n- 类型：")
			builder.WriteString(memory.Kind)
			builder.WriteString("\n- 验证等级：")
			builder.WriteString(trainingMemoryVerificationLabel(memory.Verification))
			builder.WriteString("\n- 主要贡献：")
			builder.WriteString(learningActorLabel(memory.Actor))
			builder.WriteString("\n- 协助方式：")
			builder.WriteString(learningAssistanceLabel(memory.Assistance))
			builder.WriteString("\n- 置信度：")
			builder.WriteString(fmt.Sprintf("%.2f", memory.Confidence))
			builder.WriteString("\n- 标签：")
			builder.WriteString(strings.Join(memory.Tags, "、"))
			builder.WriteString("\n- 来源：")
			builder.WriteString(memory.SourceJobID)
			if memory.Recall != nil && len(memory.Recall.Reasons) > 0 {
				builder.WriteString("\n- 推荐原因：")
				builder.WriteString(strings.Join(memory.Recall.Reasons, "；"))
			}
			if memory.Recall != nil && len(memory.Recall.Evidence) > 0 {
				builder.WriteString("\n- 可核对证据：")
				labels := make([]string, 0, len(memory.Recall.Evidence))
				for _, evidence := range memory.Recall.Evidence {
					labels = append(labels, evidence.Label)
				}
				builder.WriteString(strings.Join(labels, "；"))
			}
			builder.WriteString("\n")
		}
	}
	return atomicWrite(
		filepath.Join(workspacePath, "MEMORY.md"),
		[]byte(builder.String()),
		0o600,
	)
}

func learningRecordReference(record LearningRecord) string {
	if value := strings.TrimSpace(record.ID); value != "" {
		return value
	}
	if value := strings.TrimSpace(record.Concept); value != "" {
		if record.Level > 0 {
			return fmt.Sprintf("%s@level-%d", value, record.Level)
		}
		return value
	}
	return truncateRunes(strings.TrimSpace(record.Content), 120)
}

func trainingMemoryEvidenceLinks(refs []string) []TrainingMemoryEvidenceLink {
	links := make([]TrainingMemoryEvidenceLink, 0, len(refs))
	for _, ref := range refs {
		kind, id, ok := strings.Cut(strings.TrimSpace(ref), ":")
		if !ok {
			continue
		}
		kind = strings.TrimSpace(kind)
		id = strings.TrimSpace(id)
		if kind == "" || id == "" {
			continue
		}
		label := trainingMemoryEvidenceLabel(kind, id)
		if label == "" {
			continue
		}
		links = append(links, TrainingMemoryEvidenceLink{
			Kind:  kind,
			ID:    id,
			Label: label,
		})
		if len(links) >= 12 {
			break
		}
	}
	return links
}

func trainingMemoryEvidenceLabel(kind, id string) string {
	switch kind {
	case "job":
		return "原始训练任务 " + id
	case "session":
		return "Agent 会话 " + id
	case "trajectory":
		return "Solver 轨迹 " + id
	case "judge":
		return "Judge 回执 " + id
	case "hint":
		return "提示记录 " + id
	case "step":
		return "用户步骤 " + id
	case "failure":
		return "失败分支 " + id
	default:
		return ""
	}
}

type memoryScanner interface {
	Scan(...any) error
}

func scanTrainingMemory(scanner memoryScanner) (TrainingMemory, error) {
	var memory TrainingMemory
	var tagsJSON string
	var refsJSON string
	var createdAt string
	var updatedAt string
	var archivedAt string
	if err := scanner.Scan(
		&memory.ID,
		&memory.SchemaVersion,
		&memory.Kind,
		&memory.Verification,
		&memory.Title,
		&memory.Summary,
		&memory.Category,
		&tagsJSON,
		&memory.SourceJobID,
		&memory.SourceSessionID,
		&refsJSON,
		&memory.Confidence,
		&memory.Path,
		&createdAt,
		&updatedAt,
		&archivedAt,
		&memory.ArchivedReason,
	); err != nil {
		return TrainingMemory{}, fmt.Errorf("scan CTF memory: %w", err)
	}
	if err := json.Unmarshal([]byte(tagsJSON), &memory.Tags); err != nil {
		return TrainingMemory{}, fmt.Errorf("decode CTF memory tags: %w", err)
	}
	if err := json.Unmarshal([]byte(refsJSON), &memory.EvidenceRefs); err != nil {
		return TrainingMemory{}, fmt.Errorf("decode CTF memory evidence refs: %w", err)
	}
	// Attribution remains a projection of the append-only source job during
	// pre-release feature work. The existing memory table is intentionally
	// unchanged until the final destructive schema consolidation.
	memory.Actor = LearningActorImported
	memory.Assistance = LearningAssistanceDelegated
	memory.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	memory.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	if archivedAt != "" {
		memory.ArchivedAt, _ = time.Parse(time.RFC3339Nano, archivedAt)
	}
	return memory, nil
}

func classifyTrainingMemory(projection Projection) (TrainingMemoryVerification, float64) {
	if projection.Debrief.Status != "succeeded" {
		return TrainingMemoryFailureObserved, 0.7
	}
	for _, receipt := range projection.JudgeReceipts {
		if receipt.Correct != nil && *receipt.Correct {
			return TrainingMemoryJudgeVerified, 1
		}
	}
	if !strings.EqualFold(strings.TrimSpace(projection.Challenge.JudgeType), "external.manual") {
		return TrainingMemoryJudgeVerified, 1
	}
	return TrainingMemoryUserConfirmed, 0.8
}

func trainingMemoryVerificationLabel(value TrainingMemoryVerification) string {
	switch value {
	case TrainingMemoryJudgeVerified:
		return "Judge 或确定性评测已验证"
	case TrainingMemoryUserConfirmed:
		return "用户根据平台结果确认，尚无机器可读回执"
	case TrainingMemoryFailureObserved:
		return "训练失败分支与复盘已记录"
	default:
		return "旧记录，原始验证等级不可追溯"
	}
}

func learningActorLabel(value LearningActor) string {
	switch value {
	case LearningActorUser:
		return "用户"
	case LearningActorAgent:
		return "Agent"
	case LearningActorShared:
		return "用户与 Agent 共同完成"
	default:
		return "旧记录或导入记录，贡献者不可追溯"
	}
}

func learningAssistanceLabel(value LearningAssistance) string {
	switch value {
	case LearningAssistanceNone:
		return "无协助"
	case LearningAssistanceHint:
		return "依赖提示"
	case LearningAssistanceCopilot:
		return "搭档协作"
	default:
		return "代理完成"
	}
}

func renderTrainingMemory(
	memory TrainingMemory,
	projection Projection,
	redact func(string) string,
) string {
	var builder strings.Builder
	builder.WriteString("# ")
	builder.WriteString(memory.Title)
	builder.WriteString("\n\n")
	builder.WriteString(memory.Summary)
	builder.WriteString("\n\n## 正确性证据\n\n- 验证等级：")
	builder.WriteString(trainingMemoryVerificationLabel(memory.Verification))
	builder.WriteString("\n- 置信度：")
	builder.WriteString(fmt.Sprintf("%.2f", memory.Confidence))
	builder.WriteString("\n\n## 贡献归属\n\n- 主要贡献：")
	builder.WriteString(learningActorLabel(memory.Actor))
	builder.WriteString("\n- 协助方式：")
	builder.WriteString(learningAssistanceLabel(memory.Assistance))
	builder.WriteString("\n\n## 关键观察\n")
	writeMemoryBullets(&builder, projection.Debrief.KeyObservations, redact)
	builder.WriteString("\n## 已证伪或失败分支\n")
	writeMemoryBullets(&builder, projection.Debrief.FailureBranches, redact)
	builder.WriteString("\n## 学习者复盘\n")
	reflections := make([]string, 0, len(projection.Learning))
	for _, record := range projection.Learning {
		if record.Kind == "reflection" &&
			record.Actor == LearningActorUser {
			reflections = append(reflections, record.Content)
		}
	}
	writeMemoryBullets(&builder, reflections, redact)
	builder.WriteString("\n## 下次调用条件\n\n- 分类：")
	builder.WriteString(memory.Category)
	builder.WriteString("\n- 标签：")
	builder.WriteString(strings.Join(memory.Tags, "、"))
	builder.WriteString("\n- 重新使用前先验证当前题目的格式、参数和环境是否满足相同前提。\n")
	builder.WriteString("\n## 证据来源\n")
	writeMemoryBullets(&builder, memory.EvidenceRefs, redact)
	return builder.String()
}

func writeMemoryBullets(builder *strings.Builder, values []string, redact func(string) string) {
	written := 0
	for _, value := range values {
		value = strings.TrimSpace(redact(value))
		if value == "" {
			continue
		}
		builder.WriteString("\n- ")
		builder.WriteString(truncateRunes(value, 800))
		written++
	}
	if written == 0 {
		builder.WriteString("\n- 暂无。")
	}
	builder.WriteString("\n")
}

func memoryCandidateSecrets(projection Projection) []string {
	values := make([]string, 0, len(projection.AgentCandidates)+len(projection.Submissions))
	for _, candidate := range projection.AgentCandidates {
		if value := strings.TrimSpace(candidate.Candidate); value != "" {
			values = append(values, value)
		}
	}
	for _, submission := range projection.Submissions {
		if value := strings.TrimSpace(submission.Candidate); value != "" {
			values = append(values, value)
		}
	}
	sort.Slice(values, func(left, right int) bool {
		return len(values[left]) > len(values[right])
	})
	return values
}

func redactMemoryText(value string, candidates []string) string {
	for _, candidate := range candidates {
		value = strings.ReplaceAll(value, candidate, "[candidate redacted]")
	}
	value = memoryFlagPattern.ReplaceAllString(value, "[candidate redacted]")
	value = memoryAPIKeyPattern.ReplaceAllString(value, "[secret redacted]")
	value = memoryBearerPattern.ReplaceAllString(value, "Bearer [secret redacted]")
	value = memoryURLSecretPattern.ReplaceAllString(value, "$1[secret redacted]")
	return value
}

func normalizeMemoryValues(values []string, limit, maxRunes int) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, min(len(values), limit))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		value = truncateRunes(value, maxRunes)
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
		if len(result) >= limit {
			break
		}
	}
	return result
}

func memoryRecallKeywords(values []string) []string {
	keywords := make([]string, 0, len(values)*2)
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		parts := append(
			[]string{value},
			strings.FieldsFunc(value, func(r rune) bool {
				switch r {
				case ' ', '\t', '\r', '\n', ',', '，', '.', '。', '/', '\\', '-', '_', ':', '：', ';', '；':
					return true
				default:
					return false
				}
			})...,
		)
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if len([]rune(part)) < 2 {
				continue
			}
			if _, exists := seen[part]; exists {
				continue
			}
			seen[part] = struct{}{}
			keywords = append(keywords, part)
			if len(keywords) >= 32 {
				return keywords
			}
		}
	}
	return keywords
}
