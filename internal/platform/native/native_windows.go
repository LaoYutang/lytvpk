//go:build windows

package native

import (
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// IsProcessRunning reports whether a process with the given executable name is
// currently running. The comparison is case-insensitive.
func IsProcessRunning(name string) (bool, error) {
	target := strings.TrimSpace(name)
	if target == "" {
		return false, nil
	}

	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(snapshot)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return false, err
	}

	for {
		if strings.EqualFold(windows.UTF16ToString(entry.ExeFile[:]), target) {
			return true, nil
		}
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			if errorsIsNoMoreFiles(err) {
				return false, nil
			}
			return false, err
		}
	}
}

// FreeDiskSpace returns the number of bytes available to the current user for
// the volume containing path.
func FreeDiskSpace(path string) (uint64, error) {
	target, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}

	var available uint64
	if err := windows.GetDiskFreeSpaceEx(target, &available, nil, nil); err != nil {
		return 0, err
	}
	return available, nil
}

func errorsIsNoMoreFiles(err error) bool {
	return err == windows.ERROR_NO_MORE_FILES
}
