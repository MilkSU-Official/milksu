package main

import "testing"

// 空命令必须在碰 settings 之前就被拒（&App{} 的 settings 是 nil，能过就说明守卫在前）。
func TestJudgeApprovalRiskRejectsEmptyCommand(t *testing.T) {
	application := &App{}
	if _, err := application.JudgeApprovalRisk("   "); err == nil {
		t.Fatal("an empty command must be rejected before touching settings")
	}
}
