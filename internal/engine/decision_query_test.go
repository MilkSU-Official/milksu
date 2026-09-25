package engine

import (
	"context"
	"strings"
	"testing"
	"time"
)

// decision_answer 事件按查询 id 交给等待方。
func TestResolveDecisionAnswerDelivers(t *testing.T) {
	s := NewSupervisor(func(Event) {})
	ch := make(chan decisionAnswer, 1)
	s.decisionPending = map[string]decisionWait{"dq-1": {ch: ch}}

	s.resolveDecisionAnswer(bridgeEvent{Type: "decision_answer", ID: "dq-1", Text: "0.7"})

	answer := <-ch
	if answer.err != nil || answer.text != "0.7" {
		t.Fatalf("got %+v", answer)
	}
	if len(s.decisionPending) != 0 {
		t.Fatal("answered query must be removed")
	}
}

// 侧车回的错误原样上交，决策层按 fail-open 处理。
func TestResolveDecisionAnswerError(t *testing.T) {
	s := NewSupervisor(func(Event) {})
	ch := make(chan decisionAnswer, 1)
	s.decisionPending = map[string]decisionWait{"dq-2": {ch: ch}}

	s.resolveDecisionAnswer(bridgeEvent{Type: "decision_answer", ID: "dq-2", Error: "model down"})

	answer := <-ch
	if answer.err == nil || !strings.Contains(answer.err.Error(), "model down") {
		t.Fatalf("got %+v", answer)
	}
}

// 没人等待的答案（已超时）安静丢弃。
func TestResolveDecisionAnswerDropsUnknown(t *testing.T) {
	s := NewSupervisor(func(Event) {})
	s.resolveDecisionAnswer(bridgeEvent{Type: "decision_answer", ID: "dq-gone", Text: "0.1"})
}

// 侧车进程退出时只收尾这辆车的等待，别的进程不受影响。
func TestFailDecisionPendingOnlyItsProcess(t *testing.T) {
	s := NewSupervisor(func(Event) {})
	procA := &childProcess{}
	procB := &childProcess{}
	chA := make(chan decisionAnswer, 1)
	chB := make(chan decisionAnswer, 1)
	s.decisionPending = map[string]decisionWait{
		"dq-a": {ch: chA, proc: procA},
		"dq-b": {ch: chB, proc: procB},
	}

	s.failDecisionPending(procA)

	if answer := <-chA; answer.err == nil {
		t.Fatalf("got %+v", answer)
	}
	if len(s.decisionPending) != 1 || s.decisionPending["dq-b"].ch != chB {
		t.Fatalf("other process wait must survive: %v", s.decisionPending)
	}
}

// 会话没有侧车在跑时 QuerySessionModel 直接报错，不挂起。
func TestQuerySessionModelNoSidecar(t *testing.T) {
	s := NewSupervisor(func(Event) {})
	s.BindSessionKernel("conv-1", KernelPi)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := s.QuerySessionModel(ctx, "conv-1", "sys", "prompt"); err == nil {
		t.Fatal("QuerySessionModel must fail when no sidecar serves the session")
	}
}
