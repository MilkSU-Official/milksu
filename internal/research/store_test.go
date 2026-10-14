package research

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

func TestStorePersistsRunTaskSourceCitationAndArtifactAcrossReopen(t *testing.T) {
	dataDirectory := t.TempDir()
	ctx := context.Background()
	store, err := OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}

	createdAt := time.Date(2026, time.September, 24, 11, 30, 0, 123456789, time.UTC)
	run := Run{
		ID:             "run_persistence",
		ConversationID: "conversation-one",
		Query:          "research durable storage",
		Status:         RunRunning,
		Phase:          PhaseCollecting,
		CreatedAt:      createdAt,
		UpdatedAt:      createdAt,
	}
	if err := store.CreateRun(ctx, run); err != nil {
		store.Close()
		t.Fatal(err)
	}
	task := Task{
		ID:       "task_one",
		RunID:    run.ID,
		Prompt:   "collect evidence",
		Status:   TaskRunning,
		WorkerID: "worker_one",
		Batch:    2,
	}
	if err := store.UpsertTask(ctx, task); err != nil {
		store.Close()
		t.Fatal(err)
	}
	content := []byte("durable source content")
	retrievedAt := createdAt.Add(17 * time.Second)
	source, err := store.AddSource(
		ctx,
		run.ID,
		"https://reader:synthetic-password@example.test/paper?keep=value&api_key=synthetic-key&access_token=synthetic-token#access_token=synthetic-fragment",
		"Example paper",
		retrievedAt,
		content,
	)
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	parsedURL, err := url.Parse(source.URL)
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	if parsedURL.User != nil || parsedURL.Query().Has("api_key") || parsedURL.Query().Has("access_token") ||
		parsedURL.Query().Get("keep") != "value" || strings.Contains(source.URL, "synthetic-") {
		store.Close()
		t.Fatalf("source URL was not safely normalized: %q", source.URL)
	}
	citation := Citation{
		RunID:    run.ID,
		Claim:    "The source supports durable storage.",
		SourceID: source.ID,
		Verdict:  CitationSupported,
		Reason:   "The source describes persistence guarantees.",
	}
	if err := store.AddCitation(ctx, citation); err != nil {
		store.Close()
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	gotRun, err := store.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotRun, run) {
		t.Fatalf("GetRun() = %#v, want %#v", gotRun, run)
	}
	activeRun, err := store.FindActiveRun(ctx, run.ConversationID)
	if err != nil || activeRun.ID != run.ID {
		t.Fatalf("FindActiveRun() = %#v, %v", activeRun, err)
	}
	runs, err := store.ListRuns(ctx, run.ConversationID, 10)
	if err != nil || len(runs) != 1 || runs[0].ID != run.ID {
		t.Fatalf("ListRuns() = %#v, %v", runs, err)
	}
	tasks, err := store.ListTasks(ctx, run.ID)
	if err != nil || !reflect.DeepEqual(tasks, []Task{task}) {
		t.Fatalf("ListTasks() = %#v, %v; want %#v", tasks, err, []Task{task})
	}
	sources, err := store.ListSources(ctx, run.ID)
	if err != nil || !reflect.DeepEqual(sources, []Source{source}) {
		t.Fatalf("ListSources() = %#v, %v; want %#v", sources, err, []Source{source})
	}
	gotSource, gotContent, err := store.ReadSource(ctx, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotSource, source) || string(gotContent) != string(content) {
		t.Fatalf("ReadSource() = %#v, %q, want %#v, %q", gotSource, gotContent, source, content)
	}
	digest := sha256.Sum256(content)
	if source.ArtifactRef != hex.EncodeToString(digest[:]) {
		t.Fatalf("ArtifactRef = %q, want content digest %x", source.ArtifactRef, digest)
	}
	artifactPath := filepath.Join(dataDirectory, "domain", "research", "artifacts", run.ID, source.ArtifactRef)
	artifactData, err := os.ReadFile(artifactPath)
	if err != nil || string(artifactData) != string(content) {
		t.Fatalf("persisted artifact = %q, %v; want %q", artifactData, err, content)
	}
	citations, err := store.ListCitations(ctx, run.ID)
	if err != nil || !reflect.DeepEqual(citations, []Citation{citation}) {
		t.Fatalf("ListCitations() = %#v, %v; want %#v", citations, err, []Citation{citation})
	}
}

func TestResearchV1DatabaseMigratesAndPersistsUnconfirmedWorkerStop(t *testing.T) {
	dataDirectory := t.TempDir()
	databasePath := filepath.Join(dataDirectory, "domain", "research", "research.sqlite3")
	migrator, err := sqlitemigrate.Open(databasePath, []sqlitemigrate.Migration{{
		Version: 1,
		Name:    researchV1MigrationName,
		Up:      researchV1Up,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		_ = migrator.Close()
		t.Fatal(err)
	}
	_, err = migrator.DB().Exec(`INSERT INTO research_runs (
		id, conversation_id, query, status, phase, report, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"run_from_v1", "conversation-v1", "old run", RunCancelled, PhaseFinalizing, "",
		formatResearchTime(time.Now()), formatResearchTime(time.Now()),
	)
	if err != nil {
		_ = migrator.Close()
		t.Fatal(err)
	}
	if err := migrator.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	ctx := context.Background()
	run, err := store.GetRun(ctx, "run_from_v1")
	if err != nil || run.WorkerStopUnconfirmed {
		t.Fatalf("migrated legacy run = %#v, %v; want a clear stop state", run, err)
	}
	if _, err := service.SetWorkerStopUnconfirmed(ctx, run.ConversationID, run.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service = NewService(store)
	got, err := store.GetRun(ctx, "run_from_v1")
	if err != nil || !got.WorkerStopUnconfirmed {
		t.Fatalf("reopened run stop state = %#v, %v; want unconfirmed", got, err)
	}
	if _, err := service.Start(ctx, run.ConversationID, "another research run"); err == nil {
		t.Fatal("new run started while the previous worker stop was unconfirmed")
	}
	if _, err := service.SetWorkerStopUnconfirmed(ctx, run.ConversationID, run.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(ctx, run.ConversationID, "another research run"); err != nil {
		t.Fatalf("new run after confirmed worker stop: %v", err)
	}
}

func TestResearchV2DatabaseMigratesAndAcceptsLaunchingTasks(t *testing.T) {
	dataDirectory := t.TempDir()
	databasePath := filepath.Join(dataDirectory, "domain", "research", "research.sqlite3")
	migrator, err := sqlitemigrate.Open(databasePath, []sqlitemigrate.Migration{
		{
			Version: 1,
			Name:    researchV1MigrationName,
			Up:      researchV1Up,
		},
		{
			Version: 2,
			Name:    researchV2MigrationName,
			Up:      researchV2Up,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		_ = migrator.Close()
		t.Fatal(err)
	}
	_, err = migrator.DB().Exec(`INSERT INTO research_runs (
		id, conversation_id, query, status, phase, report, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"run_from_v2", "conversation-v2", "old run", RunRunning, PhaseCollecting, "",
		formatResearchTime(time.Now()), formatResearchTime(time.Now()),
	)
	if err != nil {
		_ = migrator.Close()
		t.Fatal(err)
	}
	if _, err := migrator.DB().Exec(`INSERT INTO research_tasks (
		id, run_id, prompt, status, worker_id, batch, result
	) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"task_from_v2", "run_from_v2", "collect evidence", TaskRunning, "worker_v2", 1, "",
	); err != nil {
		_ = migrator.Close()
		t.Fatal(err)
	}
	if err := migrator.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	tasks, err := store.ListTasks(ctx, "run_from_v2")
	if err != nil || len(tasks) != 1 || tasks[0].Status != TaskRunning || tasks[0].WorkerID != "worker_v2" {
		t.Fatalf("migrated legacy task = %#v, %v", tasks, err)
	}
	launching := Task{
		ID:       "task_launching_v3",
		RunID:    "run_from_v2",
		Prompt:   "collect more evidence",
		Status:   TaskLaunching,
		WorkerID: "",
		Batch:    1,
	}
	if err := store.UpsertTask(ctx, launching); err != nil {
		t.Fatalf("UpsertTask(launching) after migration = %v", err)
	}
	tasks, err = store.ListTasks(ctx, "run_from_v2")
	if err != nil || len(tasks) != 2 {
		t.Fatalf("ListTasks() after launching upsert = %#v, %v", tasks, err)
	}
}

func TestResearchV3DatabaseMigratesTraceIDColumn(t *testing.T) {
	dataDirectory := t.TempDir()
	databasePath := filepath.Join(dataDirectory, "domain", "research", "research.sqlite3")
	migrator, err := sqlitemigrate.Open(databasePath, []sqlitemigrate.Migration{
		{
			Version: 1,
			Name:    researchV1MigrationName,
			Up:      researchV1Up,
		},
		{
			Version: 2,
			Name:    researchV2MigrationName,
			Up:      researchV2Up,
		},
		{
			Version: 3,
			Name:    researchV3MigrationName,
			Up:      researchV3Up,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		_ = migrator.Close()
		t.Fatal(err)
	}
	_, err = migrator.DB().Exec(`INSERT INTO research_runs (
		id, conversation_id, query, status, phase, report, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"run_from_v3", "conversation-v3", "old run", RunRunning, PhaseCollecting, "",
		formatResearchTime(time.Now()), formatResearchTime(time.Now()),
	)
	if err != nil {
		_ = migrator.Close()
		t.Fatal(err)
	}
	if err := migrator.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	legacy, err := store.GetRun(ctx, "run_from_v3")
	if err != nil || legacy.TraceID != "" {
		t.Fatalf("migrated legacy run TraceID = %#v, %v; want empty", legacy, err)
	}
	service := NewService(store)
	started, err := service.Start(ctx, "conversation-v3-new", "new run after v4")
	if err != nil {
		t.Fatal(err)
	}
	if !researchTraceIDPattern.MatchString(started.TraceID) {
		t.Fatalf("new run TraceID = %q, want trc_ uuid", started.TraceID)
	}
}

func TestResearchMigrationAcceptsExistingStopColumnWithoutHistory(t *testing.T) {
	dataDirectory := t.TempDir()
	store, err := OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DROP TABLE schema_migrations`); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = OpenStore(dataDirectory)
	if err != nil {
		t.Fatalf("open Research database with existing v2 column and no history: %v", err)
	}
	defer store.Close()
	if _, err := store.db.Exec(`SELECT worker_stop_unconfirmed FROM research_runs LIMIT 0`); err != nil {
		t.Fatalf("Research stop column missing after history rebuild: %v", err)
	}
	if _, err := store.db.Exec(`SELECT trace_id FROM research_runs LIMIT 0`); err != nil {
		t.Fatalf("Research trace id column missing after history rebuild: %v", err)
	}
}

func TestResearchPersistenceRedactsSignedURLsInText(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	rawURL := "https://storage.example.test/file?X-Amz-Credential=synthetic-credential&X-Amz-Signature=synthetic-signature&X-Amz-Security-Token=synthetic-session&X-Goog-Signature=synthetic-google&sig=synthetic-azure&keep=visible"
	run := Run{
		ID: "run_signed_urls", ConversationID: "conversation-signed-urls", Query: "Research this link " + rawURL,
		Status: RunRunning, Phase: PhaseCollecting,
	}
	if err := store.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	storedRun, err := store.GetRun(ctx, run.ID)
	if err != nil || strings.Contains(storedRun.Query, "synthetic-") || !strings.Contains(storedRun.Query, "keep=visible") {
		t.Fatalf("stored run query = %q, %v", storedRun.Query, err)
	}
	task := Task{
		ID: "task_signed_urls", RunID: run.ID, Prompt: "Open " + rawURL,
		Status: TaskCompleted, Result: "Retrieved " + rawURL,
	}
	if err := store.UpsertTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	tasks, err := store.ListTasks(ctx, run.ID)
	if err != nil || strings.Contains(tasks[0].Prompt+tasks[0].Result, "synthetic-") {
		t.Fatalf("stored research task = %#v, %v", tasks, err)
	}
	source, err := store.AddSource(ctx, run.ID, rawURL, "Source "+rawURL, time.Now(), []byte("Extracted "+rawURL))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(source.URL+source.Title, "synthetic-") || !strings.Contains(source.URL, "keep=visible") {
		t.Fatalf("stored source metadata = %#v", source)
	}
	_, extract, err := store.ReadSource(ctx, source.ID)
	if err != nil || strings.Contains(string(extract), "synthetic-") || !strings.Contains(string(extract), "keep=visible") {
		t.Fatalf("stored source extract = %q, %v", extract, err)
	}
	run.Status = RunCompleted
	run.Phase = PhaseFinalizing
	run.Report = "Report cites " + rawURL
	if err := store.UpdateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	storedRun, err = store.GetRun(ctx, run.ID)
	if err != nil || strings.Contains(storedRun.Report, "synthetic-") || !strings.Contains(storedRun.Report, "keep=visible") {
		t.Fatalf("stored research report = %q, %v", storedRun.Report, err)
	}
}

func TestInterruptRunningUpdatesRunsAndTheirRunningTasks(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	running := Run{
		ID:             "run_running",
		ConversationID: "conversation-running",
		Query:          "running query",
		Status:         RunRunning,
		Phase:          PhaseWaiting,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	completed := Run{
		ID:             "run_completed",
		ConversationID: "conversation-completed",
		Query:          "completed query",
		Status:         RunCompleted,
		Phase:          PhaseFinalizing,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	for _, run := range []Run{running, completed} {
		if err := store.CreateRun(ctx, run); err != nil {
			t.Fatal(err)
		}
	}
	for _, task := range []Task{
		{ID: "task_running", RunID: running.ID, Status: TaskRunning},
		{ID: "task_launching", RunID: running.ID, Status: TaskLaunching},
		{ID: "task_completed", RunID: running.ID, Status: TaskCompleted},
		{ID: "task_orphaned", RunID: completed.ID, Status: TaskRunning},
	} {
		if err := store.UpsertTask(ctx, task); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.InterruptRunning(ctx); err != nil {
		t.Fatal(err)
	}

	gotRunning, err := store.GetRun(ctx, running.ID)
	if err != nil || gotRunning.Status != RunInterrupted {
		t.Fatalf("running run after interruption = %#v, %v", gotRunning, err)
	}
	gotCompleted, err := store.GetRun(ctx, completed.ID)
	if err != nil || gotCompleted.Status != RunCompleted {
		t.Fatalf("completed run after interruption = %#v, %v", gotCompleted, err)
	}
	runningTasks, err := store.ListTasks(ctx, running.ID)
	if err != nil || len(runningTasks) != 3 || runningTasks[0].Status != TaskCompleted ||
		runningTasks[1].Status != TaskInterrupted || runningTasks[2].Status != TaskInterrupted {
		t.Fatalf("running run tasks after interruption = %#v, %v", runningTasks, err)
	}
	completedTasks, err := store.ListTasks(ctx, completed.ID)
	if err != nil || len(completedTasks) != 1 || completedTasks[0].Status != TaskRunning {
		t.Fatalf("non-running run task after interruption = %#v, %v", completedTasks, err)
	}
}

func TestAddSourceRejectsInvalidURLsAndContentBounds(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	run := Run{
		ID:             "run_validation",
		ConversationID: "conversation-validation",
		Query:          "validation query",
		Status:         RunRunning,
		Phase:          PhaseCollecting,
	}
	if err := store.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	validData := []byte("content")
	for _, test := range []struct {
		name string
		url  string
		data []byte
	}{
		{name: "non-http scheme", url: "file:///etc/passwd", data: validData},
		{name: "empty content", url: "https://example.test", data: nil},
		{name: "oversize content", url: "https://example.test", data: make([]byte, maxSourceBytes+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := store.AddSource(ctx, run.ID, test.url, "title", time.Now(), test.data); err == nil {
				t.Fatal("AddSource() succeeded for invalid input")
			}
		})
	}
	sources, err := store.ListSources(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 0 {
		t.Fatalf("invalid source inputs created records: %#v", sources)
	}
}
