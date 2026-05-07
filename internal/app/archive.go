package app

import (
	"archive/zip"
	"bytes"
	"fmt"
	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

func extractZipFile(file *zip.File, decodedName string, destDir string) error {
	rc, err := file.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	targetPath := filepath.Join(destDir, filepath.Base(decodedName))

	outFile, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	_, err = io.Copy(outFile, rc)
	return err
}

// ExtractVPKFromZip 从ZIP文件中解压所有VPK文件到指定目录（多协程并行解压）
func (a *App) ExtractVPKFromZip(zipPath string, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("无法打开ZIP文件: %v", err)
	}
	defer r.Close()

	// 收集所有文件条目（做编码转换）
	type zipEntry struct {
		file        *zip.File
		decodedName string
	}
	var allEntries []zipEntry
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := f.Name
		if f.Flags&0x800 == 0 { // 如果没有设置UTF-8标志位
			i := bytes.NewReader([]byte(name))
			decoder := transform.NewReader(i, simplifiedchinese.GBK.NewDecoder())
			content, _ := io.ReadAll(decoder)
			if len(content) > 0 {
				name = string(content)
			}
		}
		allEntries = append(allEntries, zipEntry{file: f, decodedName: name})
	}

	// 过滤出VPK文件
	var vpkEntries []zipEntry
	for _, e := range allEntries {
		if strings.HasSuffix(strings.ToLower(e.decodedName), ".vpk") {
			vpkEntries = append(vpkEntries, e)
		}
	}

	if len(vpkEntries) == 0 {
		return fmt.Errorf("ZIP文件中未找到VPK文件")
	}

	// 建立附加文件映射：basename -> []*zip.File
	extraFiles := make(map[string][]*zip.File)
	for _, e := range allEntries {
		lowerName := strings.ToLower(e.decodedName)
		if strings.HasSuffix(lowerName, ".vpk") {
			continue
		}
		ext := filepath.Ext(lowerName)
		if ext != ".jpg" && ext != ".png" && ext != ".jpeg" && ext != ".gif" && ext != ".meta" {
			continue
		}
		base := strings.TrimSuffix(lowerName, ext)
		extraFiles[base] = append(extraFiles[base], e.file)
	}

	log.Printf("开始并行解压 ZIP: %s, 包含 %d 个VPK文件, 并发协程池容量: %d", filepath.Base(zipPath), len(vpkEntries), a.goroutinePool.Cap())

	var wg sync.WaitGroup
	var extractErr error
	var errMu sync.Mutex
	extractedCount := 0
	var countMu sync.Mutex

	for _, e := range vpkEntries {
		wg.Add(1)
		entry := e // 闭包变量捕获

		err := a.goroutinePool.Submit(func() {
			log.Printf(">>> 开始解压: %s", entry.decodedName)
			defer wg.Done()

			// 如果已经有错误发生，提前退出
			errMu.Lock()
			if extractErr != nil {
				errMu.Unlock()
				return
			}
			errMu.Unlock()

			// 解压VPK文件
			if err := extractZipFile(entry.file, entry.decodedName, destDir); err != nil {
				log.Printf("解压VPK失败 %s: %v", entry.decodedName, err)
				return
			}

			// 解压同名附加文件
			vpkBase := strings.ToLower(strings.TrimSuffix(filepath.Base(entry.decodedName), ".vpk"))
			if extras, ok := extraFiles[vpkBase]; ok {
				for _, ef := range extras {
					extraName := ef.Name
					if ef.Flags&0x800 == 0 {
						i := bytes.NewReader([]byte(extraName))
						decoder := transform.NewReader(i, simplifiedchinese.GBK.NewDecoder())
						content, _ := io.ReadAll(decoder)
						if len(content) > 0 {
							extraName = string(content)
						}
					}
					if err := extractZipFile(ef, extraName, destDir); err != nil {
						log.Printf("解压附加文件失败 %s: %v", extraName, err)
					}
				}
			}

			countMu.Lock()
			extractedCount++
			countMu.Unlock()
			log.Printf("<<< 完成解压: %s", entry.decodedName)
		})

		if err != nil {
			wg.Done() // 提交失败需要手动 Done
			log.Printf("提交解压任务失败: %v", err)
		}
	}

	wg.Wait()

	if extractErr != nil {
		return extractErr
	}

	if extractedCount == 0 {
		return fmt.Errorf("未成功解压任何VPK文件")
	}

	return nil
}

// ExtractVPKFromRar 从RAR文件中解压所有VPK文件到指定目录（串行解压，rardecode库不支持并发读取）
func (a *App) ExtractVPKFromRar(rarPath string, destDir string) error {
	// 第一次遍历：收集所有文件名
	f, err := os.Open(rarPath)
	if err != nil {
		return fmt.Errorf("无法打开RAR文件: %v", err)
	}

	r, err := rardecode.NewReader(f, "")
	if err != nil {
		f.Close()
		return fmt.Errorf("无法创建RAR读取器: %v", err)
	}

	var allNames []string
	for {
		header, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			f.Close()
			return fmt.Errorf("读取RAR内容失败: %v", err)
		}
		if header.IsDir {
			continue
		}
		allNames = append(allNames, header.Name)
	}
	f.Close()

	// 找出所有VPK的basename
	vpkBases := make(map[string]bool)
	for _, name := range allNames {
		lowerName := strings.ToLower(name)
		if strings.HasSuffix(lowerName, ".vpk") {
			base := strings.ToLower(strings.TrimSuffix(filepath.Base(name), ".vpk"))
			vpkBases[base] = true
		}
	}

	if len(vpkBases) == 0 {
		return fmt.Errorf("RAR文件中未找到VPK文件")
	}

	// 确定需要提取的文件
	extractSet := make(map[string]bool)
	for _, name := range allNames {
		lowerName := strings.ToLower(name)
		base := strings.ToLower(strings.TrimSuffix(filepath.Base(name), filepath.Ext(name)))
		ext := filepath.Ext(lowerName)
		if strings.HasSuffix(lowerName, ".vpk") {
			extractSet[name] = true
		} else if vpkBases[base] && (ext == ".jpg" || ext == ".png" || ext == ".jpeg" || ext == ".gif" || ext == ".meta") {
			extractSet[name] = true
		}
	}

	// 第二次遍历：提取文件
	f, err = os.Open(rarPath)
	if err != nil {
		return fmt.Errorf("无法打开RAR文件: %v", err)
	}
	defer f.Close()

	r, err = rardecode.NewReader(f, "")
	if err != nil {
		return fmt.Errorf("无法创建RAR读取器: %v", err)
	}

	extractedCount := 0
	for {
		header, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("读取RAR内容失败: %v", err)
		}

		if header.IsDir {
			continue
		}

		if !extractSet[header.Name] {
			continue
		}

		targetPath := filepath.Join(destDir, filepath.Base(header.Name))

		outFile, err := os.Create(targetPath)
		if err != nil {
			log.Printf("无法创建目标文件 %s: %v", targetPath, err)
			continue
		}

		_, err = io.Copy(outFile, r)
		outFile.Close()

		if err != nil {
			log.Printf("解压文件 %s 失败: %v", header.Name, err)
			os.Remove(targetPath)
			continue
		}

		extractedCount++
		log.Printf("已解压: %s -> %s", header.Name, targetPath)
	}

	if extractedCount == 0 {
		return fmt.Errorf("RAR文件中未找到VPK文件")
	}
	return nil
}

// ExtractVPKFrom7z 从7z文件中解压所有VPK文件到指定目录（多协程并行解压）
func (a *App) ExtractVPKFrom7z(sevenZPath string, destDir string) error {
	r, err := sevenzip.OpenReader(sevenZPath)
	if err != nil {
		return fmt.Errorf("无法打开7z文件: %v", err)
	}
	defer r.Close()

	// 收集所有文件条目
	type sevenZipEntry struct {
		file *sevenzip.File
		name string
	}
	var allEntries []sevenZipEntry
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		allEntries = append(allEntries, sevenZipEntry{file: f, name: f.Name})
	}

	// 过滤出VPK文件
	var vpkEntries []sevenZipEntry
	for _, e := range allEntries {
		if strings.HasSuffix(strings.ToLower(e.name), ".vpk") {
			vpkEntries = append(vpkEntries, e)
		}
	}

	if len(vpkEntries) == 0 {
		return fmt.Errorf("7z文件中未找到VPK文件")
	}

	// 建立附加文件映射：basename -> []*sevenzip.File
	extraFiles := make(map[string][]*sevenzip.File)
	for _, e := range allEntries {
		lowerName := strings.ToLower(e.name)
		if strings.HasSuffix(lowerName, ".vpk") {
			continue
		}
		ext := filepath.Ext(lowerName)
		if ext != ".jpg" && ext != ".png" && ext != ".jpeg" && ext != ".gif" && ext != ".meta" {
			continue
		}
		base := strings.TrimSuffix(lowerName, ext)
		extraFiles[base] = append(extraFiles[base], e.file)
	}

	log.Printf("开始并行解压 7z: %s, 包含 %d 个VPK文件, 并发协程池容量: %d", filepath.Base(sevenZPath), len(vpkEntries), a.goroutinePool.Cap())

	var wg sync.WaitGroup
	var extractErr error
	var errMu sync.Mutex
	extractedCount := 0
	var countMu sync.Mutex

	for _, e := range vpkEntries {
		wg.Add(1)
		entry := e // 闭包变量捕获

		err := a.goroutinePool.Submit(func() {
			log.Printf(">>> 开始解压: %s", entry.name)
			defer wg.Done()

			// 如果已经有错误发生，提前退出
			errMu.Lock()
			if extractErr != nil {
				errMu.Unlock()
				return
			}
			errMu.Unlock()

			// 解压VPK文件
			if err := extract7zFile(entry.file, entry.name, destDir); err != nil {
				log.Printf("解压VPK失败 %s: %v", entry.name, err)
				return
			}

			// 解压同名附加文件
			vpkBase := strings.ToLower(strings.TrimSuffix(filepath.Base(entry.name), ".vpk"))
			if extras, ok := extraFiles[vpkBase]; ok {
				for _, ef := range extras {
					if err := extract7zFile(ef, ef.Name, destDir); err != nil {
						log.Printf("解压附加文件失败 %s: %v", ef.Name, err)
					}
				}
			}

			countMu.Lock()
			extractedCount++
			countMu.Unlock()
			log.Printf("<<< 完成解压: %s", entry.name)
		})

		if err != nil {
			wg.Done() // 提交失败需要手动 Done
			log.Printf("提交解压任务失败: %v", err)
		}
	}

	wg.Wait()

	if extractErr != nil {
		return extractErr
	}

	if extractedCount == 0 {
		return fmt.Errorf("未成功解压任何VPK文件")
	}
	return nil
}

// extract7zFile 从7z中解压单个文件到目标目录
func extract7zFile(file *sevenzip.File, name string, destDir string) error {
	rc, err := file.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	targetPath := filepath.Join(destDir, filepath.Base(name))

	outFile, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	_, err = io.Copy(outFile, rc)
	return err
}

// ExtractVPKFromArchive 根据文件扩展名自动选择解压方式
func (a *App) ExtractVPKFromArchive(archivePath string, destDir string) error {
	ext := strings.ToLower(filepath.Ext(archivePath))
	switch ext {
	case ".zip":
		return a.ExtractVPKFromZip(archivePath, destDir)
	case ".rar":
		return a.ExtractVPKFromRar(archivePath, destDir)
	case ".7z":
		return a.ExtractVPKFrom7z(archivePath, destDir)
	default:
		return fmt.Errorf("不支持的压缩格式: %s", ext)
	}
}
