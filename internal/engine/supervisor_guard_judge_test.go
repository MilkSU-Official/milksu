package engine

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// gateGuardAlarm 的语义表（fail-open 全域）：
//   - 没接线（judge == nil）⇒ 原样放行；
//   - 判官报错（含没配凭据）⇒ 放行；
//   - 判官说"卡住了"（noul >= 0.5）⇒ 放行；
//   - 判官说"合法重复"（noul < 0.5）⇒ 吞掉（不打扰读者）。
func TestGateGuardAlarmForwardsUnlessDecisionConfirmsLegitimate(t *testing.T) {
	cases := []struct {
		name    string
		noJudge bool
		yes     float64
		err     error
		forward bool
	}{
		{name: "no judge wired forwards", noJudge: true, forward: true},
		{name: "judge error forwards", err: errors.New("decision credential not configured"), forward: true},
		{name: "stuck verdict forwards", yes: 0.8, forward: true},
		{name: "boundary verdict forwards", yes: 0.5, forward: true},
		{name: "legitimate repeat is swallowed", yes: 0.3, forward: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			var forwarded []Event
			s := NewSupervisor(func(event Event) {
				mu.Lock()
				defer mu.Unlock()
				forwarded = append(forwarded, event)
			})
			if !tc.noJudge {
				yes := tc.yes
				s.SetGuardJudge(func(context.Context, string, any, string) (float64, error) {
					return yes, tc.err
				})
			}
			raw := bridgeEvent{
				Type:       "guard.alarm",
				ID:         "session-1",
				RepeatLine: "(unchanged)",
				Reason:     "thinking repeated 8 lines: (unchanged)",
				Sample:     []string{"读文件", "(unchanged)"},
			}
			s.gateGuardAlarm(raw, KernelPi)
			mu.Lock()
			count := len(forwarded)
			mu.Unlock()
			if tc.forward && count != 1 {
				t.Fatalf("expected the alarm to forward, got %d events", count)
			}
			if !tc.forward && count != 0 {
				t.Fatalf("expected the alarm to be swallowed, got %d events", count)
			}
			if tc.forward && count == 1 && forwarded[0].Type != "guard.alarm" {
				t.Fatalf("forwarded event must stay guard.alarm, got %q", forwarded[0].Type)
			}
		})
	}
}

// 判官拿到的 state 必须带 repeatLine 与 sample —— 没有上下文，决策层只能瞎猜，
// 那复核就没有意义了。
func TestGateGuardAlarmHandsSampleToJudge(t *testing.T) {
	var gotState any
	var gotSession string
	s := NewSupervisor(func(Event) {})
	s.SetGuardJudge(func(_ context.Context, sessionID string, state any, _ string) (float64, error) {
		gotSession = sessionID
		gotState = state
		return 0.9, nil
	})
	raw := bridgeEvent{
		Type:       "guard.alarm",
		ID:         "session-1",
		RepeatLine: "(unchanged)",
		Sample:     []string{"a", "b"},
	}
	s.gateGuardAlarm(raw, KernelPi)
	if gotSession != "session-1" {
		t.Fatalf("judge must see the alarming session, got %q", gotSession)
	}
	payload, ok := gotState.(map[string]any)
	if !ok {
		t.Fatalf("judge state must be a map, got %T", gotState)
	}
	if payload["repeatLine"] != "(unchanged)" {
		t.Fatalf("repeatLine missing from judge state: %v", payload)
	}
	if len(payload["sample"].([]string)) != 2 {
		t.Fatalf("sample missing from judge state: %v", payload)
	}
}

// 判官挂起（决策端卡住）不许拖死示警：超时后必须放行。
func TestGateGuardAlarmTimeoutForwards(t *testing.T) {
	s := NewSupervisor(func(Event) {})
	s.SetGuardJudge(func(ctx context.Context, _ string, _ any, _ string) (float64, error) {
		<-ctx.Done()
		return 0, ctx.Err()
	})
	raw := bridgeEvent{Type: "guard.alarm", ID: "session-1"}
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.gateGuardAlarm(raw, KernelPi)
	}()
	select {
	case <-done:
	case <-time.After(guardJudgeTimeout + 3*time.Second):
		t.Fatal("gateGuardAlarm did not honour its timeout")
	}
}
