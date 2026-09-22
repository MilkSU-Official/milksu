package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/modelpricing"
	"github.com/MilkSU-Official/milksu/internal/modelusage"
)

func (a *App) GetCodingUsageSnapshot() (modelusage.Snapshot, error) {
	if a.modelUsage == nil {
		return modelusage.Snapshot{}, fmt.Errorf("Coding Agent usage ledger is unavailable")
	}
	return a.modelUsage.Snapshot(a.commandContext(), time.Now())
}

func (a *App) recordCodingUsage(event engine.Event) (bool, error) {
	if a.modelUsage == nil {
		return false, nil
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, event.Timestamp)
	if err != nil {
		occurredAt = time.Now().UTC()
	}
	record := modelusage.Record{
		ConversationID: strings.TrimSpace(event.SessionID),
		OccurredAt:     occurredAt,
		Success:        event.Error == "",
	}
	switch event.Type {
	case "usage.recorded":
		if event.Usage == nil || event.Usage.Module != "coding" {
			return false, nil
		}
		if value, parseErr := time.Parse(time.RFC3339Nano, event.Usage.OccurredAt); parseErr == nil {
			record.OccurredAt = value
		}
		record.ID = event.Usage.RecordID
		record.Kind = modelusage.KindModel
		record.Provider = event.Usage.Provider
		record.Model = event.Usage.Model
		record.Source = event.Usage.Source
		record.InputTokens = event.Usage.InputTokens
		record.OutputTokens = event.Usage.OutputTokens
		record.CacheRead = event.Usage.CacheRead
		record.CacheWrite = event.Usage.CacheWrite
		record.Reasoning = event.Usage.Reasoning
		record.TotalTokens = event.Usage.TotalTokens
		record.CostUSD = event.Usage.CostUSD
		record.Success = event.Usage.Success
		if record.CostUSD == 0 {
			if est, ok := modelpricing.EstimateUSD(record.Model, modelpricing.Usage{
				InputTokens:      record.InputTokens,
				OutputTokens:     record.OutputTokens,
				CacheReadTokens:  record.CacheRead,
				CacheWriteTokens: record.CacheWrite,
				ReasoningTokens:  record.Reasoning,
			}); ok {
				record.CostUSD = est
			}
		}
	case "tool.completed":
		if event.Module != "coding" {
			return false, nil
		}
		toolCallID := strings.TrimSpace(event.ToolCallID)
		if toolCallID == "" {
			return false, nil
		}
		record.ID = "tool:" + event.SessionID + ":" + toolCallID
		record.Kind = modelusage.KindTool
		record.ToolName = event.ToolName
		record.DurationMS = event.DurationMS
	case "assistant.settled":
		return a.recordCodingUsageTurn(event, occurredAt)
	default:
		return false, nil
	}
	if err := a.modelUsage.Record(context.Background(), record); err != nil {
		return false, err
	}
	return true, nil
}

func (a *App) recordCodingUsageTurn(event engine.Event, occurredAt time.Time) (bool, error) {
	sessionID := strings.TrimSpace(event.SessionID)
	if sessionID == "" {
		return false, nil
	}
	sinceMs := occurredAt.Add(-2 * time.Hour).UTC().UnixMilli()
	in, out, cr, cw, reason, tot, model, source, err := a.modelUsage.SumModelTokensSince(context.Background(), sessionID, sinceMs)
	if err != nil {
		return false, err
	}
	if tot == 0 && in == 0 && out == 0 {
		return false, nil
	}
	est, _ := modelpricing.EstimateUSD(model, modelpricing.Usage{
		InputTokens: in, OutputTokens: out, CacheReadTokens: cr, CacheWriteTokens: cw, ReasoningTokens: reason,
	})
	turnID := fmt.Sprintf("turn:%s:%d", sessionID, occurredAt.UTC().UnixMilli())
	host := "local"
	kernel := "pi"
	if a.conversations != nil {
		if stored, err := a.conversations.Get(sessionID); err == nil {
			if strings.EqualFold(strings.TrimSpace(stored.Host), "cloud") {
				host = "cloud"
			}
			if strings.EqualFold(strings.TrimSpace(stored.Kernel), "dsh") {
				kernel = "dsh"
			}
		}
	}
	if err := a.modelUsage.RecordTurn(context.Background(), modelusage.Turn{
		ID: turnID, ConversationID: sessionID, Host: host, Kernel: kernel,
		Model: model, Source: source, OccurredAt: occurredAt,
		InputTokens: in, OutputTokens: out, CacheRead: cr, CacheWrite: cw, Reasoning: reason, TotalTokens: tot,
		ModelCostEstUSD: est, SandboxSeconds: 0, SandboxCostEstUSD: 0,
	}); err != nil {
		return false, err
	}
	return true, nil
}
