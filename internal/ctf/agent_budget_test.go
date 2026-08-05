package ctf

import (
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestEvaluateAgentBudgetUsesPersistedRuntimeFacts(t *testing.T) {
	startedAt := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	projection := Projection{
		Challenge: ChallengeView{
			AgentPolicy: AgentWorkspacePolicy{
				Budget: AgentWorkspaceBudget{
					MaxTurns: 4, MaxWallMinutes: 30, MaxWrongSubmissions: 2,
				},
			},
		},
		Attempts: []securityruntime.Attempt{
			{Engine: "fixture", StartedAt: startedAt.Add(-time.Hour)},
			{
				Engine: "pi", StartedAt: startedAt,
				FinishedAt: timePointer(startedAt.Add(90 * time.Second)),
			},
			{
				Engine: "pi", StartedAt: startedAt.Add(2 * time.Minute),
				FinishedAt: timePointer(startedAt.Add(3 * time.Minute)),
			},
		},
		Submissions: []SubmissionView{
			{Verdict: securityruntime.VerdictFail},
			{Verdict: securityruntime.VerdictNeedsReview},
		},
	}

	status := EvaluateAgentBudget(projection, startedAt.Add(12*time.Minute+9*time.Second))
	if status.UsedTurns != 2 ||
		status.RemainingTurns != 2 ||
		status.ElapsedWallSeconds != 2*60+30 ||
		status.RemainingWallSeconds != 27*60+30 ||
		status.WrongSubmissions != 1 ||
		status.RemainingWrongSubmissions != 1 ||
		status.Exhausted ||
		status.Reason != "" ||
		status.FirstTurnStartedAt == nil ||
		!status.FirstTurnStartedAt.Equal(startedAt) {
		t.Fatalf("unexpected live Agent budget status: %#v", status)
	}
}

func TestEvaluateAgentBudgetDoesNotChargeBreaksBetweenCompletedTurns(t *testing.T) {
	startedAt := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	projection := Projection{
		Job: securityruntime.Job{ID: "job_breaks"},
		Challenge: ChallengeView{AgentPolicy: AgentWorkspacePolicy{
			Budget: AgentWorkspaceBudget{
				MaxTurns: 8, MaxWallMinutes: 10, MaxWrongSubmissions: 2,
			},
		}},
		AgentRuns: []AgentRunView{
			{
				SessionID:  agentConversationID("job_breaks"),
				StartedAt:  startedAt,
				FinishedAt: timePointer(startedAt.Add(90 * time.Second)),
			},
			{
				SessionID:  agentConversationID("job_breaks"),
				StartedAt:  startedAt.Add(3 * time.Hour),
				FinishedAt: timePointer(startedAt.Add(3*time.Hour + 2*time.Minute)),
			},
		},
	}

	status := EvaluateAgentBudget(projection, startedAt.Add(8*time.Hour))
	if status.ElapsedWallSeconds != 3*60+30 ||
		status.RemainingWallSeconds != 6*60+30 ||
		status.Exhausted {
		t.Fatalf("offline break consumed the Agent runtime budget: %#v", status)
	}
}

func TestEvaluateAgentBudgetUsesHardGatePrecedence(t *testing.T) {
	startedAt := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	base := Projection{
		Challenge: ChallengeView{
			AgentPolicy: AgentWorkspacePolicy{
				Budget: AgentWorkspaceBudget{
					MaxTurns: 2, MaxWallMinutes: 10, MaxWrongSubmissions: 1,
				},
			},
		},
	}

	tests := []struct {
		name       string
		projection Projection
		now        time.Time
		reason     string
	}{
		{
			name: "turns stop before other exhausted dimensions",
			projection: func() Projection {
				value := base
				value.Attempts = []securityruntime.Attempt{
					{Engine: "pi", StartedAt: startedAt},
					{Engine: "pi", StartedAt: startedAt.Add(time.Minute)},
				}
				value.Submissions = []SubmissionView{{Verdict: securityruntime.VerdictFail}}
				return value
			}(),
			now:    startedAt.Add(20 * time.Minute),
			reason: AgentBudgetReasonTurns,
		},
		{
			name: "wall time stops before wrong submissions",
			projection: func() Projection {
				value := base
				value.Attempts = []securityruntime.Attempt{{Engine: "pi", StartedAt: startedAt}}
				value.Submissions = []SubmissionView{{Verdict: securityruntime.VerdictFail}}
				return value
			}(),
			now:    startedAt.Add(10 * time.Minute),
			reason: AgentBudgetReasonWallTime,
		},
		{
			name: "wrong submissions stop remaining turns",
			projection: func() Projection {
				value := base
				value.Submissions = []SubmissionView{{Verdict: securityruntime.VerdictFail}}
				return value
			}(),
			now:    startedAt,
			reason: AgentBudgetReasonWrongSubmissions,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			status := EvaluateAgentBudget(testCase.projection, testCase.now)
			if !status.Exhausted || status.Reason != testCase.reason {
				t.Fatalf("unexpected exhausted budget status: %#v", status)
			}
		})
	}
}

func TestEvaluateAgentSessionBudgetKeepsAgentRolesIndependent(t *testing.T) {
	startedAt := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	projection := Projection{
		AgentRuns: []AgentRunView{
			{
				SessionID: "solver", StartedAt: startedAt,
				FinishedAt: timePointer(startedAt.Add(30 * time.Second)),
			},
			{
				SessionID: "solver", StartedAt: startedAt.Add(time.Minute),
				FinishedAt: timePointer(startedAt.Add(90 * time.Second)),
			},
			{
				SessionID: "strategist", StartedAt: startedAt.Add(4 * time.Minute),
				FinishedAt: timePointer(startedAt.Add(5 * time.Minute)),
			},
		},
		Submissions: []SubmissionView{{Verdict: securityruntime.VerdictFail}},
	}

	strategist := EvaluateAgentSessionBudget(
		projection,
		"strategist",
		AgentWorkspaceBudget{
			MaxTurns: 6, MaxWallMinutes: 10, MaxWrongSubmissions: 1,
		},
		startedAt.Add(5*time.Minute),
		false,
	)
	if strategist.UsedTurns != 1 ||
		strategist.RemainingTurns != 5 ||
		strategist.ElapsedWallSeconds != 60 ||
		strategist.WrongSubmissions != 0 ||
		strategist.Exhausted {
		t.Fatalf("strategist inherited Solver budget facts: %#v", strategist)
	}

	solver := EvaluateAgentSessionBudget(
		projection,
		"solver",
		AgentWorkspaceBudget{
			MaxTurns: 2, MaxWallMinutes: 60, MaxWrongSubmissions: 1,
		},
		startedAt.Add(5*time.Minute),
		true,
	)
	if solver.UsedTurns != 2 ||
		solver.WrongSubmissions != 1 ||
		!solver.Exhausted ||
		solver.Reason != AgentBudgetReasonTurns {
		t.Fatalf("Solver budget did not remain role-local: %#v", solver)
	}
}

func timePointer(value time.Time) *time.Time {
	return &value
}
