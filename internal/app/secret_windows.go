//go:build windows

package app

import (
	"encoding/base64"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

func protectSecret(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	data := []byte(value)
	in := windows.DataBlob{
		Size: uint32(len(data)),
		Data: &data[0],
	}
	var out windows.DataBlob
	if err := windows.CryptProtectData(&in, nil, nil, 0, nil, 0, &out); err != nil {
		return "", fmt.Errorf("加密面板密码失败: %w", err)
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(out.Data))))

	encrypted := unsafe.Slice(out.Data, out.Size)
	return base64.StdEncoding.EncodeToString(encrypted), nil
}

func unprotectSecret(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", fmt.Errorf("解码面板密码失败: %w", err)
	}
	if len(data) == 0 {
		return "", nil
	}
	in := windows.DataBlob{
		Size: uint32(len(data)),
		Data: &data[0],
	}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(&in, nil, nil, 0, nil, 0, &out); err != nil {
		return "", fmt.Errorf("解密面板密码失败: %w", err)
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(out.Data))))

	decrypted := unsafe.Slice(out.Data, out.Size)
	return string(decrypted), nil
}
