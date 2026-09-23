//go:build !windows

package main

import (
	"io/fs"
	"syscall"
)

// diskBytesOf reports how much space deleting this entry actually frees - the du
// accounting a reader expects when they are told a delete is about to happen. It reads the
// block count the filesystem already reported (no extra stat, so the walk stays cheap).
//
// Returns -1 when the platform does not expose a block count: the caller must then fall
// back to the content size and say "content size", never "will free".
func diskBytesOf(info fs.FileInfo) int64 {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return -1
	}
	return int64(stat.Blocks) * 512
}
