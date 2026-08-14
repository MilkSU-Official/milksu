package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/engine"
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
	default:
		return false, nil
	}
	if err := a.modelUsage.Record(context.Background(), record); err != nil {
		return false, err
	}
	return true, nil
}
