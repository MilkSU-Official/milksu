package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"

	_ "modernc.org/sqlite"
)

func TestDatabaseCompatDescriptors(t *testing.T) {
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
			Supported:    0,
		},
		{
			LogicalName:  "CTFshow Catalog",
			RelativePath: "ctfshow/catalog.sqlite3",
			Supported:    0,
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

	app := &App{dataDirectory: dataDirectory}
	status, err := app.GetLocalDataStatus()
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Databases) != 4 {
		t.Fatalf("databases count = %d, want 4: %#v", len(status.Databases), status.Databases)
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

	for _, remaining := range status.Databases[2:] {
		if remaining.State != "remaining" {
			t.Fatalf(
				"database %q state = %q, want remaining: %#v",
				remaining.LogicalName,
				remaining.State,
				remaining,
			)
		}
		if remaining.Current != nil || remaining.Supported != nil {
			t.Fatalf(
				"database %q must report nil current/supported: %#v",
				remaining.LogicalName,
				remaining,
			)
		}
	}
}
