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
	"github.com/MilkSU-Official/milksu/internal/modelusage"
	"github.com/MilkSU-Official/milksu/internal/research"
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
	if modelusage.SupportedDatabaseVersion != 1 {
		t.Fatalf(
			"SupportedDatabaseVersion = %d, want 1",
			modelusage.SupportedDatabaseVersion,
		)
	}
	if research.SupportedDatabaseVersion != 4 {
		t.Fatalf(
			"research.SupportedDatabaseVersion = %d, want 4",
			research.SupportedDatabaseVersion,
		)
	}
	descriptors := databaseCompatDescriptors()
	want := []appdata.DatabaseDescriptor{
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
	eventsPath := filepath.Join(dataDirectory, "data", "runtime", "events.sqlite3")
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
	usageStore, err := modelusage.NewStore(
		filepath.Join(dataDirectory, "data", "stores", "usage", "model-usage.sqlite3"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := usageStore.Close(); err != nil {
		t.Fatal(err)
	}
	researchStore, err := research.OpenStore(filepath.Join(dataDirectory, "data"))
	if err != nil {
		t.Fatal(err)
	}
	if err := researchStore.Close(); err != nil {
		t.Fatal(err)
	}

	app := &App{homeDirectory: dataDirectory, dataDirectory: filepath.Join(dataDirectory, "data")}
	status, err := app.GetLocalDataStatus()
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Databases) != 3 {
		t.Fatalf("databases count = %d, want 3: %#v", len(status.Databases), status.Databases)
	}

	eventStore := status.Databases[0]
	if eventStore.LogicalName != "EventStore" ||
		eventStore.RelativePath != "data/runtime/events.sqlite3" ||
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

	usageStatus := status.Databases[1]
	if usageStatus.LogicalName != "Coding Agent Usage" ||
		usageStatus.RelativePath != "data/stores/usage/model-usage.sqlite3" ||
		usageStatus.State != "compatible" {
		t.Fatalf("unexpected Coding Agent Usage status: %#v", usageStatus)
	}
	if usageStatus.Current == nil || *usageStatus.Current != 1 ||
		usageStatus.Supported == nil || *usageStatus.Supported != modelusage.SupportedDatabaseVersion {
		t.Fatalf("unexpected Coding Agent Usage versions: %#v", usageStatus)
	}

	researchStatus := status.Databases[2]
	if researchStatus.LogicalName != "Research" ||
		researchStatus.RelativePath != "data/domain/research/research.sqlite3" ||
		researchStatus.State != "compatible" ||
		researchStatus.Current == nil || *researchStatus.Current != research.SupportedDatabaseVersion ||
		researchStatus.Supported == nil || *researchStatus.Supported != research.SupportedDatabaseVersion {
		t.Fatalf("unexpected Research database status: %#v", researchStatus)
	}
}
