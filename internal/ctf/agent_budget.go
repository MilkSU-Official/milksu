package ctf

import (
	"sort"
	"time"
)

const (
	AgentBudgetReasonTurns            = "turn-budget-exhausted"
	AgentBudgetReasonWallTime         = "time-budget-exhausted"
	AgentBudgetReasonWrongSubmissions = "wrong-submission-budget-exhausted"
)

type AgentBudgetStatus struct {
	Budget                    AgentWorkspaceBudget `json:"budget"`
	UsedTurns                 int                  `json:"usedTurns"`
	RemainingTurns            int                  `json:"remainingTurns"`
	ElapsedWallSeconds        int                  `json:"elapsedWallSeconds"`
	RemainingWallSeconds      int                  `json:"remainingWallSeconds"`
	WrongSubmissions          int                  `json:"wrongSubmissions"`
	RemainingWrongSubmissions int                  `json:"remainingWrongSubmissions"`
	FirstTurnStartedAt        *time.Time           `json:"firstTurnStartedAt,omitempty"`
	CheckedAt                 time.Time            `json:"checkedAt"`
	Exhausted                 bool                 `json:"exhausted"`
	Reason                    string               `json:"reason,omitempty"`
}

func EvaluateAgentBudget(projection Projection, now time.Time) AgentBudgetStatus {
	sessionID := ""
	if projection.Job.ID != "" {
		sessionID = agentConversationID(projection.Job.ID)
	}
	return evaluateAgentSessionBudget(
		projection,
		sessionID,
		projection.Challenge.AgentPolicy.Budget,
		now,
		true,
		true,
	)
}

func EvaluateAgentSessionBudget(
	projection Projection,
	sessionID string,
	budget AgentWorkspaceBudget,
	now time.Time,
	includeWrongSubmissions bool,
) AgentBudgetStatus {
	return evaluateAgentSessionBudget(
		projection,
		sessionID,
		budget,
		now,
		includeWrongSubmissions,
		false,
	)
}

func evaluateAgentSessionBudget(
	projection Projection,
	sessionID string,
	budget AgentWorkspaceBudget,
	now time.Time,
	includeWrongSubmissions bool,
	fallbackToPIAttempts bool,
) AgentBudgetStatus {
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}
	status := AgentBudgetStatus{
		Budget:                    budget,
		RemainingTurns:            budget.MaxTurns,
		RemainingWallSeconds:      budget.MaxWallMinutes * 60,
		RemainingWrongSubmissions: budget.MaxWrongSubmissions,
		CheckedAt:                 now,
	}
	var firstTurn time.Time
	activeIntervals := make([]agentBudgetInterval, 0, len(projection.AgentRuns))
	for _, run := range projection.AgentRuns {
		if run.SessionID != sessionID {
			continue
		}
		status.UsedTurns++
		if firstTurn.IsZero() || run.StartedAt.Before(firstTurn) {
			firstTurn = run.StartedAt
		}
		activeIntervals = appendAgentBudgetInterval(
			activeIntervals,
			run.StartedAt,
			run.FinishedAt,
			now,
		)
	}
	if fallbackToPIAttempts {
		recordedAttempts := make(map[string]struct{}, len(projection.AgentRuns))
		for _, run := range projection.AgentRuns {
			recordedAttempts[run.AttemptID] = struct{}{}
		}
		for _, attempt := range projection.Attempts {
			if attempt.Engine != "pi" {
				continue
			}
			if _, recorded := recordedAttempts[attempt.ID]; recorded {
				continue
			}
			status.UsedTurns++
			if firstTurn.IsZero() || attempt.StartedAt.Before(firstTurn) {
				firstTurn = attempt.StartedAt
			}
			activeIntervals = appendAgentBudgetInterval(
				activeIntervals,
				attempt.StartedAt,
				attempt.FinishedAt,
				now,
			)
		}
	}
	status.RemainingTurns = max(0, budget.MaxTurns-status.UsedTurns)
	if !firstTurn.IsZero() {
		firstTurn = firstTurn.UTC()
		status.FirstTurnStartedAt = &firstTurn
		status.ElapsedWallSeconds = int(mergedAgentBudgetDuration(activeIntervals) / time.Second)
		status.RemainingWallSeconds = max(
			0,
			budget.MaxWallMinutes*60-status.ElapsedWallSeconds,
		)
	}
	if includeWrongSubmissions {
		for _, submission := range projection.Submissions {
			if submission.Verdict == "fail" {
				status.WrongSubmissions++
			}
		}
	}
	status.RemainingWrongSubmissions = max(
		0,
		budget.MaxWrongSubmissions-status.WrongSubmissions,
	)

	switch {
	case status.UsedTurns >= budget.MaxTurns:
		status.Exhausted = true
		status.Reason = AgentBudgetReasonTurns
	case status.FirstTurnStartedAt != nil &&
		status.ElapsedWallSeconds >= budget.MaxWallMinutes*60:
		status.Exhausted = true
		status.Reason = AgentBudgetReasonWallTime
	case status.WrongSubmissions >= budget.MaxWrongSubmissions:
		status.Exhausted = true
		status.Reason = AgentBudgetReasonWrongSubmissions
	}
	return status
}

type agentBudgetInterval struct {
	start time.Time
	end   time.Time
}

func appendAgentBudgetInterval(
	intervals []agentBudgetInterval,
	start time.Time,
	finishedAt *time.Time,
	now time.Time,
) []agentBudgetInterval {
	if start.IsZero() {
		return intervals
	}
	start = start.UTC()
	end := now
	if finishedAt != nil {
		end = finishedAt.UTC()
	}
	if end.After(now) {
		end = now
	}
	if !end.After(start) {
		return intervals
	}
	return append(intervals, agentBudgetInterval{start: start, end: end})
}

func mergedAgentBudgetDuration(intervals []agentBudgetInterval) time.Duration {
	if len(intervals) == 0 {
		return 0
	}
	sort.Slice(intervals, func(left, right int) bool {
		return intervals[left].start.Before(intervals[right].start)
	})
	current := intervals[0]
	var total time.Duration
	for _, interval := range intervals[1:] {
		if !interval.start.After(current.end) {
			if interval.end.After(current.end) {
				current.end = interval.end
			}
			continue
		}
		total += current.end.Sub(current.start)
		current = interval
	}
	return total + current.end.Sub(current.start)
}
