package evalsuite

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

const (
	sessionPrefix    = "milksu_eval_"
	maxActivitySteps = 40
	maxDetailRunes   = 800
	defaultTimeout   = 8 * time.Minute
	maxScoreHistory  = 8
)

var flagPattern = regexp.MustCompile(`(?:HTB|APB)\{[A-Za-z0-9_?!.*-]{8,120}\}`)

type Sender func(sessionID, prompt, workspace string, settings config.AppSettings, source string) error

type Aborter func(sessionID string) error

type Service struct {
	mu        sync.Mutex
	store     *Store
	root      string
	send      Sender
	abort     Aborter
	emit      func(BoardSnapshot)
	run       *activeRun
	lastErr   *Progress
	lastSuite string
	settings  config.AppSettings
}

type activeRun struct {
	cancel     context.CancelFunc
	sessionID  string
	workspace  string
	suite      string
	all        bool
	models     []ModelRef
	modelIndex int
	taskIndex  int
	startedAt  time.Time
	taskStart  time.Time
	progress   Progress
	assistant  strings.Builder
	steps      []ActivityStep
	stepIndex  map[string]int
	settled    bool
}

func NewService(send Sender, abort Aborter, emit func(BoardSnapshot)) (*Service, error) {
	store, err := NewStore()
	if err != nil {
		return nil, err
	}
	base, err := appdata.Directory()
	if err != nil {
		return nil, err
	}
	root := filepath.Join(base, "evalsuite", "runs")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create eval run directory: %w", err)
	}
	return &Service{store: store, root: root, send: send, abort: abort, emit: emit}, nil
}

func NewServiceAt(store *Store, root string, send Sender, abort Aborter, emit func(BoardSnapshot)) (*Service, error) {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create eval run directory: %w", err)
	}
	return &Service{store: store, root: root, send: send, abort: abort, emit: emit}, nil
}

func (s *Service) SetSettings(settings config.AppSettings) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.settings = settings
}

func (s *Service) Snapshot(selected string, catalog []ModelRef) (BoardSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked(selected, catalog)
}

func (s *Service) Start(req StartRequest, catalog []ModelRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.run != nil {
		return fmt.Errorf("已有评测在进行")
	}
	tasks := TasksFor(req.Suite)
	if len(tasks) == 0 {
		return fmt.Errorf("该套件还不能评测")
	}
	models := []ModelRef{{Provider: req.Provider, Model: req.Model, Source: req.Source}}
	if len(req.Models) > 0 {
		models = append([]ModelRef(nil), req.Models...)
	}
	if len(models) == 0 || models[0].Model == "" {
		return fmt.Errorf("选择一个模型")
	}
	s.lastErr = nil
	s.lastSuite = req.Suite
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout*time.Duration(len(models)*len(tasks)))
	run := &activeRun{
		cancel:    cancel,
		suite:     req.Suite,
		all:       len(models) > 1,
		models:    models,
		startedAt: time.Now(),
		taskStart: time.Now(),
		stepIndex: map[string]int{},
		progress: Progress{
			State:      StateRunning,
			Suite:      req.Suite,
			Model:      models[0],
			All:        len(models) > 1,
			Percent:    4,
			TaskTotal:  len(tasks),
			ModelTotal: len(models),
			Summary:    "正在开始",
		},
	}
	s.run = run
	s.publishLocked(catalog)
	go s.drive(ctx, catalog)
	return nil
}

func (s *Service) Stop() error {
	s.mu.Lock()
	run := s.run
	s.mu.Unlock()
	if run == nil {
		return nil
	}
	run.cancel()
	if s.abort != nil && run.sessionID != "" {
		_ = s.abort(run.sessionID)
	}
	s.mu.Lock()
	if s.run == run {
		s.run.progress.State = StateStopping
		s.run.progress.Summary = "正在停止"
	}
	s.publishLocked(nil)
	s.mu.Unlock()
	return nil
}

func (s *Service) Observe(event engine.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run := s.run
	if run == nil || run.sessionID == "" || event.SessionID != run.sessionID {
		return
	}
	switch event.Type {
	case "tool.started":
		summary := toolSummary(event.ToolName, event.Input)
		step := ActivityStep{
			ID:      event.ToolCallID,
			Tool:    event.ToolName,
			Summary: summary,
			Detail:  clip(event.Input, maxDetailRunes),
			Running: true,
		}
		if event.ToolCallID != "" {
			run.stepIndex[event.ToolCallID] = len(run.steps)
		}
		run.steps = append(run.steps, step)
		if len(run.steps) > maxActivitySteps {
			run.steps = run.steps[len(run.steps)-maxActivitySteps:]
			run.stepIndex = map[string]int{}
			for i, item := range run.steps {
				if item.ID != "" {
					run.stepIndex[item.ID] = i
				}
			}
		}
		run.progress.Summary = summary
	case "tool.completed":
		if index, ok := run.stepIndex[event.ToolCallID]; ok && index >= 0 && index < len(run.steps) {
			run.steps[index].Running = false
			run.steps[index].DurationMS = event.DurationMS
			if event.Error != "" {
				run.steps[index].Detail = clip(event.Error, maxDetailRunes)
			} else if event.Text != "" {
				run.steps[index].Detail = clip(event.Text, maxDetailRunes)
			}
			run.progress.Summary = run.steps[index].Summary
		}
	case "assistant.delta":
		run.assistant.WriteString(event.Text)
		if strings.TrimSpace(run.progress.Summary) == "" || run.progress.Summary == "正在开始" {
			run.progress.Summary = "正在推理"
		}
	case "assistant.completed":
		if event.Text != "" {
			run.assistant.Reset()
			run.assistant.WriteString(event.Text)
		}
		run.progress.Summary = "正在判定"
	case "assistant.settled":
		run.settled = true
		if strings.TrimSpace(run.progress.Summary) == "" {
			run.progress.Summary = "正在判定"
		}
	case "engine.error", "engine.protocol_error", "engine.stopped":
		kind, display := classifyError(firstNonEmpty(event.Error, event.Text))
		run.progress.ErrorKind = kind
		run.progress.Error = display
		if kind != ErrorKindStopped {
			run.progress.Summary = display
		}
	}
	run.progress.Steps = append([]ActivityStep(nil), run.steps...)
	run.progress.ElapsedMS = time.Since(run.startedAt).Milliseconds()
	s.refreshRemainLocked()
	s.publishLocked(nil)
}

func (s *Service) drive(ctx context.Context, catalog []ModelRef) {
	defer func() {
		s.mu.Lock()
		if s.run != nil {
			s.run.cancel()
			if s.run.progress.ErrorKind != "" && s.run.progress.ErrorKind != ErrorKindStopped {
				copied := s.run.progress
				copied.State = StateIdle
				s.lastErr = &copied
			} else if s.run.progress.ErrorKind == ErrorKindStopped {
				s.lastErr = nil
			}
		}
		s.run = nil
		s.publishLocked(catalog)
		s.mu.Unlock()
	}()

	s.mu.Lock()
	run := s.run
	s.mu.Unlock()
	if run == nil {
		return
	}
	tasks := TasksFor(run.suite)
	for modelIndex, model := range run.models {
		solved := 0
		units := 0
		scoreSum := 0.0
		curve := make([]float64, 0, len(tasks))
		for taskIndex, task := range tasks {
			if ctx.Err() != nil {
				s.finishError(ctx.Err())
				return
			}
			workspace := filepath.Join(s.root, fmt.Sprintf("%d-%s", nowMillis(), task.ID))
			if err := materialize(task, workspace); err != nil {
				s.finishError(err)
				return
			}
			cleanup, err := startHarness(task, workspace)
			if err != nil {
				s.finishError(err)
				return
			}
			sessionID := fmt.Sprintf("%s%d", sessionPrefix, nowMillis())
			s.mu.Lock()
			if s.run != run {
				s.mu.Unlock()
				cleanup()
				return
			}
			run.sessionID = sessionID
			run.workspace = workspace
			run.modelIndex = modelIndex
			run.taskIndex = taskIndex
			run.taskStart = time.Now()
			run.assistant.Reset()
			run.steps = nil
			run.stepIndex = map[string]int{}
			run.settled = false
			run.progress.Model = model
			run.progress.TaskName = task.Name
			run.progress.TaskIndex = taskIndex + 1
			run.progress.ModelIndex = modelIndex + 1
			run.progress.Summary = task.Name
			run.progress.Percent = percent(modelIndex, len(run.models), taskIndex, len(tasks))
			s.refreshRemainLocked()
			s.publishLocked(catalog)
			settings := s.settings
			s.mu.Unlock()

			settings.ActiveProvider = model.Provider
			settings.ActiveModel = model.Model
			if err := s.send(sessionID, task.Prompt, workspace, settings, model.Source); err != nil {
				cleanup()
				s.finishError(err)
				return
			}
			waitErr := s.waitSettled(ctx, sessionID)
			s.mu.Lock()
			assistant := ""
			if s.run == run {
				assistant = run.assistant.String()
			}
			s.mu.Unlock()
			result, gradeErr := grade(task, workspace, assistant)
			cleanup()
			if waitErr != nil {
				s.finishError(waitErr)
				return
			}
			if gradeErr != nil {
				s.finishError(gradeErr)
				return
			}
			s.mu.Lock()
			if s.run != run {
				s.mu.Unlock()
				return
			}
			if run.progress.ErrorKind != "" {
				s.mu.Unlock()
				return
			}
			solved += result.Hits
			units += result.Total
			scoreSum += result.Score
			rate := 0.0
			if taskIndex+1 > 0 {
				rate = 100 * scoreSum / float64(taskIndex+1)
			}
			curve = append(curve, rate)
			s.mu.Unlock()
		}
		score := 0.0
		if units > 0 {
			score = 100 * float64(solved) / float64(units)
		}
		s.commitScore(run.suite, model, solved, units, score, curve)
		s.mu.Lock()
		if s.run == run {
			_ = s.store.PutDuration(run.suite, time.Since(run.taskStart).Milliseconds())
		}
		s.mu.Unlock()
	}
}

func (s *Service) waitSettled(ctx context.Context, sessionID string) error {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			if s.abort != nil {
				_ = s.abort(sessionID)
			}
			return ctx.Err()
		case <-ticker.C:
			s.mu.Lock()
			run := s.run
			if run == nil || run.sessionID != sessionID {
				s.mu.Unlock()
				return nil
			}
			if run.progress.ErrorKind != "" {
				kind := run.progress.ErrorKind
				s.mu.Unlock()
				if kind == ErrorKindStopped {
					return context.Canceled
				}
				return fmt.Errorf("%s", run.progress.Error)
			}
			settled := run.settled
			elapsed := time.Since(run.taskStart)
			s.mu.Unlock()
			if settled {
				return nil
			}
			if elapsed > defaultTimeout {
				if s.abort != nil {
					_ = s.abort(sessionID)
				}
				return fmt.Errorf("timeout")
			}
		}
	}
}

func (s *Service) commitScore(suite string, model ModelRef, solved, total int, score float64, curve []float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	board, err := s.store.Load()
	if err != nil {
		return
	}
	previous := board.Scores[suite][model.Key()]
	runs := append(append([]float64(nil), previous.Runs...), score)
	if len(runs) > maxScoreHistory {
		runs = runs[len(runs)-maxScoreHistory:]
	}
	record := ScoreRecord{
		Model:     model,
		Solved:    solved,
		Total:     total,
		Score:     score,
		Curve:     curve,
		Runs:      runs,
		UpdatedAt: nowMillis(),
	}
	_ = s.store.PutScore(suite, record)
}

func (s *Service) finishError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.run == nil {
		return
	}
	if err == context.Canceled || err == context.DeadlineExceeded {
		kind, display := classifyError(err.Error())
		s.run.progress.State = StateIdle
		s.run.progress.ErrorKind = kind
		s.run.progress.Error = display
		if kind == ErrorKindStopped {
			s.run.progress.Summary = ""
		} else if display != "" {
			s.run.progress.Summary = display
		}
		return
	}
	kind, display := classifyError(err.Error())
	s.run.progress.ErrorKind = kind
	s.run.progress.Error = display
	s.run.progress.Summary = display
}

func (s *Service) snapshotLocked(selected string, catalog []ModelRef) (BoardSnapshot, error) {
	if selected == "" {
		selected = s.lastSuite
	}
	if selected == "" {
		selected = SuiteCybench
	}
	board, err := s.store.Load()
	if err != nil {
		return BoardSnapshot{}, err
	}
	suites := Suites()
	all := make([]SuiteBoard, 0, len(suites))
	var models []BoardModel
	var seen map[string]ScoreRecord
	for _, suite := range suites {
		suiteModels, suiteSeen := boardModelsFor(board.Scores[suite.ID], catalog, suite.ID)
		all = append(all, SuiteBoard{Suite: suite, Models: suiteModels})
		if suite.ID == selected {
			models = suiteModels
			seen = suiteSeen
		}
	}
	var focused *ScoreRecord
	var progress *Progress
	evalModel := ModelRef{}
	if s.run != nil {
		p := s.run.progress
		p.ElapsedMS = time.Since(s.run.startedAt).Milliseconds()
		p.Steps = append([]ActivityStep(nil), s.run.steps...)
		progress = &p
		evalModel = s.run.progress.Model
	} else if s.lastErr != nil {
		copied := *s.lastErr
		progress = &copied
	}
	if record, ok := seen[evalModel.Key()]; ok {
		value := record
		focused = &value
	}
	return BoardSnapshot{
		Suites:   suites,
		Selected: selected,
		Models:   models,
		All:      all,
		Focused:  focused,
		Progress: progress,
	}, nil
}

func boardModelsFor(scores map[string]ScoreRecord, catalog []ModelRef, suite string) ([]BoardModel, map[string]ScoreRecord) {
	scored := make([]ScoreRecord, 0, len(scores))
	seen := map[string]ScoreRecord{}
	listed := map[string]bool{}
	for _, record := range scores {
		if !record.Model.usable() {
			continue
		}
		key := record.Model.Key()
		if listed[key] {
			continue
		}
		seen[key] = record
		listed[key] = true
		scored = append(scored, record)
	}
	sortScores(scored)
	models := make([]BoardModel, 0, len(scored))
	for index, record := range scored {
		current := record
		score := current.Score
		solved := current.Solved
		position := index + 1
		if index > 0 && scored[index-1].Score == current.Score {
			position = *models[index-1].Rank
		}
		models = append(models, BoardModel{
			Model:  current.Model,
			Score:  &score,
			Rank:   &position,
			Solved: &solved,
			Total:  current.Total,
			Curve:  current.Curve,
			Runs:   current.Runs,
		})
	}
	return models, seen
}

func (s *Service) publishLocked(catalog []ModelRef) {
	if s.emit == nil {
		return
	}
	selected := s.lastSuite
	if s.run != nil {
		selected = s.run.suite
	}
	if selected == "" {
		selected = SuiteCybench
	}
	snapshot, err := s.snapshotLocked(selected, catalog)
	if err != nil {
		return
	}
	s.emit(snapshot)
}

func (s *Service) refreshRemainLocked() {
	if s.run == nil {
		return
	}
	board, err := s.store.Load()
	if err != nil {
		return
	}
	typical := board.Durations[s.run.suite]
	if typical <= 0 {
		s.run.progress.RemainMS = 0
		return
	}
	tasksLeft := (len(s.run.models)-s.run.modelIndex-1)*s.run.progress.TaskTotal + (s.run.progress.TaskTotal - s.run.progress.TaskIndex)
	if tasksLeft < 0 {
		tasksLeft = 0
	}
	elapsedTask := time.Since(s.run.taskStart).Milliseconds()
	remain := typical - elapsedTask + typical*int64(tasksLeft)
	if remain < 0 {
		remain = 0
	}
	s.run.progress.RemainMS = remain
}

func percent(modelIndex, modelTotal, taskIndex, taskTotal int) int {
	if modelTotal == 0 || taskTotal == 0 {
		return 0
	}
	done := modelIndex*taskTotal + taskIndex
	value := 4 + (done * 90 / (modelTotal * taskTotal))
	if value > 96 {
		return 96
	}
	if value < 4 {
		return 4
	}
	return value
}

func readCandidate(workspace, assistant string) string {
	data, err := os.ReadFile(filepath.Join(workspace, "flag.txt"))
	if err == nil {
		candidate := strings.TrimSpace(string(data))
		if candidate != "" {
			return candidate
		}
	}
	match := flagPattern.FindString(assistant)
	return strings.TrimSpace(match)
}

func toolSummary(name, input string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "正在调用工具"
	}
	path := firstPath(input)
	switch name {
	case "read":
		if path != "" {
			return "读取 " + path
		}
		return "读取文件"
	case "write", "edit":
		if path != "" {
			return "写入 " + path
		}
		return "编辑文件"
	case "bash":
		cmd := firstLine(input)
		if cmd != "" {
			return cmd
		}
		return "运行命令"
	case "ls", "find", "grep":
		return "检索文件"
	default:
		return name
	}
}

func firstPath(input string) string {
	for _, line := range strings.Split(input, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		for _, field := range fields {
			clean := strings.Trim(field, `"'`)
			if strings.Contains(clean, ".") || strings.Contains(clean, "/") {
				return filepath.Base(clean)
			}
		}
	}
	return ""
}

func firstLine(input string) string {
	line := strings.TrimSpace(strings.Split(input, "\n")[0])
	if utf8.RuneCountInString(line) > 48 {
		runes := []rune(line)
		return string(runes[:48]) + "…"
	}
	return line
}

func clip(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "…"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func sortScores(values []ScoreRecord) {
	for i := 0; i < len(values); i++ {
		for j := i + 1; j < len(values); j++ {
			if values[j].Score > values[i].Score || (values[j].Score == values[i].Score && values[j].UpdatedAt > values[i].UpdatedAt) {
				values[i], values[j] = values[j], values[i]
			}
		}
	}
}
