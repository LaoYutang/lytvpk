//go:build !windows

package app

import "fmt"

func protectSecret(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	return "", fmt.Errorf("面板密码加密仅支持 Windows")
}

func unprotectSecret(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	return "", fmt.Errorf("面板密码解密仅支持 Windows")
}
