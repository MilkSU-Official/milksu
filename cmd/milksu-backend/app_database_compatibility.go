package main

import (
	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/modelusage"
	"github.com/MilkSU-Official/milksu/internal/research"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

// databaseCompatDescriptors returns the databases surfaced by
// GetLocalDataStatus in presentation order. Descriptors with Supported == 0
// are "remaining" databases that have not been migrated yet. credentials.db is
// intentionally absent. Composition only — no migration rules live here.
func databaseCompatDescriptors() []appdata.DatabaseDescriptor {
	return []appdata.DatabaseDescriptor{
		{
			LogicalName:  "EventStore",
			RelativePath: "data/runtime/events.sqlite3",
			Supported:    securityruntime.SupportedEventStoreDatabaseVersion,
		},
		{
			LogicalName:  "Coding Agent Usage",
			RelativePath: "data/stores/usage/model-usage.sqlite3",
			Supported:    modelusage.SupportedDatabaseVersion,
		},
		{
			LogicalName:  "Research",
			RelativePath: "data/domain/research/research.sqlite3",
			Supported:    research.SupportedDatabaseVersion,
		},
	}
}
