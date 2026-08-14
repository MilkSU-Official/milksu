package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/modelusage"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"

	_ "modernc.org/sqlite"
)

func TestDatabaseCompatDescriptors(t *testing.T) {
	if config.SupportedCredentialsDatabaseVersion != 1 {
		t.Fatalf(
			"SupportedCredentialsDatabaseVersion = %d, want 1",
			config.SupportedCredentialsDatabaseVersion,
		)
	}
	if securityruntime.SupportedEventStoreDatabaseVersion != 1 {
		t.Fatalf(
			"SupportedEventStoreDatabaseVersion = %d, want 1",
			securityruntime.SupportedEventStoreDatabaseVersion,
		)
	}
	if ctf.SupportedCTFMemoryDatabaseVersion != 1 {
		t.Fatalf(
			"SupportedCTFMemoryDatabaseVersion = %d, want 1",
			ctf.SupportedCTFMemoryDatabaseVersion,
		)
	}
	if nssctf.SupportedNSSCTFCatalogDatabaseVersion != 1 {
		t.Fatalf(
			"SupportedNSSCTFCatalogDatabaseVersion = %d, want 1",
			nssctf.SupportedNSSCTFCatalogDatabaseVersion,
		)
	}
	if ctfshow.SupportedCTFshowCatalogDatabaseVersion != 1 {
		t.Fatalf(
			"SupportedCTFshowCatalogDatabaseVersion = %d, want 1",
			ctfshow.SupportedCTFshowCatalogDatabaseVersion,
		)
	}
	if modelusage.SupportedDatabaseVersion != 1 {
		t.Fatalf(
			"SupportedDatabaseVersion = %d, want 1",
			modelusage.SupportedDatabaseVersion,
		)
	}
	descriptors := databaseCompatDescriptors()
	want := []appdata.DatabaseDescriptor{
		{
			LogicalName:  "EventStore",
			RelativePath: "runtime/events.sqlite3",
			Supported:    securityruntime.SupportedEventStoreDatabaseVersion,
		},
		{
			LogicalName:  "CTF Memory",
			RelativePath: "ctf/memory.sqlite3",
			Supported:    ctf.SupportedCTFMemoryDatabaseVersion,
		},
		{
			LogicalName:  "NSSCTF Catalog",
			RelativePath: "nssctf/catalog.sqlite3",
			Supported:    nssctf.SupportedNSSCTFCatalogDatabaseVersion,
		},
		{
			LogicalName:  "CTFshow Catalog",
			RelativePath: "ctfshow/catalog.sqlite3",
			Supported:    ctfshow.SupportedCTFshowCatalogDatabaseVersion,
		},
		{
			LogicalName:  "Coding Agent Usage",
			RelativePath: "usage/model-usage.sqlite3",
			Supported:    modelusage.SupportedDatabaseVersion,
		},
	}
	if !reflect.DeepEqual(descriptors, want) {
		t.Fatalf("databaseCompatDescriptors() = %#v, want %#v", descriptors, want)
	}
	for _, descriptor := range descriptors {
		if strings.Contains(strings.ToLower(descriptor.RelativePath), "credentials") {
			t.Fatalf("descriptor must not reference credentials: %#v", descriptor)
		}
	}
}

func TestGetLocalDataStatusIncludesDatabaseCompatibility(t *testing.T) {
	dataDirectory := t.TempDir()
	eventsPath := filepath.Join(dataDirectory, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(eventsPath), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", eventsPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`); err != nil {
		database.Close()
		t.Fatal(err)
	}
	if _, err := database.Exec(
		`INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, 'seed', '2024-01-01T00:00:00Z')`,
	); err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	memoryStore, err := ctf.NewMemoryStore(
		filepath.Join(dataDirectory, "ctf", "memory.sqlite3"),
		filepath.Join(dataDirectory, "ctf", "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := memoryStore.Close(); err != nil {
		t.Fatal(err)
	}
	nssctfCatalog, err := nssctf.NewCatalogService(
		filepath.Join(dataDirectory, "nssctf", "catalog.sqlite3"),
		nssctf.NewClient(nssctf.ClientOptions{}),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := nssctfCatalog.Close(); err != nil {
		t.Fatal(err)
	}
	ctfshowCatalog, err := ctfshow.NewCatalogService(
		filepath.Join(dataDirectory, "ctfshow", "catalog.sqlite3"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := ctfshowCatalog.Close(); err != nil {
		t.Fatal(err)
	}
	usageStore, err := modelusage.NewStore(
		filepath.Join(dataDirectory, "usage", "model-usage.sqlite3"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := usageStore.Close(); err != nil {
		t.Fatal(err)
	}

	app := &App{dataDirectory: dataDirectory}
	status, err := app.GetLocalDataStatus()
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Databases) != 5 {
		t.Fatalf("databases count = %d, want 5: %#v", len(status.Databases), status.Databases)
	}

	eventStore := status.Databases[0]
	if eventStore.LogicalName != "EventStore" ||
		eventStore.RelativePath != "runtime/events.sqlite3" ||
		eventStore.State != "compatible" {
		t.Fatalf("unexpected EventStore status: %#v", eventStore)
	}
	if eventStore.Current == nil || *eventStore.Current != 1 {
		t.Fatalf("EventStore current = %v, want 1", eventStore.Current)
	}
	if eventStore.Supported == nil ||
		*eventStore.Supported != securityruntime.SupportedEventStoreDatabaseVersion {
		t.Fatalf(
			"EventStore supported = %v, want %d",
			eventStore.Supported,
			securityruntime.SupportedEventStoreDatabaseVersion,
		)
	}

	memory := status.Databases[1]
	if memory.LogicalName != "CTF Memory" ||
		memory.RelativePath != "ctf/memory.sqlite3" ||
		memory.State != "compatible" {
		t.Fatalf("unexpected CTF Memory status: %#v", memory)
	}
	if memory.Current == nil || *memory.Current != 1 {
		t.Fatalf("CTF Memory current = %v, want 1", memory.Current)
	}
	if memory.Supported == nil ||
		*memory.Supported != ctf.SupportedCTFMemoryDatabaseVersion {
		t.Fatalf(
			"CTF Memory supported = %v, want %d",
			memory.Supported,
			ctf.SupportedCTFMemoryDatabaseVersion,
		)
	}

	nssctfStatus := status.Databases[2]
	if nssctfStatus.LogicalName != "NSSCTF Catalog" ||
		nssctfStatus.RelativePath != "nssctf/catalog.sqlite3" ||
		nssctfStatus.State != "compatible" {
		t.Fatalf("unexpected NSSCTF Catalog status: %#v", nssctfStatus)
	}
	if nssctfStatus.Current == nil || *nssctfStatus.Current != 1 {
		t.Fatalf("NSSCTF Catalog current = %v, want 1", nssctfStatus.Current)
	}
	if nssctfStatus.Supported == nil ||
		*nssctfStatus.Supported != nssctf.SupportedNSSCTFCatalogDatabaseVersion {
		t.Fatalf(
			"NSSCTF Catalog supported = %v, want %d",
			nssctfStatus.Supported,
			nssctf.SupportedNSSCTFCatalogDatabaseVersion,
		)
	}

	ctfshowStatus := status.Databases[3]
	if ctfshowStatus.LogicalName != "CTFshow Catalog" ||
		ctfshowStatus.RelativePath != "ctfshow/catalog.sqlite3" ||
		ctfshowStatus.State != "compatible" {
		t.Fatalf("unexpected CTFshow Catalog status: %#v", ctfshowStatus)
	}
	if ctfshowStatus.Current == nil || *ctfshowStatus.Current != 1 {
		t.Fatalf("CTFshow Catalog current = %v, want 1", ctfshowStatus.Current)
	}
	if ctfshowStatus.Supported == nil ||
		*ctfshowStatus.Supported != ctfshow.SupportedCTFshowCatalogDatabaseVersion {
		t.Fatalf(
			"CTFshow Catalog supported = %v, want %d",
			ctfshowStatus.Supported,
			ctfshow.SupportedCTFshowCatalogDatabaseVersion,
		)
	}

	usageStatus := status.Databases[4]
	if usageStatus.LogicalName != "Coding Agent Usage" ||
		usageStatus.RelativePath != "usage/model-usage.sqlite3" ||
		usageStatus.State != "compatible" {
		t.Fatalf("unexpected Coding Agent Usage status: %#v", usageStatus)
	}
	if usageStatus.Current == nil || *usageStatus.Current != 1 ||
		usageStatus.Supported == nil || *usageStatus.Supported != modelusage.SupportedDatabaseVersion {
		t.Fatalf("unexpected Coding Agent Usage versions: %#v", usageStatus)
	}
}
