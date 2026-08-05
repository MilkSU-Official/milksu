package ctf

import (
	"testing"
	"time"
)

func TestBuildAgentProgressExtractsCurrentRoute(t *testing.T) {
	updatedAt := time.Date(2026, 7, 31, 16, 30, 0, 0, time.UTC)
	notes := []byte(`# 解题状态

## 已确认事实

- 附件是 64 位 ELF，开启 NX。
- main 会把 256 字节读入 64 字节栈缓冲区。

## 当前假设

| 假设 | 依据 | 验证方法 | 状态 |
| --- | --- | --- | --- |
| canary 可直接绕过 | 未看到保护信息 | checksec | 已证伪 |
| 返回地址偏移为 72 | 栈布局与崩溃位置一致 | 本地 cyclic pattern | 验证中 |

## 失败分支

- 重复尝试 64 字节偏移，没有控制返回地址。
- 远端不回显并不代表服务离线。

## 下一步

- 用最小 cyclic pattern 在本地确认 72 字节偏移。
`)
	progress := buildAgentProgress(notes, nil, AgentRunCheckpoint{
		UpdatedAt: updatedAt,
		Metrics:   AgentRunMetrics{ToolCalls: 4},
	})

	if progress.SchemaVersion != AgentProgressSchemaVersion ||
		progress.Phase != "验证中" ||
		progress.LastVerifiedFact != "main 会把 256 字节读入 64 字节栈缓冲区。" ||
		progress.CurrentHypothesis != "返回地址偏移为 72" ||
		progress.NextAction != "用最小 cyclic pattern 在本地确认 72 字节偏移。" ||
		len(progress.DeadEnds) != 2 ||
		progress.NeedsReplan ||
		progress.RecommendedRole != AgentWorkspaceRoleSolver ||
		progress.UpdatedAt != updatedAt {
		t.Fatalf("unexpected agent progress: %#v", progress)
	}
}

func TestBuildAgentProgressRequestsIndependentReplanAfterLoop(t *testing.T) {
	strategy := []byte(`# 策略复盘

## 证据快照

- 已确认服务返回固定长度响应。

## 信息增益最高的唯一下一步

- 对同一请求只改变 Content-Type，比较状态码和响应体哈希。
`)
	progress := buildAgentProgress(nil, strategy, AgentRunCheckpoint{
		UpdatedAt:  time.Now().UTC(),
		ExitReason: "same-tool-failure-repeated",
		Metrics:    AgentRunMetrics{ToolCalls: 6, ToolErrors: 3},
	})

	if progress.Phase != "卡关复盘" ||
		!progress.NeedsReplan ||
		progress.ReplanReason != "同一工具连续失败" ||
		progress.RecommendedRole != AgentWorkspaceRoleStrategist ||
		progress.StrategyNextAction != "对同一请求只改变 Content-Type，比较状态码和响应体哈希。" ||
		progress.NextAction != progress.StrategyNextAction {
		t.Fatalf("unexpected loop recovery progress: %#v", progress)
	}
}

func TestBuildAgentProgressPrioritizesCandidateReview(t *testing.T) {
	progress := buildAgentProgress(nil, nil, AgentRunCheckpoint{
		UpdatedAt:      time.Now().UTC(),
		ExitReason:     "same-tool-call-repeated",
		CandidateCount: 1,
	})
	if progress.Phase != "候选复核" {
		t.Fatalf("candidate should take precedence over replan phase: %#v", progress)
	}
	if !progress.NeedsReplan {
		t.Fatal("loop signal should remain visible while reviewing a candidate")
	}
}
