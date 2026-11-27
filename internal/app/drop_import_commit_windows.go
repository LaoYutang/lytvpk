package app

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func commitDropVPK(tempPath, destPath string) error {
	from, err := dropMovePath(tempPath)
	if err != nil {
		return err
	}
	to, err := dropMovePath(destPath)
	if err != nil {
		return err
	}
	return windows.MoveFile(from, to)
}

func dropMovePath(path string) (*uint16, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	// MoveFile does not replace the destination. Use extended paths to keep
	// long filenames working just as they do in Go's filesystem calls.
	switch {
	case strings.HasPrefix(absolute, `\\?\`), strings.HasPrefix(absolute, `\\.\`):
	case strings.HasPrefix(absolute, `\\`):
		absolute = `\\?\UNC\` + absolute[2:]
	default:
		absolute = `\\?\` + absolute
	}
	return windows.UTF16PtrFromString(absolute)
}
