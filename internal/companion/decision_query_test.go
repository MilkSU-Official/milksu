package companion

import (
	"context"
	"strings"
	"testing"
	"time"
)

// decision_answer 事件按查询 id 交给等待方。
func TestResolveDecisionAnswerDelivers(t *testing.T) {
	r := NewRuntime(RuntimeOptions{})
	ch := make(chan decisionAnswer, 1)
	r.decisionPending = map[string]decisionWait{"dq-1": {ch: ch}}

	r.resolveDecisionAnswer(map[string]any{"type": "decision_answer", "id": "dq-1", "text": " 0.7 "})

	answer := <-ch
	if answer.err != nil || answer.text != "0.7" {
		t.Fatalf("got %+v", answer)
	}
	if len(r.decisionPending) != 0 {
		t.Fatal("answered query must be removed")
	}
}

// 侧车回的错误原样上交，决策层按 fail-open 处理。
func TestResolveDecisionAnswerError(t *testing.T) {
	r := NewRuntime(RuntimeOptions{})
	ch := make(chan decisionAnswer, 1)
	r.decisionPending = map[string]decisionWait{"dq-2": {ch: ch}}

	r.resolveDecisionAnswer(map[string]any{"type": "decision_answer", "id": "dq-2", "error": "model down"})

	answer := <-ch
	if answer.err == nil || !strings.Contains(answer.err.Error(), "model down") {
		t.Fatalf("got %+v", answer)
	}
}

// 没人等待的答案（已超时）安静丢弃。
func TestResolveDecisionAnswerDropsUnknown(t *testing.T) {
	r := NewRuntime(RuntimeOptions{})
	r.resolveDecisionAnswer(map[string]any{"type": "decision_answer", "id": "dq-gone", "text": "0.1"})
}

// 侧车退出时等待中的问答全部以错误收尾。
func TestFailDecisionPending(t *testing.T) {
	r := NewRuntime(RuntimeOptions{})
	ch := make(chan decisionAnswer, 1)
	r.decisionPending = map[string]decisionWait{"dq-3": {ch: ch}}

	r.failDecisionPending()

	answer := <-ch
	if answer.err == nil {
		t.Fatalf("got %+v", answer)
	}
	if len(r.decisionPending) != 0 {
		t.Fatal("failed queries must be drained")
	}
}

// 侧车没在跑时 queryModel 直接报错，不挂起。
func TestQueryModelSidecarNotRunning(t *testing.T) {
	r := NewRuntime(RuntimeOptions{})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := r.queryModel(ctx, "sys", "prompt"); err == nil {
		t.Fatal("queryModel must fail when the sidecar is not running")
	}
}
