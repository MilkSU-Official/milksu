package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 一个 40 字节的小文件在文件系统上占一个 4 KiB 块 ⇒ "删掉能释放多少"远大于内容大小。
// 若 diskBytesOf 退回内容大小，本测试必红（内容大小是 40）。
func TestDiskBytesOfCountsBlocksNotContentSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "small")
	if err := os.WriteFile(path, []byte("0123456789012345678901234567890123456789"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat fixture: %v", err)
	}
	if got := info.Size(); got != 40 {
		t.Fatalf("fixture must be 40 bytes, got %d", got)
	}
	disk := diskBytesOf(info)
	if disk < 4096 {
		t.Fatalf("diskBytesOf must report the block usage (>= 4096), got %d", disk)
	}
	if disk <= info.Size() {
		t.Fatalf("diskBytesOf must exceed the content size, got %d <= %d", disk, info.Size())
	}
}
