package main

import (
	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

// databaseCompatDescriptors returns the databases surfaced by
// GetLocalDataStatus in presentation order. Descriptors with Supported == 0
// are "remaining" databases that have not been migrated yet; EventStore
// carries the migration version this build supports. credentials.db is
// intentionally absent. Composition only — no migration rules live here.
func databaseCompatDescriptors() []appdata.DatabaseDescriptor {
	return []appdata.DatabaseDescriptor{
		{
			LogicalName:  "EventStore",
			RelativePath: "runtime/events.sqlite3",
			Supported:    securityruntime.SupportedEventStoreDatabaseVersion,
		},
		{
			LogicalName:  "CTF Memory",
			RelativePath: "ctf/memory.sqlite3",
		},
		{
			LogicalName:  "NSSCTF Catalog",
			RelativePath: "nssctf/catalog.sqlite3",
		},
		{
			LogicalName:  "CTFshow Catalog",
			RelativePath: "ctfshow/catalog.sqlite3",
		},
	}
}
