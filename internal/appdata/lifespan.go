package appdata

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

const (
	LifespanFile     = "lifespan.json"
	LifespanSchema   = "milksu-lifespan/v1"
	maxLifespanBytes = 16 * 1024
)

// LifespanExit describes how the most recent MilkSU run ended, as known when
// the next run begins. The process itself only ever writes "running" while it
// is active; a crash, force-quit, power loss or killed process leaves that
// marker behind, so the next startup can detect the abnormal exit.
type LifespanExit string

const (
	// LifespanExitNone is the first-run state: there is no previous record.
	LifespanExitNone LifespanExit = "none"
	// LifespanExitClean means the previous run recorded a normal shutdown.
	LifespanExitClean LifespanExit = "clean"
	// LifespanExitAbnormal means the previous run never recorded a clean exit.
	LifespanExitAbnormal LifespanExit = "abnormal"
	// LifespanExitRunning marks the currently active run.
	LifespanExitRunning LifespanExit = "running"
)

// LifespanState is the persisted marker that survives crashes. It deliberately
// contains no session content, tool output, provider credential or API key,
// only timestamps, the exit classification, the previous process id and a
// crash-streak counter.
type LifespanState struct {
	Schema                   string       `json:"schema"`
	RunID                    string       `json:"runId,omitempty"`
	StartedAt                string       `json:"startedAt,omitempty"`
	LastStartedAt            string       `json:"lastStartedAt,omitempty"`
	LastExit                 LifespanExit `json:"lastExit"`
	LastCleanExitAt          string       `json:"lastCleanExitAt,omitempty"`
	ConsecutiveAbnormalExits int          `json:"consecutiveAbnormalExits"`
	PID                      int          `json:"pid,omitempty"`
	UpdatedAt                string       `json:"updatedAt,omitempty"`
}

// LifespanStart is the summary handed to the desktop runtime at startup so the
// UI can offer a recovery and diagnostics entry after an abnormal exit.
type LifespanStart struct {
	PreviousExit             LifespanExit `json:"previousExit"`
	PreviousStartedAt        string       `json:"previousStartedAt,omitempty"`
	LastCleanExitAt          string       `json:"lastCleanExitAt,omitempty"`
	ConsecutiveAbnormalExits int          `json:"consecutiveAbnormalExits"`
	PreviousPID              int          `json:"previousPid,omitempty"`
	StartedAt                string       `json:"startedAt"`
}

// LifespanHandle is an opaque capability for marking one exact run clean.
// A stale process cannot use an older handle to overwrite a newer run's
// "running" marker.
type LifespanHandle struct {
	runID string
}

func (handle LifespanHandle) Valid() bool {
	return handle.runID != ""
}

// BeginLifespan reads the previous lifespan marker, classifies how the last
// run ended, and records that this run is now active. It returns the startup
// summary used to surface a recovery entry after an abnormal exit.
func BeginLifespan(root string, pid int) (LifespanStart, LifespanHandle, error) {
	root, err := secureRoot(root)
	if err != nil {
		return LifespanStart{}, LifespanHandle{}, err
	}
	path := filepath.Join(root, LifespanFile)
	previous, readErr := readLifespanState(path)

	start := LifespanStart{
		PreviousExit: LifespanExitNone,
		StartedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	switch {
	case errors.Is(readErr, os.ErrNotExist):
		// First run: no previous record.
	case readErr != nil:
		return LifespanStart{}, LifespanHandle{}, fmt.Errorf("read previous lifespan state: %w", readErr)
	default:
		start.PreviousStartedAt = previous.StartedAt
		start.LastCleanExitAt = previous.LastCleanExitAt
		start.PreviousPID = previous.PID
		start.ConsecutiveAbnormalExits = previous.ConsecutiveAbnormalExits
		switch previous.LastExit {
		case LifespanExitRunning:
			start.PreviousExit = LifespanExitAbnormal
			start.ConsecutiveAbnormalExits++
		case LifespanExitClean:
			start.PreviousExit = LifespanExitClean
			start.ConsecutiveAbnormalExits = 0
		default:
			start.PreviousExit = LifespanExitNone
			start.ConsecutiveAbnormalExits = 0
		}
	}

	runID, err := newLifespanRunID()
	if err != nil {
		return LifespanStart{}, LifespanHandle{}, fmt.Errorf("create lifespan run id: %w", err)
	}
	state := LifespanState{
		Schema:                   LifespanSchema,
		RunID:                    runID,
		StartedAt:                start.StartedAt,
		LastStartedAt:            start.PreviousStartedAt,
		LastExit:                 LifespanExitRunning,
		LastCleanExitAt:          start.LastCleanExitAt,
		ConsecutiveAbnormalExits: start.ConsecutiveAbnormalExits,
		PID:                      pid,
		UpdatedAt:                start.StartedAt,
	}
	if err := writeJSONAtomically(path, state); err != nil {
		return LifespanStart{}, LifespanHandle{}, fmt.Errorf("persist lifespan state: %w", err)
	}
	return start, LifespanHandle{runID: runID}, nil
}

// MarkCleanExit records that the current run is shutting down normally. It is
// called only from the desktop shutdown path; every other termination leaves
// the "running" marker so the next startup reports an abnormal exit.
func MarkCleanExit(root string, handle LifespanHandle) error {
	if !handle.Valid() {
		return fmt.Errorf("lifespan handle is empty")
	}
	root, err := secureRoot(root)
	if err != nil {
		return err
	}
	path := filepath.Join(root, LifespanFile)
	state, err := readLifespanState(path)
	if err != nil {
		return fmt.Errorf("read lifespan state for clean exit: %w", err)
	}
	if state.LastExit != LifespanExitRunning || state.RunID != handle.runID {
		return fmt.Errorf("lifespan marker belongs to a different run")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	state.LastExit = LifespanExitClean
	state.LastCleanExitAt = now
	state.ConsecutiveAbnormalExits = 0
	state.UpdatedAt = now
	if err := writeJSONAtomically(path, state); err != nil {
		return fmt.Errorf("persist clean exit marker: %w", err)
	}
	return nil
}

func newLifespanRunID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", value[:]), nil
}

// ReadLifespanState returns the current persisted marker. It is used by the
// desktop runtime to answer status queries and by tests.
func ReadLifespanState(root string) (LifespanState, error) {
	root, err := secureRoot(root)
	if err != nil {
		return LifespanState{}, err
	}
	return readLifespanState(filepath.Join(root, LifespanFile))
}

func readLifespanState(path string) (LifespanState, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return LifespanState{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return LifespanState{}, fmt.Errorf("%s must be a regular file", LifespanFile)
	}
	if info.Size() > maxLifespanBytes {
		return LifespanState{}, fmt.Errorf("%s is larger than %d bytes", LifespanFile, maxLifespanBytes)
	}
	file, err := os.OpenFile(path, os.O_RDONLY|noFollowOpenFlag(), 0)
	if err != nil {
		return LifespanState{}, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return LifespanState{}, err
	}
	if !openedInfo.Mode().IsRegular() || openedInfo.Size() > maxLifespanBytes {
		return LifespanState{}, fmt.Errorf("%s changed while it was opened", LifespanFile)
	}
	var state LifespanState
	decoder := json.NewDecoder(io.LimitReader(file, maxLifespanBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return LifespanState{}, fmt.Errorf("decode %s: %w", LifespanFile, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return LifespanState{}, fmt.Errorf("%s contains trailing JSON data", LifespanFile)
	}
	if state.Schema != LifespanSchema {
		return LifespanState{}, fmt.Errorf("unsupported lifespan schema %q", state.Schema)
	}
	switch state.LastExit {
	case LifespanExitClean, LifespanExitRunning:
	default:
		return LifespanState{}, fmt.Errorf("invalid lifespan exit %q", state.LastExit)
	}
	if state.ConsecutiveAbnormalExits < 0 {
		return LifespanState{}, fmt.Errorf("invalid negative abnormal-exit count in %s", LifespanFile)
	}
	return state, nil
}
