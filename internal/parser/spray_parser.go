package parser

import (
	"strings"

	"l4d2-manager-next/pkg/valve/vpk"
)

func isSprayVPKArchive(archive *vpk.Archive) bool {
	for i := range archive.Files {
		if isSprayMaterialPath(archive.Files[i].Name()) {
			return true
		}
	}
	return false
}

func isSprayMaterialPath(filename string) bool {
	name := strings.ToLower(strings.ReplaceAll(filename, "\\", "/"))
	if !strings.HasPrefix(name, "materials/vgui/logos/") {
		return false
	}
	return strings.HasSuffix(name, ".vtf") || strings.HasSuffix(name, ".vmt")
}

func isSprayVTFPath(filename string) bool {
	name := strings.ToLower(strings.ReplaceAll(filename, "\\", "/"))
	return strings.HasPrefix(name, "materials/vgui/logos/") && strings.HasSuffix(name, ".vtf")
}
