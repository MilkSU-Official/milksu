package computercap

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	wlDisplayID              = 1
	wlDisplayGetRegistry     = 1
	wlDisplaySync            = 0
	wlDisplayEventError      = 0
	wlRegistryBind           = 0
	wlRegistryEventGlobal    = 0
	wlCallbackEventDone      = 0
	virtualPointerMotionAbs  = 1
	virtualPointerButton     = 2
	virtualPointerAxis       = 3
	virtualPointerFrame      = 4
	virtualPointerAxisStop   = 6
	virtualPointerAxisDisc   = 7
	virtualPointerDestroy    = 8
	virtualPointerManagerNew = 0
	linuxButtonLeftHypr      = 272
	waylandFixedOne          = 256
)

type waylandVirtualPointer struct {
	mu      sync.Mutex
	conn    net.Conn
	pointer uint32
	nextID  uint32
	closed  bool
}

func connectWaylandVirtualPointer() (hyprlandPointer, error) {
	return connectWaylandVirtualPointerEnv(os.Getenv)
}

func connectWaylandVirtualPointerEnv(getenv func(string) string) (hyprlandPointer, error) {
	path, err := hyprlandWaylandSocket(getenv)
	if err != nil {
		return nil, err
	}
	conn, err := net.DialTimeout("unix", path, 2*time.Second)
	if err != nil {
		return nil, fmt.Errorf("连接 Wayland 显示 %s：%w", path, err)
	}
	pointer, err := bindVirtualPointer(conn)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return pointer, nil
}

func bindVirtualPointer(conn net.Conn) (*waylandVirtualPointer, error) {
	client := &waylandVirtualPointer{conn: conn, nextID: 2}
	registryID := client.allocID()
	if err := client.write(encodeGetRegistry(wlDisplayID, registryID)); err != nil {
		return nil, err
	}
	callbackID := client.allocID()
	if err := client.write(encodeSync(wlDisplayID, callbackID)); err != nil {
		return nil, err
	}
	var managerName, managerVersion uint32
	found := false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		objectID, opcode, payload, err := readWaylandMessage(conn)
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				continue
			}
			return nil, err
		}
		if objectID == wlDisplayID && opcode == wlDisplayEventError {
			return nil, waylandDisplayError(payload)
		}
		if objectID == registryID && opcode == wlRegistryEventGlobal {
			name, iface, version, ok := parseRegistryGlobal(payload)
			if ok && iface == "zwlr_virtual_pointer_manager_v1" {
				managerName = name
				managerVersion = version
				found = true
			}
			continue
		}
		if objectID == callbackID && opcode == wlCallbackEventDone {
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("当前 Hyprland 没有 zwlr_virtual_pointer。无法合成点击，不会改用 xinput")
	}
	if managerVersion == 0 || managerVersion > 2 {
		managerVersion = 2
	}
	managerID := client.allocID()
	if err := client.write(encodeRegistryBind(registryID, managerName, "zwlr_virtual_pointer_manager_v1", managerVersion, managerID)); err != nil {
		return nil, err
	}
	pointerID := client.allocID()
	if err := client.write(encodeCreateVirtualPointer(managerID, pointerID)); err != nil {
		return nil, err
	}
	client.pointer = pointerID
	return client, nil
}

func (pointer *waylandVirtualPointer) Click(x, y float64, width, height int) error {
	pointer.mu.Lock()
	defer pointer.mu.Unlock()
	if pointer.closed {
		return fmt.Errorf("Hyprland 虚拟指针已关闭")
	}
	if width <= 0 {
		width = 1920
	}
	if height <= 0 {
		height = 1080
	}
	px := uint32(math.Max(0, math.Min(float64(width), x+0.5)))
	py := uint32(math.Max(0, math.Min(float64(height), y+0.5)))
	if err := pointer.write(encodePointerMotionAbsolute(pointer.pointer, px, py, uint32(width), uint32(height))); err != nil {
		return err
	}
	if err := pointer.write(encodePointerButton(pointer.pointer, linuxButtonLeftHypr, 1)); err != nil {
		return err
	}
	if err := pointer.write(encodePointerButton(pointer.pointer, linuxButtonLeftHypr, 0)); err != nil {
		return err
	}
	return pointer.write(encodePointerFrame(pointer.pointer))
}

func (pointer *waylandVirtualPointer) Scroll(direction string, amount int) error {
	pointer.mu.Lock()
	defer pointer.mu.Unlock()
	if pointer.closed {
		return fmt.Errorf("Hyprland 虚拟指针已关闭")
	}
	if amount < 1 {
		amount = 1
	}
	axis := uint32(0)
	steps := int32(amount)
	switch strings.ToLower(direction) {
	case "up":
		steps = -int32(amount)
	case "down":
		steps = int32(amount)
	case "left":
		axis = 1
		steps = -int32(amount)
	case "right":
		axis = 1
		steps = int32(amount)
	}
	value := int32(steps) * 10 * waylandFixedOne
	if err := pointer.write(encodePointerAxisDiscrete(pointer.pointer, axis, value, steps)); err != nil {
		return err
	}
	if err := pointer.write(encodePointerAxisStop(pointer.pointer, axis)); err != nil {
		return err
	}
	return pointer.write(encodePointerFrame(pointer.pointer))
}

func (pointer *waylandVirtualPointer) Close() error {
	pointer.mu.Lock()
	defer pointer.mu.Unlock()
	if pointer.closed {
		return nil
	}
	pointer.closed = true
	if pointer.pointer != 0 {
		_ = pointer.write(encodePointerDestroy(pointer.pointer))
		pointer.pointer = 0
	}
	if pointer.conn != nil {
		err := pointer.conn.Close()
		pointer.conn = nil
		return err
	}
	return nil
}

func (pointer *waylandVirtualPointer) allocID() uint32 {
	id := pointer.nextID
	pointer.nextID++
	return id
}

func (pointer *waylandVirtualPointer) write(payload []byte) error {
	_, err := pointer.conn.Write(payload)
	return err
}

func encodeGetRegistry(displayID, registryID uint32) []byte {
	return encodeWaylandRequest(displayID, wlDisplayGetRegistry, encodeUint32(nil, registryID))
}

func encodeSync(displayID, callbackID uint32) []byte {
	return encodeWaylandRequest(displayID, wlDisplaySync, encodeUint32(nil, callbackID))
}

func encodeRegistryBind(registryID, name uint32, iface string, version, newID uint32) []byte {
	payload := encodeUint32(nil, name)
	payload = encodeWaylandString(payload, iface)
	payload = encodeUint32(payload, version)
	payload = encodeUint32(payload, newID)
	return encodeWaylandRequest(registryID, wlRegistryBind, payload)
}

func encodeCreateVirtualPointer(managerID, pointerID uint32) []byte {
	payload := encodeUint32(nil, 0) // null seat
	payload = encodeUint32(payload, pointerID)
	return encodeWaylandRequest(managerID, virtualPointerManagerNew, payload)
}

func encodePointerMotionAbsolute(pointerID, x, y, xExtent, yExtent uint32) []byte {
	payload := encodeUint32(nil, 0) // time
	payload = encodeUint32(payload, x)
	payload = encodeUint32(payload, y)
	payload = encodeUint32(payload, xExtent)
	payload = encodeUint32(payload, yExtent)
	return encodeWaylandRequest(pointerID, virtualPointerMotionAbs, payload)
}

func encodePointerButton(pointerID, button, state uint32) []byte {
	payload := encodeUint32(nil, 0)
	payload = encodeUint32(payload, button)
	payload = encodeUint32(payload, state)
	return encodeWaylandRequest(pointerID, virtualPointerButton, payload)
}

func encodePointerAxisDiscrete(pointerID, axis uint32, value int32, discrete int32) []byte {
	payload := encodeUint32(nil, 0)
	payload = encodeUint32(payload, axis)
	payload = encodeInt32(payload, value)
	payload = encodeInt32(payload, discrete)
	return encodeWaylandRequest(pointerID, virtualPointerAxisDisc, payload)
}

func encodePointerAxisStop(pointerID, axis uint32) []byte {
	payload := encodeUint32(nil, 0)
	payload = encodeUint32(payload, axis)
	return encodeWaylandRequest(pointerID, virtualPointerAxisStop, payload)
}

func encodePointerFrame(pointerID uint32) []byte {
	return encodeWaylandRequest(pointerID, virtualPointerFrame, nil)
}

func encodePointerDestroy(pointerID uint32) []byte {
	return encodeWaylandRequest(pointerID, virtualPointerDestroy, nil)
}

func encodeWaylandRequest(objectID uint32, opcode uint16, payload []byte) []byte {
	size := uint32(8 + len(payload))
	header := make([]byte, 8)
	binary.LittleEndian.PutUint32(header[0:4], objectID)
	binary.LittleEndian.PutUint32(header[4:8], (size<<16)|uint32(opcode))
	return append(header, payload...)
}

func encodeUint32(buf []byte, value uint32) []byte {
	var raw [4]byte
	binary.LittleEndian.PutUint32(raw[:], value)
	return append(buf, raw[:]...)
}

func encodeInt32(buf []byte, value int32) []byte {
	return encodeUint32(buf, uint32(value))
}

func encodeWaylandString(buf []byte, value string) []byte {
	size := uint32(len(value) + 1)
	buf = encodeUint32(buf, size)
	buf = append(buf, value...)
	buf = append(buf, 0)
	for len(buf)%4 != 0 {
		buf = append(buf, 0)
	}
	return buf
}

func readWaylandMessage(r io.Reader) (objectID uint32, opcode uint16, payload []byte, err error) {
	var header [8]byte
	if _, err = io.ReadFull(r, header[:]); err != nil {
		return 0, 0, nil, err
	}
	objectID = binary.LittleEndian.Uint32(header[0:4])
	word := binary.LittleEndian.Uint32(header[4:8])
	opcode = uint16(word & 0xffff)
	size := word >> 16
	if size < 8 {
		return 0, 0, nil, fmt.Errorf("wayland message too small")
	}
	payload = make([]byte, size-8)
	if len(payload) == 0 {
		return objectID, opcode, payload, nil
	}
	if _, err = io.ReadFull(r, payload); err != nil {
		return 0, 0, nil, err
	}
	return objectID, opcode, payload, nil
}

func parseRegistryGlobal(payload []byte) (name uint32, iface string, version uint32, ok bool) {
	if len(payload) < 8 {
		return 0, "", 0, false
	}
	name = binary.LittleEndian.Uint32(payload[0:4])
	iface, rest, ok := decodeWaylandString(payload[4:])
	if !ok || len(rest) < 4 {
		return 0, "", 0, false
	}
	version = binary.LittleEndian.Uint32(rest[0:4])
	return name, iface, version, true
}

func decodeWaylandString(payload []byte) (string, []byte, bool) {
	if len(payload) < 4 {
		return "", nil, false
	}
	size := binary.LittleEndian.Uint32(payload[0:4])
	padded := (size + 3) &^ 3
	if size == 0 || uint32(len(payload)) < 4+padded {
		return "", nil, false
	}
	data := payload[4 : 4+size]
	if data[len(data)-1] != 0 {
		return "", nil, false
	}
	return string(data[:len(data)-1]), payload[4+padded:], true
}

func waylandDisplayError(payload []byte) error {
	if len(payload) < 8 {
		return fmt.Errorf("wayland display error")
	}
	objectID := binary.LittleEndian.Uint32(payload[0:4])
	code := binary.LittleEndian.Uint32(payload[4:8])
	message, _, _ := decodeWaylandString(payload[8:])
	if message == "" {
		return fmt.Errorf("wayland object %d error %d", objectID, code)
	}
	return fmt.Errorf("wayland object %d error %d: %s", objectID, code, message)
}

// Keep the unused axis opcode referenced so a later discrete-less
// compositor path can switch without inventing a second protocol table.
var _ = virtualPointerAxis
