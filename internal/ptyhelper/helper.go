package ptyhelper

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/creack/pty"
	"github.com/google/uuid"
)

const (
	defaultColumns = 100
	defaultRows    = 28
	maxColumns     = 400
	maxRows        = 200
	maxInputBytes  = 64 * 1024
)

type Handle struct {
	ID  string `json:"id"`
	PID int    `json:"pid"`
}

type session struct {
	mu      sync.Mutex
	id      string
	command *exec.Cmd
	file    *os.File
}

type Pool struct {
	mu     sync.Mutex
	items  map[string]*session
	emit   func(event string, payload any)
	closed bool
}

func NewPool(emit func(event string, payload any)) *Pool {
	return &Pool{
		items: make(map[string]*session),
		emit:  emit,
	}
}

func (p *Pool) Open(
	command string,
	args []string,
	cwd string,
	env []string,
	columns,
	rows int,
) (Handle, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return Handle{}, errors.New("shell command is required")
	}
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return Handle{}, errors.New("project directory is required")
	}
	columns, rows = normalizedSize(columns, rows)

	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return Handle{}, errors.New("PTY helper is closed")
	}
	p.mu.Unlock()

	cmd := exec.Command(command, args...)
	cmd.Dir = cwd
	cmd.Env = sanitizeEnvironment(env)
	file, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: uint16(columns),
		Rows: uint16(rows),
	})
	if err != nil {
		return Handle{}, fmt.Errorf("start project terminal: %w", err)
	}
	item := &session{
		id:      "pty_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		command: cmd,
		file:    file,
	}
	handle := Handle{ID: item.id}
	if cmd.Process != nil {
		handle.PID = cmd.Process.Pid
	}

	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		_ = file.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
		return Handle{}, errors.New("PTY helper is closed")
	}
	p.items[item.id] = item
	p.mu.Unlock()

	go p.readOutput(item, file)
	go p.wait(item)
	return handle, nil
}

func (p *Pool) Write(id, data string) error {
	item, err := p.session(id)
	if err != nil {
		return err
	}
	if len(data) > maxInputBytes {
		return fmt.Errorf("terminal input must be at most %d bytes", maxInputBytes)
	}
	item.mu.Lock()
	file := item.file
	item.mu.Unlock()
	if file == nil {
		return errors.New("terminal session is not running")
	}
	if _, err := io.WriteString(file, data); err != nil {
		return fmt.Errorf("write project terminal: %w", err)
	}
	return nil
}

func (p *Pool) Resize(id string, columns, rows int) error {
	item, err := p.session(id)
	if err != nil {
		return err
	}
	columns, rows = normalizedSize(columns, rows)
	item.mu.Lock()
	file := item.file
	item.mu.Unlock()
	if file == nil {
		return errors.New("terminal session is not running")
	}
	if err := pty.Setsize(file, &pty.Winsize{
		Cols: uint16(columns),
		Rows: uint16(rows),
	}); err != nil {
		return fmt.Errorf("resize project terminal: %w", err)
	}
	return nil
}

func (p *Pool) ClosePty(id string) error {
	item, err := p.session(id)
	if err != nil {
		return err
	}
	p.drop(item)
	item.mu.Lock()
	var process *os.Process
	if item.command != nil {
		process = item.command.Process
	}
	file := item.file
	item.file = nil
	item.mu.Unlock()
	if process != nil {
		_ = process.Signal(os.Interrupt)
	}
	if file != nil {
		_ = file.Close()
	}
	if process != nil {
		_ = process.Kill()
	}
	return nil
}

func (p *Pool) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	items := make([]*session, 0, len(p.items))
	for _, item := range p.items {
		items = append(items, item)
	}
	p.items = make(map[string]*session)
	p.mu.Unlock()
	for _, item := range items {
		item.mu.Lock()
		var process *os.Process
		if item.command != nil {
			process = item.command.Process
		}
		file := item.file
		item.file = nil
		item.mu.Unlock()
		if process != nil {
			_ = process.Signal(os.Interrupt)
		}
		if file != nil {
			_ = file.Close()
		}
		if process != nil {
			_ = process.Kill()
		}
	}
}

func (p *Pool) session(id string) (*session, error) {
	id = strings.TrimSpace(id)
	if !strings.HasPrefix(id, "pty_") || len(id) > 96 {
		return nil, errors.New("invalid terminal session id")
	}
	p.mu.Lock()
	item := p.items[id]
	p.mu.Unlock()
	if item == nil {
		return nil, errors.New("terminal session not found")
	}
	return item, nil
}

func (p *Pool) drop(item *session) {
	p.mu.Lock()
	delete(p.items, item.id)
	p.mu.Unlock()
}

func (p *Pool) readOutput(item *session, file *os.File) {
	buffer := make([]byte, 32*1024)
	for {
		count, err := file.Read(buffer)
		if count > 0 {
			data := strings.ToValidUTF8(string(buffer[:count]), "\uFFFD")
			p.emitEvent("pty-output", map[string]any{
				"id":   item.id,
				"data": data,
			})
		}
		if err != nil {
			return
		}
	}
}

func (p *Pool) wait(item *session) {
	err := item.command.Wait()
	exitCode := -1
	if item.command.ProcessState != nil {
		exitCode = item.command.ProcessState.ExitCode()
	}
	payload := map[string]any{
		"id":       item.id,
		"exitCode": exitCode,
	}
	if err != nil && exitCode != 0 {
		payload["error"] = err.Error()
	}
	p.drop(item)
	item.mu.Lock()
	file := item.file
	item.file = nil
	item.mu.Unlock()
	if file != nil {
		_ = file.Close()
	}
	p.emitEvent("pty-exit", payload)
}

func (p *Pool) emitEvent(event string, payload any) {
	if p.emit != nil {
		p.emit(event, payload)
	}
}

func normalizedSize(columns, rows int) (int, int) {
	if columns < 20 {
		columns = defaultColumns
	}
	if rows < 5 {
		rows = defaultRows
	}
	if columns > maxColumns {
		columns = maxColumns
	}
	if rows > maxRows {
		rows = maxRows
	}
	return columns, rows
}
