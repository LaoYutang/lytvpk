//go:build !windows

package app

import "os"

func commitDropFile(tempPath, destPath string) error {
	return os.Link(tempPath, destPath)
}
