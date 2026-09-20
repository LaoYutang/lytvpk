//go:build !windows

package native

import "math"

// IsProcessRunning is unavailable outside Windows in this desktop application.
func IsProcessRunning(string) (bool, error) {
	return false, nil
}

// FreeDiskSpace avoids false disk-space blockers on non-Windows development
// and test environments.
func FreeDiskSpace(string) (uint64, error) {
	return math.MaxUint64, nil
}
