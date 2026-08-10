package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
)

const maxDesktopRPCMessageBytes = 128 << 20

type desktopHost interface {
	Emit(event string, value any)
	Call(ctx context.Context, method string, payload any, result any) error
}

type desktopRPC struct {
	input   io.Reader
	output  io.Writer
	app     *App
	writeMu sync.Mutex
	nextID  atomic.Uint64
	mu      sync.Mutex
	pending map[string]chan desktopRPCMessage
}

type desktopRPCMessage struct {
	Type    string            `json:"type"`
	ID      string            `json:"id,omitempty"`
	Method  string            `json:"method,omitempty"`
	Event   string            `json:"event,omitempty"`
	Args    []json.RawMessage `json:"args,omitempty"`
	Payload any               `json:"payload,omitempty"`
	Result  json.RawMessage   `json:"result,omitempty"`
	Error   string            `json:"error,omitempty"`
}

func newDesktopRPC(input io.Reader, output io.Writer) *desktopRPC {
	return &desktopRPC{
		input: input, output: output,
		pending: make(map[string]chan desktopRPCMessage),
	}
}

func (r *desktopRPC) attach(app *App) { r.app = app }

func (r *desktopRPC) ready() {
	_ = r.write(desktopRPCMessage{Type: "ready"})
}

func (r *desktopRPC) Emit(event string, value any) {
	if strings.TrimSpace(event) == "" {
		return
	}
	_ = r.write(desktopRPCMessage{Type: "event", Event: event, Payload: value})
}

func (r *desktopRPC) Call(
	ctx context.Context,
	method string,
	payload any,
	result any,
) error {
	method = strings.TrimSpace(method)
	if method == "" {
		return errors.New("desktop host method is required")
	}
	id := fmt.Sprintf("host-%d", r.nextID.Add(1))
	response := make(chan desktopRPCMessage, 1)
	r.mu.Lock()
	r.pending[id] = response
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.pending, id)
		r.mu.Unlock()
	}()
	if err := r.write(desktopRPCMessage{
		Type: "host_request", ID: id, Method: method, Payload: payload,
	}); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case message := <-response:
		if message.Error != "" {
			return errors.New(message.Error)
		}
		if result == nil || len(message.Result) == 0 || string(message.Result) == "null" {
			return nil
		}
		if err := json.Unmarshal(message.Result, result); err != nil {
			return fmt.Errorf("decode desktop host response: %w", err)
		}
		return nil
	}
}

func (r *desktopRPC) serve() error {
	scanner := bufio.NewScanner(r.input)
	scanner.Buffer(make([]byte, 64<<10), maxDesktopRPCMessageBytes)
	for scanner.Scan() {
		var message desktopRPCMessage
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			_ = r.write(desktopRPCMessage{Type: "protocol_error", Error: "invalid desktop RPC message"})
			continue
		}
		switch message.Type {
		case "invoke":
			go r.invoke(message)
		case "host_response":
			r.resolveHostResponse(message)
		case "shutdown":
			return nil
		default:
			_ = r.write(desktopRPCMessage{
				Type: "protocol_error", ID: message.ID,
				Error: "unsupported desktop RPC message type",
			})
		}
	}
	return scanner.Err()
}

func (r *desktopRPC) resolveHostResponse(message desktopRPCMessage) {
	r.mu.Lock()
	response := r.pending[message.ID]
	r.mu.Unlock()
	if response != nil {
		response <- message
	}
}

func (r *desktopRPC) invoke(message desktopRPCMessage) {
	result, err := invokeAppMethod(r.app, message.Method, message.Args)
	response := desktopRPCMessage{Type: "result", ID: message.ID}
	if err != nil {
		response.Error = err.Error()
	} else if result != nil {
		encoded, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			response.Error = "encode desktop method result: " + marshalErr.Error()
		} else {
			response.Result = encoded
		}
	} else {
		response.Result = json.RawMessage("null")
	}
	_ = r.write(response)
}

func invokeAppMethod(app *App, name string, args []json.RawMessage) (result any, err error) {
	if app == nil {
		return nil, errors.New("desktop runtime is unavailable")
	}
	name = strings.TrimSpace(name)
	if name == "" || name == "Startup" || name == "Shutdown" {
		return nil, fmt.Errorf("unsupported desktop method %q", name)
	}
	method := reflect.ValueOf(app).MethodByName(name)
	if !method.IsValid() {
		return nil, fmt.Errorf("unsupported desktop method %q", name)
	}
	methodType := method.Type()
	if methodType.NumIn() != len(args) {
		return nil, fmt.Errorf(
			"desktop method %s expects %d arguments, received %d",
			name, methodType.NumIn(), len(args),
		)
	}
	values := make([]reflect.Value, len(args))
	for index, raw := range args {
		value := reflect.New(methodType.In(index))
		if err := json.Unmarshal(raw, value.Interface()); err != nil {
			return nil, fmt.Errorf("decode argument %d for %s: %w", index, name, err)
		}
		values[index] = value.Elem()
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("desktop method %s failed", name)
			result = nil
		}
	}()
	outputs := method.Call(values)
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	if len(outputs) > 0 && outputs[len(outputs)-1].Type().Implements(errorType) {
		last := outputs[len(outputs)-1]
		outputs = outputs[:len(outputs)-1]
		if !last.IsNil() {
			return nil, last.Interface().(error)
		}
	}
	switch len(outputs) {
	case 0:
		return nil, nil
	case 1:
		return outputs[0].Interface(), nil
	default:
		return nil, fmt.Errorf("desktop method %s has an unsupported result shape", name)
	}
}

func (r *desktopRPC) write(message desktopRPCMessage) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	encoded, err := json.Marshal(message)
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	_, err = r.output.Write(encoded)
	return err
}
