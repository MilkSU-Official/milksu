package main

import (
	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/modelusage"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
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
			LogicalName:  "CTF Memory",
			RelativePath: "data/domain/ctf/memory.sqlite3",
			Supported:    ctf.SupportedCTFMemoryDatabaseVersion,
		},
		{
			LogicalName:  "NSSCTF Catalog",
			RelativePath: "data/domain/nssctf/catalog.sqlite3",
			Supported:    nssctf.SupportedNSSCTFCatalogDatabaseVersion,
		},
		{
			LogicalName:  "CTFshow Catalog",
			RelativePath: "data/domain/ctfshow/catalog.sqlite3",
			Supported:    ctfshow.SupportedCTFshowCatalogDatabaseVersion,
		},
		{
			LogicalName:  "Coding Agent Usage",
			RelativePath: "data/stores/usage/model-usage.sqlite3",
			Supported:    modelusage.SupportedDatabaseVersion,
		},
	}
}
