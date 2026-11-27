//go:build !windows

package app

import "os"

func commitDropVPK(tempPath, destPath string) error {
	return os.Link(tempPath, destPath)
}
