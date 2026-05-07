package parser

import (
	"git.lubar.me/ben/valve/vpk"
)

// GetVPKFileList 获取VPK文件中的所有文件路径列表
func GetVPKFileList(filePath string) ([]string, error) {
	opener := vpk.Single(filePath)
	defer opener.Close()

	archive, err := opener.ReadArchive()
	if err != nil {
		return nil, err
	}

	var files []string
	for _, file := range archive.Files {
		files = append(files, file.Name())
	}

	return files, nil
}
