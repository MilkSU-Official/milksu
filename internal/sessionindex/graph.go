package sessionindex

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
)

const (
	defaultGraphNodeLimit = 120
	maximumGraphNodeLimit = 200
	defaultGraphEdgeLimit = 200
	maximumGraphEdgeLimit = 360
	maximumGraphSessions  = 40
	maximumNodeSources    = 8
)

type GraphRequest struct {
	Query    string `json:"query,omitempty"`
	Project  string `json:"project,omitempty"`
	Module   string `json:"module,omitempty"`
	Since    string `json:"since,omitempty"`
	Until    string `json:"until,omitempty"`
	MaxNodes int    `json:"maxNodes,omitempty"`
	MaxEdges int    `json:"maxEdges,omitempty"`
}

type GraphResponse struct {
	GeneratedAt  string      `json:"generatedAt"`
	Status       Status      `json:"status"`
	Nodes        []GraphNode `json:"nodes"`
	Edges        []GraphEdge `json:"edges"`
	Projects     []string    `json:"projects"`
	Truncated    bool        `json:"truncated"`
	FactBoundary string      `json:"factBoundary"`
}

type GraphNode struct {
	ID        string        `json:"id"`
	Type      string        `json:"type"`
	Label     string        `json:"label"`
	Detail    string        `json:"detail,omitempty"`
	Module    string        `json:"module,omitempty"`
	Project   string        `json:"project,omitempty"`
	Timestamp string        `json:"timestamp,omitempty"`
	ArchiveID string        `json:"archiveId,omitempty"`
	Quote     string        `json:"quote,omitempty"`
	Sources   []GraphSource `json:"sources"`
}

type GraphSource struct {
	SessionID      string `json:"sessionId"`
	ConversationID string `json:"conversationId,omitempty"`
	MessageUUID    string `json:"messageUuid,omitempty"`
	SessionName    string `json:"sessionName"`
	Timestamp      string `json:"timestamp,omitempty"`
}

type GraphEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

type GraphInput struct {
	Conversations []conversation.StoredConversation
	Archives      []GraphArchive
}

type GraphArchive struct {
	ID        string
	Module    string
	Title     string
	Timestamp string
	Evidence  []GraphArchiveEvidence
	Artifacts []GraphArchiveArtifact
}

type GraphArchiveEvidence struct {
	ID          string
	Claim       string
	Provenance  string
	ArtifactIDs []string
}

type GraphArchiveArtifact struct {
	ID           string
	Source       string
	MediaType    string
	RelativePath string
	Size         int64
}

type graphSession struct {
	ID          string
	Title       string
	Project     string
	ProjectPath string
	StartedAt   string
	Source      string
}

type graphMessage struct {
	UUID      string
	SessionID string
	Timestamp string
	Model     string
	Skill     string
	Text      string
}

type graphToolCall struct {
	MessageUUID string
	SessionID   string
	Name        string
	FilePath    string
}

func (s Store) Graph(ctx context.Context, request GraphRequest, input GraphInput) (GraphResponse, error) {
	request.Query = normalizeSpace(request.Query)
	request.Project = strings.TrimSpace(request.Project)
	request.Module = normalizeGraphModule(request.Module)
	var err error
	request.Since, err = normalizeTimeBoundary(request.Since)
	if err != nil {
		return GraphResponse{}, fmt.Errorf("invalid history graph since: %w", err)
	}
	request.Until, err = normalizeTimeBoundary(request.Until)
	if err != nil {
		return GraphResponse{}, fmt.Errorf("invalid history graph until: %w", err)
	}
	if request.Since != "" && request.Until != "" && request.Since > request.Until {
		return GraphResponse{}, fmt.Errorf("history graph since must not be after until")
	}

	status, err := s.Status(ctx)
	if err != nil {
		return GraphResponse{}, err
	}
	response := GraphResponse{
		GeneratedAt:  s.now().Format(time.RFC3339Nano),
		Status:       status,
		Nodes:        []GraphNode{},
		Edges:        []GraphEdge{},
		Projects:     []string{},
		FactBoundary: FactBoundary,
	}
	if !status.Available {
		return response, nil
	}

	db, err := openReadOnly(s.Path)
	if err != nil {
		return GraphResponse{}, fmt.Errorf("open session index graph: %w", err)
	}
	defer db.Close()

	response.Projects, err = graphProjects(ctx, db, request)
	if err != nil {
		return GraphResponse{}, fmt.Errorf("list history graph projects: %w", err)
	}
	sessions, sessionTruncated, err := graphSessions(ctx, db, request)
	if err != nil {
		return GraphResponse{}, fmt.Errorf("list history graph sessions: %w", err)
	}
	if len(sessions) == 0 && len(input.Archives) == 0 {
		return response, nil
	}

	builder := newGraphBuilder(clampGraphNodes(request.MaxNodes), clampGraphEdges(request.MaxEdges))
	conversationBySession := make(map[string]conversation.StoredConversation, len(input.Conversations))
	for _, value := range input.Conversations {
		conversationBySession["milksu:"+value.ID] = value
	}
	sessionByID := make(map[string]graphSession, len(sessions))
	for _, session := range sessions {
		sessionByID[session.ID] = session
		addGraphSession(builder, session, conversationBySession[session.ID])
	}

	if len(sessions) > 0 {
		messages, messageErr := graphMessages(ctx, db, sessions, request)
		if messageErr != nil {
			return GraphResponse{}, fmt.Errorf("list history graph messages: %w", messageErr)
		}
		for _, message := range messages {
			addGraphMessage(builder, sessionByID[message.SessionID], message)
		}
		toolCalls, toolErr := graphToolCalls(ctx, db, sessions, request)
		if toolErr != nil {
			return GraphResponse{}, fmt.Errorf("list history graph tools: %w", toolErr)
		}
		for _, toolCall := range toolCalls {
			addGraphToolCall(builder, sessionByID[toolCall.SessionID], toolCall)
		}
	}

	for _, archive := range input.Archives {
		addGraphArchive(builder, archive, request)
	}

	response.Nodes = builder.nodes
	response.Edges = builder.edges
	response.Truncated = sessionTruncated || builder.truncated
	return response, nil
}

func graphProjects(ctx context.Context, db *sql.DB, request GraphRequest) ([]string, error) {
	source := requestSource(SearchRequest{Module: request.Module})
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT COALESCE(project, '')
		FROM sessions
		WHERE COALESCE(project, '') != ''
			AND (? = '' OR COALESCE(source, '') = ?)
			AND EXISTS (
				SELECT 1 FROM messages m
				WHERE m.session_id = sessions.id
					AND COALESCE(m.visibility, 'visible') != 'hidden'
					AND (? = '' OR COALESCE(m.timestamp, '') >= ?)
					AND (? = '' OR COALESCE(m.timestamp, '') <= ?)
			)
		ORDER BY project COLLATE NOCASE
	`, source, source, request.Since, request.Since, request.Until, request.Until)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		values = append(values, RedactSnippet(value))
	}
	return values, rows.Err()
}

func graphSessions(ctx context.Context, db *sql.DB, request GraphRequest) ([]graphSession, bool, error) {
	source := requestSource(SearchRequest{Module: request.Module})
	limit := maximumGraphSessions
	if requested := clampGraphNodes(request.MaxNodes); requested < limit {
		limit = requested
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, COALESCE(title, ''), COALESCE(project, ''), COALESCE(project_path, ''),
			COALESCE(started_at, ''), COALESCE(source, '')
		FROM sessions s
		WHERE (? = '' OR COALESCE(s.source, '') = ?)
			AND (? = '' OR COALESCE(s.project, '') LIKE ? ESCAPE '\' OR COALESCE(s.project_path, '') LIKE ? ESCAPE '\')
			AND EXISTS (
				SELECT 1 FROM messages m
				WHERE m.session_id = s.id
					AND COALESCE(m.visibility, 'visible') != 'hidden'
					AND (? = '' OR COALESCE(m.timestamp, '') >= ?)
					AND (? = '' OR COALESCE(m.timestamp, '') <= ?)
					AND (? = '' OR COALESCE(m.text, '') LIKE ? ESCAPE '\')
			)
		ORDER BY COALESCE(s.started_at, '') DESC, s.id
		LIMIT ?
	`, source, source,
		request.Project, likeContains(request.Project), likeContains(request.Project),
		request.Since, request.Since, request.Until, request.Until,
		request.Query, likeContains(request.Query),
		limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	values := make([]graphSession, 0, limit)
	truncated := false
	for rows.Next() {
		var value graphSession
		if err := rows.Scan(&value.ID, &value.Title, &value.Project, &value.ProjectPath, &value.StartedAt, &value.Source); err != nil {
			return nil, false, err
		}
		if len(values) < limit {
			values = append(values, value)
		} else {
			truncated = true
		}
	}
	return values, truncated, rows.Err()
}

func graphMessages(ctx context.Context, db *sql.DB, sessions []graphSession, request GraphRequest) ([]graphMessage, error) {
	query, args := graphInQuery(`
		SELECT uuid, session_id, COALESCE(timestamp, ''), COALESCE(model, ''),
			COALESCE(skill, ''), COALESCE(text, '')
		FROM messages
		WHERE COALESCE(visibility, 'visible') != 'hidden' AND session_id IN (%s)
			AND (? = '' OR COALESCE(timestamp, '') >= ?)
			AND (? = '' OR COALESCE(timestamp, '') <= ?)
		ORDER BY COALESCE(timestamp, '') DESC, uuid
	`, sessions)
	args = append(args, request.Since, request.Since, request.Until, request.Until)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]graphMessage, 0)
	for rows.Next() {
		var value graphMessage
		if err := rows.Scan(&value.UUID, &value.SessionID, &value.Timestamp, &value.Model, &value.Skill, &value.Text); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func graphToolCalls(ctx context.Context, db *sql.DB, sessions []graphSession, request GraphRequest) ([]graphToolCall, error) {
	query, args := graphInQuery(`
		SELECT COALESCE(tc.message_uuid, ''), tc.session_id, COALESCE(tc.name, ''), COALESCE(tc.file_path, '')
		FROM tool_calls tc
		LEFT JOIN messages m ON m.uuid = tc.message_uuid
		WHERE tc.session_id IN (%s)
			AND (? = '' OR COALESCE(m.timestamp, '') >= ?)
			AND (? = '' OR COALESCE(m.timestamp, '') <= ?)
		ORDER BY tc.session_id, tc.name, tc.id
	`, sessions)
	args = append(args, request.Since, request.Since, request.Until, request.Until)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]graphToolCall, 0)
	for rows.Next() {
		var value graphToolCall
		if err := rows.Scan(&value.MessageUUID, &value.SessionID, &value.Name, &value.FilePath); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func graphInQuery(template string, sessions []graphSession) (string, []any) {
	placeholders := make([]string, 0, len(sessions))
	args := make([]any, 0, len(sessions))
	for _, session := range sessions {
		placeholders = append(placeholders, "?")
		args = append(args, session.ID)
	}
	return fmt.Sprintf(template, strings.Join(placeholders, ",")), args
}

func addGraphSession(builder *graphBuilder, session graphSession, value conversation.StoredConversation) {
	module := graphModuleForSource(session.Source)
	source := graphSourceForSession(session, "")
	sessionNodeID := entityNodeID("session", session.ID)
	builder.addNode(GraphNode{
		ID:        sessionNodeID,
		Type:      "session",
		Label:     fallback(session.Title, session.ID),
		Detail:    strings.Join(compactGraphParts(moduleLabel(module), session.Project, session.StartedAt), " · "),
		Module:    module,
		Project:   session.Project,
		Timestamp: session.StartedAt,
		Quote:     fallback(session.Title, session.ID),
		Sources:   []GraphSource{source},
	})

	if session.Project != "" {
		projectNodeID := entityNodeID("project", fallback(session.ProjectPath, session.Project))
		builder.addNode(GraphNode{
			ID:      projectNodeID,
			Type:    "project",
			Label:   session.Project,
			Detail:  session.ProjectPath,
			Project: session.Project,
			Sources: []GraphSource{source},
		})
		builder.addEdge(projectNodeID, sessionNodeID, "contains")
	}

	if module == "ctf" {
		ctfID := fallback(value.CTFJobID, session.ID)
		ctfNodeID := entityNodeID("ctf", ctfID)
		builder.addNode(GraphNode{
			ID:        ctfNodeID,
			Type:      "ctf",
			Label:     fallback(session.Title, "CTF 任务"),
			Detail:    value.CTFJobID,
			Module:    "ctf",
			Project:   session.Project,
			Timestamp: session.StartedAt,
			ArchiveID: value.CTFJobID,
			Quote:     fallback(session.Title, "CTF 任务"),
			Sources:   []GraphSource{source},
		})
		builder.addEdge(sessionNodeID, ctfNodeID, "focuses")
	}
	if module == "cve" {
		for _, match := range cveIDPattern.FindAllString(session.Title, -1) {
			cveID := strings.ToUpper(match)
			cveNodeID := entityNodeID("cve", cveID)
			builder.addNode(GraphNode{
				ID:        cveNodeID,
				Type:      "cve",
				Label:     cveID,
				Module:    "cve",
				Project:   session.Project,
				Timestamp: session.StartedAt,
				Quote:     cveID,
				Sources:   []GraphSource{source},
			})
			builder.addEdge(sessionNodeID, cveNodeID, "mentions")
		}
	}

	if value.AgentGoal != nil && strings.TrimSpace(value.AgentGoal.Text) != "" {
		goalNodeID := entityNodeID("goal", session.ID+":"+value.AgentGoal.ID)
		builder.addNode(GraphNode{
			ID:        goalNodeID,
			Type:      "goal",
			Label:     value.AgentGoal.Text,
			Detail:    value.AgentGoal.Status,
			Module:    module,
			Project:   session.Project,
			Timestamp: graphGoalTimestamp(value.AgentGoal),
			Quote:     value.AgentGoal.Text,
			Sources:   []GraphSource{source},
		})
		builder.addEdge(sessionNodeID, goalNodeID, "contains")
	}

	for _, skill := range value.AgentSkills {
		skill = strings.TrimSpace(skill)
		if skill == "" {
			continue
		}
		skillNodeID := entityNodeID("skill", skill)
		builder.addNode(GraphNode{
			ID:      skillNodeID,
			Type:    "skill",
			Label:   skill,
			Module:  module,
			Project: session.Project,
			Quote:   skill,
			Sources: []GraphSource{source},
		})
		builder.addEdge(sessionNodeID, skillNodeID, "loads")
	}

	for _, message := range value.Messages {
		for _, attachment := range message.Attachments {
			artifactID := fallback(attachment.SHA256, attachment.ID)
			if strings.TrimSpace(artifactID) == "" {
				continue
			}
			artifactNodeID := entityNodeID("artifact", artifactID)
			attachmentSource := source
			attachmentSource.MessageUUID = "milksu:" + value.ID + ":" + message.ID
			attachmentSource.Timestamp = timestampToRFC3339(message.Timestamp)
			builder.addNode(GraphNode{
				ID:        artifactNodeID,
				Type:      "artifact",
				Label:     fallback(attachment.Name, "附件"),
				Detail:    fmt.Sprintf("%s · %d bytes", attachment.MediaType, attachment.Size),
				Module:    module,
				Project:   session.Project,
				Timestamp: attachmentSource.Timestamp,
				Quote:     fallback(attachment.Name, "附件"),
				Sources:   []GraphSource{attachmentSource},
			})
			builder.addEdge(artifactNodeID, sessionNodeID, "derived-from")
		}
	}
}

func addGraphMessage(builder *graphBuilder, session graphSession, message graphMessage) {
	if session.ID == "" {
		return
	}
	module := graphModuleForSource(session.Source)
	sessionNodeID := entityNodeID("session", session.ID)
	source := graphSourceForSession(session, message.UUID)
	source.Timestamp = message.Timestamp
	if model := strings.TrimSpace(message.Model); model != "" {
		modelNodeID := entityNodeID("model", model)
		builder.addNode(GraphNode{
			ID:      modelNodeID,
			Type:    "model",
			Label:   model,
			Module:  module,
			Project: session.Project,
			Quote:   model,
			Sources: []GraphSource{source},
		})
		builder.addEdge(sessionNodeID, modelNodeID, "uses")
	}
	if skill := explicitSkillName(message.Skill); skill != "" {
		skillNodeID := entityNodeID("skill", skill)
		builder.addNode(GraphNode{
			ID:      skillNodeID,
			Type:    "skill",
			Label:   skill,
			Module:  module,
			Project: session.Project,
			Quote:   skill,
			Sources: []GraphSource{source},
		})
		builder.addEdge(sessionNodeID, skillNodeID, "loads")
	}
	for _, match := range cveIDPattern.FindAllString(message.Text, -1) {
		cveID := strings.ToUpper(match)
		cveNodeID := entityNodeID("cve", cveID)
		builder.addNode(GraphNode{
			ID:        cveNodeID,
			Type:      "cve",
			Label:     cveID,
			Module:    "cve",
			Project:   session.Project,
			Timestamp: message.Timestamp,
			Quote:     cveID,
			Sources:   []GraphSource{source},
		})
		builder.addEdge(sessionNodeID, cveNodeID, "mentions")
	}
}

func addGraphToolCall(builder *graphBuilder, session graphSession, call graphToolCall) {
	name := strings.TrimSpace(call.Name)
	if session.ID == "" || name == "" {
		return
	}
	module := graphModuleForSource(session.Source)
	source := graphSourceForSession(session, call.MessageUUID)
	toolNodeID := entityNodeID("tool", name)
	builder.addNode(GraphNode{
		ID:      toolNodeID,
		Type:    "tool",
		Label:   name,
		Module:  module,
		Project: session.Project,
		Quote:   name,
		Sources: []GraphSource{source},
	})
	builder.addEdge(entityNodeID("session", session.ID), toolNodeID, "calls")
	if filePath := strings.TrimSpace(call.FilePath); filePath != "" {
		artifactNodeID := entityNodeID("artifact", filePath)
		builder.addNode(GraphNode{
			ID:      artifactNodeID,
			Type:    "artifact",
			Label:   filePath,
			Module:  module,
			Project: session.Project,
			Quote:   filePath,
			Sources: []GraphSource{source},
		})
		builder.addEdge(artifactNodeID, toolNodeID, "derived-from")
	}
}

func addGraphArchive(builder *graphBuilder, archive GraphArchive, request GraphRequest) {
	module := normalizeGraphModule(archive.Module)
	if module != "ctf" && module != "cve" {
		return
	}
	if request.Module != "" && request.Module != module {
		return
	}
	if request.Since != "" && archive.Timestamp < request.Since {
		return
	}
	if request.Until != "" && archive.Timestamp > request.Until {
		return
	}
	domainValue := archive.ID
	label := archive.Title
	if module == "cve" {
		matches := cveIDPattern.FindAllString(archive.Title, -1)
		if len(matches) > 0 {
			domainValue = strings.ToUpper(matches[0])
			label = domainValue
		}
	}
	domainNodeID := entityNodeID(module, domainValue)
	alreadyLinked := builder.hasNode(domainNodeID)
	if request.Project != "" && !alreadyLinked {
		return
	}
	if request.Query != "" && !alreadyLinked && !archiveMatchesQuery(archive, request.Query) {
		return
	}
	builder.addNode(GraphNode{
		ID:        domainNodeID,
		Type:      module,
		Label:     fallback(label, archive.ID),
		Detail:    archive.Title,
		Module:    module,
		Timestamp: archive.Timestamp,
		ArchiveID: archive.ID,
		Quote:     fallback(label, archive.Title),
		Sources:   []GraphSource{},
	})
	artifactNodes := make(map[string]string, len(archive.Artifacts))
	for _, artifact := range archive.Artifacts {
		artifactNodeID := entityNodeID("artifact", fallback(artifact.ID, artifact.RelativePath))
		if builder.addNode(GraphNode{
			ID:        artifactNodeID,
			Type:      "artifact",
			Label:     fallback(artifact.RelativePath, fallback(artifact.Source, artifact.ID)),
			Detail:    fmt.Sprintf("%s · %d bytes", artifact.MediaType, artifact.Size),
			Module:    module,
			Timestamp: archive.Timestamp,
			ArchiveID: archive.ID,
			Quote:     fallback(artifact.RelativePath, artifact.Source),
			Sources:   []GraphSource{},
		}) {
			artifactNodes[artifact.ID] = artifactNodeID
			builder.addEdge(artifactNodeID, domainNodeID, "derived-from")
		}
	}
	for _, evidence := range archive.Evidence {
		evidenceNodeID := entityNodeID("evidence", archive.ID+":"+evidence.ID)
		if builder.addNode(GraphNode{
			ID:        evidenceNodeID,
			Type:      "evidence",
			Label:     fallback(evidence.Claim, evidence.ID),
			Detail:    evidence.Provenance,
			Module:    module,
			Timestamp: archive.Timestamp,
			ArchiveID: archive.ID,
			Quote:     fallback(evidence.Claim, evidence.ID),
			Sources:   []GraphSource{},
		}) {
			builder.addEdge(evidenceNodeID, domainNodeID, "derived-from")
			for _, artifactID := range evidence.ArtifactIDs {
				if artifactNodeID := artifactNodes[artifactID]; artifactNodeID != "" {
					builder.addEdge(evidenceNodeID, artifactNodeID, "derived-from")
				}
			}
		}
	}
}

func archiveMatchesQuery(archive GraphArchive, query string) bool {
	query = strings.ToLower(normalizeSpace(query))
	if query == "" {
		return true
	}
	values := []string{archive.ID, archive.Title}
	for _, evidence := range archive.Evidence {
		values = append(values, evidence.ID, evidence.Claim, evidence.Provenance)
	}
	for _, artifact := range archive.Artifacts {
		values = append(values, artifact.ID, artifact.Source, artifact.RelativePath, artifact.MediaType)
	}
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	return false
}

func normalizeGraphModule(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "coding":
		return "coding"
	case "ctf":
		return "ctf"
	case "cve", "vuln", "vulnerability":
		return "cve"
	default:
		return ""
	}
}

func normalizeTimeBoundary(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format(time.RFC3339), nil
}

func graphModuleForSource(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "milksu-ctf":
		return "ctf"
	case "milksu-cve":
		return "cve"
	default:
		return "coding"
	}
}

func moduleLabel(module string) string {
	switch module {
	case "ctf":
		return "CTF"
	case "cve":
		return "CVE"
	default:
		return "Coding"
	}
}

func graphSourceForSession(session graphSession, messageUUID string) GraphSource {
	conversationID := ""
	if strings.HasPrefix(session.ID, sourcePrefix+":") {
		conversationID = strings.TrimPrefix(session.ID, sourcePrefix+":")
	}
	return GraphSource{
		SessionID:      session.ID,
		ConversationID: conversationID,
		MessageUUID:    messageUUID,
		SessionName:    fallback(session.Title, session.ID),
		Timestamp:      session.StartedAt,
	}
}

func explicitSkillName(value string) string {
	value = strings.TrimSpace(value)
	for _, prefix := range []string{"/skill:", "skill:"} {
		if strings.HasPrefix(value, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(value, prefix))
		}
	}
	return ""
}

func entityNodeID(kind, value string) string {
	digest := sha256.Sum256([]byte(kind + "\x00" + strings.TrimSpace(value)))
	return kind + ":" + hex.EncodeToString(digest[:10])
}

func graphGoalTimestamp(goal *conversation.StoredGoal) string {
	if goal == nil {
		return ""
	}
	value := goal.UpdatedAt
	if goal.StartedAt > value {
		value = goal.StartedAt
	}
	if value <= 0 {
		return ""
	}
	return timestampToRFC3339(uint64(value))
}

func compactGraphParts(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func clampGraphNodes(value int) int {
	if value <= 0 {
		return defaultGraphNodeLimit
	}
	if value > maximumGraphNodeLimit {
		return maximumGraphNodeLimit
	}
	return value
}

func clampGraphEdges(value int) int {
	if value <= 0 {
		return defaultGraphEdgeLimit
	}
	if value > maximumGraphEdgeLimit {
		return maximumGraphEdgeLimit
	}
	return value
}

type graphBuilder struct {
	maxNodes  int
	maxEdges  int
	nodes     []GraphNode
	edges     []GraphEdge
	nodeIndex map[string]int
	edgeIDs   map[string]struct{}
	truncated bool
}

func newGraphBuilder(maxNodes, maxEdges int) *graphBuilder {
	return &graphBuilder{
		maxNodes:  maxNodes,
		maxEdges:  maxEdges,
		nodes:     make([]GraphNode, 0, maxNodes),
		edges:     make([]GraphEdge, 0, maxEdges),
		nodeIndex: make(map[string]int, maxNodes),
		edgeIDs:   make(map[string]struct{}, maxEdges),
	}
}

func (b *graphBuilder) hasNode(id string) bool {
	_, ok := b.nodeIndex[id]
	return ok
}

func (b *graphBuilder) addNode(node GraphNode) bool {
	if node.ID == "" || node.Type == "" {
		return false
	}
	node.Label = graphText(fallback(node.Label, node.ID), 100)
	node.Detail = graphText(node.Detail, 260)
	node.Quote = graphText(fallback(node.Quote, node.Label), 520)
	node.Project = graphText(node.Project, 100)
	for index := range node.Sources {
		node.Sources[index].SessionName = graphText(node.Sources[index].SessionName, 100)
	}
	if index, ok := b.nodeIndex[node.ID]; ok {
		mergeGraphNode(&b.nodes[index], node)
		return true
	}
	if len(b.nodes) >= b.maxNodes {
		b.truncated = true
		return false
	}
	if node.Sources == nil {
		node.Sources = []GraphSource{}
	}
	b.nodeIndex[node.ID] = len(b.nodes)
	b.nodes = append(b.nodes, node)
	return true
}

func (b *graphBuilder) addEdge(source, target, edgeType string) {
	if !b.hasNode(source) || !b.hasNode(target) || !allowedGraphEdgeType(edgeType) {
		return
	}
	id := entityNodeID("edge", source+"\x00"+edgeType+"\x00"+target)
	if _, ok := b.edgeIDs[id]; ok {
		return
	}
	if len(b.edges) >= b.maxEdges {
		b.truncated = true
		return
	}
	b.edgeIDs[id] = struct{}{}
	b.edges = append(b.edges, GraphEdge{ID: id, Source: source, Target: target, Type: edgeType})
}

func mergeGraphNode(target *GraphNode, incoming GraphNode) {
	if target.Detail == "" {
		target.Detail = incoming.Detail
	}
	if target.Module == "" {
		target.Module = incoming.Module
	}
	if target.Project == "" {
		target.Project = incoming.Project
	}
	if incoming.Timestamp > target.Timestamp {
		target.Timestamp = incoming.Timestamp
	}
	if target.ArchiveID == "" {
		target.ArchiveID = incoming.ArchiveID
	}
	if target.Quote == "" {
		target.Quote = incoming.Quote
	}
	for _, source := range incoming.Sources {
		if len(target.Sources) >= maximumNodeSources {
			break
		}
		duplicate := false
		for _, existing := range target.Sources {
			if existing.SessionID == source.SessionID && existing.MessageUUID == source.MessageUUID {
				duplicate = true
				break
			}
		}
		if !duplicate {
			target.Sources = append(target.Sources, source)
		}
	}
	sort.SliceStable(target.Sources, func(i, j int) bool {
		return target.Sources[i].Timestamp > target.Sources[j].Timestamp
	})
}

func graphText(value string, limit int) string {
	return trimRunes(RedactSnippet(normalizeVisibleText(value)), limit)
}

func allowedGraphEdgeType(value string) bool {
	switch value {
	case "contains", "uses", "calls", "loads", "focuses", "mentions", "derived-from":
		return true
	default:
		return false
	}
}
