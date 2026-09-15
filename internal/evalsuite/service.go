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
	maxReplyRunes    = 8000
	defaultTimeout   = 8 * time.Minute
	maxScoreHistory  = 8
)

var flagPattern = regexp.MustCompile(`(?:HTB|APB)\{[A-Za-z0-9_?!.*-]{8,120}\}`)

type Sender func(sessionID, prompt, workspace string, settings config.AppSettings, source, kernel string) error

type Aborter func(sessionID string) error

type Service struct {
	mu           sync.Mutex
	store        *Store
	root         string
	send         Sender
	abort        Aborter
	emit         func(BoardSnapshot)
	run          *activeRun
	lastErr      *Progress
	lastProgress *Progress
	lastSuite    string
	settings     config.AppSettings
}

type activeRun struct {
	cancel     context.CancelFunc
	sessionID  string
	workspace  string
	suite      string
	all        bool
	smoke      bool
	models     []ModelRef
	modelIndex int
	taskIndex  int
	startedAt  time.Time
	taskStart  time.Time
	progress   Progress
	assistant  strings.Builder
	turns      []ReplyTurn
	steps      []ActivityStep
	stepIndex  map[string]int
	settled    bool
	inputTok   int64
	outputTok  int64
	cacheRead  int64
	cacheWrite int64
	costUSD    float64
	taskTimes  []int64
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
	var suiteView SuiteView
	for _, item := range Suites() {
		if item.ID == req.Suite {
			suiteView = item
			break
		}
	}
	tasks := TasksForRun(req.Suite, req.Smoke)
	if len(tasks) == 0 {
		return fmt.Errorf("该套件还不能评测")
	}
	if !suiteView.Runnable {
		if strings.TrimSpace(suiteView.Missing) != "" {
			return fmt.Errorf("%s", suiteView.Missing)
		}
		return fmt.Errorf("该套件还不能评测")
	}
	kernel := NormalizeKernel(req.Kernel)
	models := []ModelRef{{Provider: req.Provider, Model: req.Model, Source: req.Source, Kernel: kernel}}
	if len(req.Models) > 0 {
		models = append([]ModelRef(nil), req.Models...)
	}
	for i := range models {
		models[i].Kernel = kernel
	}
	if len(models) == 0 || models[0].Model == "" {
		return fmt.Errorf("选择一个模型")
	}
	s.lastErr = nil
	s.lastProgress = nil
	s.lastSuite = req.Suite
	ctx, cancel := context.WithTimeout(context.Background(), runBudget(tasks, len(models)))
	run := &activeRun{
		cancel:    cancel,
		suite:     req.Suite,
		all:       len(models) > 1,
		smoke:     req.Smoke,
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
		run.progress.Reply = clip(run.assistant.String(), maxReplyRunes)
		if strings.TrimSpace(run.progress.Summary) == "" || run.progress.Summary == "正在开始" {
			run.progress.Summary = "正在推理"
		}
	case "assistant.completed":
		if event.Text != "" {
			run.assistant.Reset()
			run.assistant.WriteString(event.Text)
		}
		run.progress.Reply = clip(run.assistant.String(), maxReplyRunes)
		run.progress.Summary = "正在判定"
	case "assistant.settled":
		run.settled = true
		if strings.TrimSpace(run.progress.Summary) == "" {
			run.progress.Summary = "正在判定"
		}
	case "usage_recorded":
		if event.Usage != nil {
			run.inputTok += event.Usage.InputTokens
			run.outputTok += event.Usage.OutputTokens
			run.cacheRead += event.Usage.CacheRead
			run.cacheWrite += event.Usage.CacheWrite
			run.costUSD += event.Usage.CostUSD
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
	run.progress.Turns = append([]ReplyTurn(nil), run.turns...)
	run.progress.ElapsedMS = time.Since(run.startedAt).Milliseconds()
	s.refreshRemainLocked()
	s.publishLocked(nil)
}

func (s *Service) drive(ctx context.Context, catalog []ModelRef) {
	defer func() {
		s.mu.Lock()
		if s.run != nil {
			s.run.cancel()
			copied := s.run.progress
			copied.State = StateIdle
			copied.Reply = clip(s.run.assistant.String(), maxReplyRunes)
			copied.Turns = append([]ReplyTurn(nil), s.run.turns...)
			copied.Steps = append([]ActivityStep(nil), s.run.steps...)
			s.lastProgress = &copied
			if s.run.progress.ErrorKind != "" && s.run.progress.ErrorKind != ErrorKindStopped {
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
	tasks := TasksForRun(run.suite, run.smoke)
	for modelIndex, model := range run.models {
		solved := 0
		units := 0
		scoreSum := 0.0
		curve := make([]float64, 0, len(tasks))
		s.mu.Lock()
		if s.run == run {
			run.inputTok = 0
			run.outputTok = 0
			run.cacheRead = 0
			run.cacheWrite = 0
			run.costUSD = 0
			run.taskTimes = nil
		}
		s.mu.Unlock()
		for taskIndex, task := range tasks {
			if ctx.Err() != nil {
				s.finishError(ctx.Err())
				return
			}
			result, taskErr := s.runOneTask(ctx, catalog, run, model, modelIndex, task, taskIndex, len(tasks))
			if taskErr != nil {
				if abortEvalRun(taskErr) {
					s.finishError(taskErr)
					return
				}
				result = Grade{Total: 1}
			}
			s.mu.Lock()
			if s.run != run {
				s.mu.Unlock()
				return
			}
			if run.progress.ErrorKind == ErrorKindStopped {
				s.mu.Unlock()
				return
			}
			s.recordTurnLocked(task, result)
			run.progress.ErrorKind = ""
			run.progress.Error = ""
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
			_ = s.store.PutDuration(run.suite, medianInt(run.taskTimes))
		}
		s.mu.Unlock()
	}
}

func (s *Service) runOneTask(
	ctx context.Context,
	catalog []ModelRef,
	run *activeRun,
	model ModelRef,
	modelIndex int,
	task Task,
	taskIndex, taskTotal int,
) (Grade, error) {
	workspace := filepath.Join(s.root, fmt.Sprintf("%d-%s", nowMillis(), sanitizeTaskID(task.ID)))
	var docker *dockerSession
	cleanup := func() {}
	if task.Kind == KindDocker {
		s.note(run, catalog, model, task, modelIndex, taskIndex, taskTotal, "正在准备环境")
		session, stop, err := startDockerWorkspace(ctx, task, workspace, func(summary string) {
			s.note(run, catalog, model, task, modelIndex, taskIndex, taskTotal, summary)
		})
		if err != nil {
			return Grade{}, err
		}
		docker = session
		cleanup = stop
	} else {
		if err := materialize(task, workspace); err != nil {
			return Grade{}, err
		}
		stop, err := startHarness(task, workspace)
		if err != nil {
			return Grade{}, err
		}
		cleanup = stop
	}
	defer cleanup()

	sessionID := fmt.Sprintf("%s%d", sessionPrefix, nowMillis())
	s.mu.Lock()
	if s.run != run {
		s.mu.Unlock()
		return Grade{}, fmt.Errorf("评测中断")
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
	run.progress.TaskTotal = taskTotal
	run.progress.ModelIndex = modelIndex + 1
	run.progress.Summary = task.Name
	run.progress.Reply = ""
	run.progress.Turns = append([]ReplyTurn(nil), run.turns...)
	run.progress.Percent = percent(modelIndex, len(run.models), taskIndex, taskTotal)
	s.refreshRemainLocked()
	s.publishLocked(catalog)
	settings := s.settings
	s.mu.Unlock()

	settings.ActiveProvider = model.Provider
	settings.ActiveModel = model.Model
	if s.send != nil {
		if err := s.send(sessionID, task.Prompt, workspace, settings, model.Source, NormalizeKernel(model.Kernel)); err != nil {
			return Grade{}, err
		}
	}
	timeout := task.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	waitErr := s.waitSettled(ctx, sessionID, timeout)
	s.mu.Lock()
	assistant := ""
	elapsed := int64(0)
	if s.run == run {
		assistant = run.assistant.String()
		elapsed = time.Since(run.taskStart).Milliseconds()
		run.taskTimes = append(run.taskTimes, elapsed)
	}
	s.mu.Unlock()
	if s.abort != nil && sessionID != "" {
		_ = s.abort(sessionID)
	}
	if waitErr != nil && abortEvalRun(waitErr) {
		return Grade{}, waitErr
	}
	s.note(run, catalog, model, task, modelIndex, taskIndex, taskTotal, "正在判定")
	var result Grade
	var gradeErr error
	if task.Kind == KindDocker {
		result, gradeErr = gradeDocker(ctx, task, docker, workspace)
	} else {
		result, gradeErr = grade(task, workspace, assistant)
	}
	if gradeErr != nil && abortEvalRun(gradeErr) {
		return Grade{}, gradeErr
	}
	if gradeErr != nil {
		return Grade{Total: 1}, nil
	}
	return result, nil
}

func (s *Service) recordTurnLocked(task Task, result Grade) {
	if s.run == nil {
		return
	}
	reply := clip(s.run.assistant.String(), maxReplyRunes)
	s.run.turns = append(s.run.turns, ReplyTurn{
		TaskName: task.Name,
		Reply:    reply,
		Passed:   result.Hits > 0 && result.Hits >= result.Total,
	})
	s.run.assistant.Reset()
	s.run.progress.Reply = ""
	s.run.progress.Turns = append([]ReplyTurn(nil), s.run.turns...)
}

func (s *Service) note(run *activeRun, catalog []ModelRef, model ModelRef, task Task, modelIndex, taskIndex, taskTotal int, summary string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.run != run {
		return
	}
	run.progress.Model = model
	run.progress.TaskName = task.Name
	run.progress.TaskIndex = taskIndex + 1
	run.progress.TaskTotal = taskTotal
	run.progress.ModelIndex = modelIndex + 1
	run.progress.Summary = summary
	s.publishLocked(catalog)
}

func (s *Service) waitSettled(ctx context.Context, sessionID string, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = defaultTimeout
	}
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
			if elapsed > timeout {
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
	var times []int64
	var input, output, cacheRead, cacheWrite int64
	var cost float64
	if s.run != nil {
		times = append([]int64(nil), s.run.taskTimes...)
		input = s.run.inputTok
		output = s.run.outputTok
		cacheRead = s.run.cacheRead
		cacheWrite = s.run.cacheWrite
		cost = s.run.costUSD
	}
	s.mu.Unlock()
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
		Model:        model,
		Solved:       solved,
		Total:        total,
		Score:        score,
		Curve:        curve,
		Runs:         runs,
		UpdatedAt:    nowMillis(),
		MedianTimeMS: medianInt(times),
		TotalTimeMS:  sumInt(times),
		InputTokens:  input,
		OutputTokens: output,
		CacheRead:    cacheRead,
		CacheWrite:   cacheWrite,
		CostUSD:      cost,
	}
	record.TotalTokens = record.InputTokens + record.OutputTokens + record.CacheRead + record.CacheWrite
	if billed := record.InputTokens + record.CacheRead; billed > 0 {
		record.CacheHitPct = 100 * float64(record.CacheRead) / float64(billed)
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
		p.Turns = append([]ReplyTurn(nil), s.run.turns...)
		if p.Reply == "" {
			p.Reply = clip(s.run.assistant.String(), maxReplyRunes)
		}
		progress = &p
		evalModel = s.run.progress.Model
	} else if s.lastProgress != nil {
		copied := *s.lastProgress
		progress = &copied
		evalModel = copied.Model
	} else if s.lastErr != nil {
		copied := *s.lastErr
		progress = &copied
		evalModel = copied.Model
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
			Model:        current.Model,
			Score:        &score,
			Rank:         &position,
			Solved:       &solved,
			Total:        current.Total,
			Curve:        current.Curve,
			Runs:         current.Runs,
			MedianTimeMS: current.MedianTimeMS,
			TotalTokens:  current.TotalTokens,
			CostUSD:      current.CostUSD,
			CacheHitPct:  current.CacheHitPct,
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
			if rankAhead(values[j], values[i]) {
				values[i], values[j] = values[j], values[i]
			}
		}
	}
}

func rankAhead(a, b ScoreRecord) bool {
	if a.Score != b.Score {
		return a.Score > b.Score
	}
	if a.CostUSD != b.CostUSD && (a.CostUSD > 0 || b.CostUSD > 0) {
		return a.CostUSD < b.CostUSD
	}
	if a.MedianTimeMS != b.MedianTimeMS && (a.MedianTimeMS > 0 || b.MedianTimeMS > 0) {
		return a.MedianTimeMS < b.MedianTimeMS
	}
	return a.UpdatedAt > b.UpdatedAt
}

func abortEvalRun(err error) bool {
	if err == nil {
		return false
	}
	if err == context.Canceled {
		return true
	}
	text := err.Error()
	if strings.Contains(text, "需要 Docker") || strings.Contains(text, "拉取镜像") {
		return true
	}
	kind, _ := classifyError(text)
	return kind == ErrorKindStopped || kind == ErrorKindProvider
}

func runBudget(tasks []Task, models int) time.Duration {
	if models < 1 {
		models = 1
	}
	var sum time.Duration
	for _, task := range tasks {
		timeout := task.Timeout
		if timeout <= 0 {
			timeout = defaultTimeout
		}
		sum += timeout + task.VerifierTimeout + 3*time.Minute
	}
	if sum <= 0 {
		sum = defaultTimeout
	}
	return sum * time.Duration(models)
}

func sanitizeTaskID(id string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, id)
	cleaned = strings.Trim(cleaned, "-")
	if cleaned == "" {
		return "task"
	}
	if len(cleaned) > 48 {
		return cleaned[:48]
	}
	return cleaned
}

func medianInt(values []int64) int64 {
	if len(values) == 0 {
		return 0
	}
	cp := append([]int64(nil), values...)
	for i := 0; i < len(cp); i++ {
		for j := i + 1; j < len(cp); j++ {
			if cp[j] < cp[i] {
				cp[i], cp[j] = cp[j], cp[i]
			}
		}
	}
	mid := len(cp) / 2
	if len(cp)%2 == 1 {
		return cp[mid]
	}
	return (cp[mid-1] + cp[mid]) / 2
}

func sumInt(values []int64) int64 {
	var total int64
	for _, value := range values {
		total += value
	}
	return total
}
