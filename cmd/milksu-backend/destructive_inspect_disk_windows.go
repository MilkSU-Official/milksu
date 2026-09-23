//go:build windows

package main

import "io/fs"

// diskBytesOf is unknown on Windows, where the directory entry does not carry a block
// count. -1 makes the renderer fall back to the content size and label it as such.
func diskBytesOf(info fs.FileInfo) int64 {
	return -1
}
