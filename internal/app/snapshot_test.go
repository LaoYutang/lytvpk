package app

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newSnapshotTestApp(t *testing.T) (*App, string, string) {
	t.Helper()
	configDir := t.TempDir()
	rootDir := filepath.Join(configDir, "left4dead2", "addons")
	if err := os.MkdirAll(rootDir, 0755); err != nil {
		t.Fatalf("创建 addons 目录失败: %v", err)
	}
	app := &App{
		rootDir:         rootDir,
		configDir:       configDir,
		configPath:      filepath.Join(configDir, "config.json"),
		problemScanPath: filepath.Join(configDir, "problem_mod_scan.json"),
	}
	return app, rootDir, configDir
}

func writeSnapshotTestFile(t *testing.T, path string, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("创建测试目录失败: %v", err)
	}
	if err := os.WriteFile(path, []byte(data), 0644); err != nil {
		t.Fatalf("写入测试文件失败: %v", err)
	}
}

func TestFilenameSnapshotExactRestore(t *testing.T) {
	app, rootDir, configDir := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "A")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "B.vpk"), "B")
	addonListPath := filepath.Join(filepath.Dir(rootDir), "addonlist.txt")
	writeSnapshotTestFile(t, addonListPath, "\"AddonList\"\n{\n\t\"A.vpk\"\t\t\"1\"\n}\n")

	summary, err := app.CreateSnapshot("基础状态", snapshotKindFilename)
	if err != nil {
		t.Fatalf("创建文件名快照失败: %v", err)
	}
	if summary.ItemCount != 2 || !summary.HasAddonList {
		t.Fatalf("快照摘要不正确: %#v", summary)
	}

	if err := os.MkdirAll(filepath.Join(rootDir, "disabled"), 0755); err != nil {
		t.Fatalf("创建 disabled 目录失败: %v", err)
	}
	if err := os.Rename(filepath.Join(rootDir, "A.vpk"), filepath.Join(rootDir, "disabled", "A.vpk")); err != nil {
		t.Fatalf("禁用 A 失败: %v", err)
	}
	writeSnapshotTestFile(t, filepath.Join(rootDir, "C.vpk"), "C")
	writeSnapshotTestFile(t, addonListPath, "\"AddonList\"\n{\n\t\"B.vpk\"\t\t\"0\"\n}\n")

	plan, err := app.PreviewSnapshotRestore(summary.ID)
	if err != nil {
		t.Fatalf("生成恢复预览失败: %v", err)
	}
	if !plan.CanExecute {
		t.Fatalf("恢复预览被阻塞: %#v", plan.Blockers)
	}
	if plan.Summary.EnableCount != 1 || plan.Summary.DisableCount != 1 ||
		plan.Summary.SkipCount < 1 || !plan.Summary.AddonListChange {
		t.Fatalf("恢复统计不正确: %#v", plan.Summary)
	}

	result, err := app.ExecuteSnapshotRestore(plan.ID)
	if err != nil {
		t.Fatalf("执行恢复失败: %v", err)
	}
	if !strings.Contains(result.Message, "恢复完成") {
		t.Fatalf("恢复结果不正确: %#v", result)
	}
	if _, err := os.Stat(filepath.Join(rootDir, "A.vpk")); err != nil {
		t.Fatalf("A.vpk 未恢复到根目录: %v", err)
	}
	if _, err := os.Stat(filepath.Join(rootDir, "C.vpk")); !os.IsNotExist(err) {
		t.Fatalf("C.vpk 应被移动到 disabled")
	}
	if _, err := os.Stat(filepath.Join(rootDir, "disabled", "C.vpk")); err != nil {
		t.Fatalf("C.vpk 未移动到 disabled: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(configDir, "left4dead2", "addonlist.txt"))
	if err != nil {
		t.Fatalf("读取 addonlist.txt 失败: %v", err)
	}
	if string(raw) != "\"AddonList\"\n{\n\t\"A.vpk\"\t\t\"1\"\n}\n" {
		t.Fatalf("addonlist.txt 未恢复为快照版本: %q", raw)
	}
}

func TestFullSnapshotSkipsIdenticalAndRestoresDifferent(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "version-1")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.jpg"), "image-1")

	summary, err := app.CreateSnapshot("完整备份", snapshotKindFull)
	if err != nil {
		t.Fatalf("创建完整备份失败: %v", err)
	}

	// A 保持相同，图片改变，并新增一个不在快照中的 Mod。
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.jpg"), "image-2")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "B.vpk"), "B")

	plan, err := app.PreviewSnapshotRestore(summary.ID)
	if err != nil {
		t.Fatalf("生成恢复预览失败: %v", err)
	}
	if !plan.CanExecute {
		t.Fatalf("恢复预览被阻塞: %#v", plan.Blockers)
	}
	if plan.Summary.OverwriteCount != 1 || plan.Summary.DisableCount != 1 {
		t.Fatalf("恢复统计不正确: %#v", plan.Summary)
	}

	if _, err := app.ExecuteSnapshotRestore(plan.ID); err != nil {
		t.Fatalf("执行恢复失败: %v", err)
	}
	image, err := os.ReadFile(filepath.Join(rootDir, "A.jpg"))
	if err != nil {
		t.Fatalf("读取恢复图片失败: %v", err)
	}
	if string(image) != "image-1" {
		t.Fatalf("图片未恢复为快照版本: %q", image)
	}
	vpk, err := os.ReadFile(filepath.Join(rootDir, "A.vpk"))
	if err != nil {
		t.Fatalf("读取 VPK 失败: %v", err)
	}
	if string(vpk) != "version-1" {
		t.Fatalf("相同 VPK 不应被覆盖: %q", vpk)
	}
	if _, err := os.Stat(filepath.Join(rootDir, "B.vpk")); !os.IsNotExist(err) {
		t.Fatalf("额外 Mod 应被移动到 disabled")
	}
}

func TestSnapshotPreviewDoesNotModifyFiles(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "version-1")
	summary, err := app.CreateSnapshot("预览测试", snapshotKindFull)
	if err != nil {
		t.Fatalf("创建完整备份失败: %v", err)
	}
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "version-2")

	before, err := os.ReadFile(filepath.Join(rootDir, "A.vpk"))
	if err != nil {
		t.Fatalf("读取预览前文件失败: %v", err)
	}
	if _, err := app.PreviewSnapshotRestore(summary.ID); err != nil {
		t.Fatalf("生成恢复预览失败: %v", err)
	}
	after, err := os.ReadFile(filepath.Join(rootDir, "A.vpk"))
	if err != nil {
		t.Fatalf("读取预览后文件失败: %v", err)
	}
	if string(before) != string(after) || string(after) != "version-2" {
		t.Fatalf("预览不应修改文件: before=%q after=%q", before, after)
	}
	if _, err := os.Stat(filepath.Join(rootDir, ".snapshot-rollback")); !os.IsNotExist(err) {
		t.Fatalf("预览不应创建回滚目录")
	}
}

func TestSetSnapshotDirectoryRejectsAddonsSubdirectory(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	inside := filepath.Join(rootDir, "snaps")
	if err := app.SetSnapshotDirectory(inside, false); err == nil {
		t.Fatalf("应拒绝将快照目录设置在 addons 内部")
	}
}

func TestSnapshotDirectoryConfigRoundTrip(t *testing.T) {
	app, _, _ := newSnapshotTestApp(t)
	custom := filepath.Join(t.TempDir(), "snapshot-store")
	if err := app.SetSnapshotDirectory(custom, false); err != nil {
		t.Fatalf("设置自定义快照目录失败: %v", err)
	}

	reloaded := &App{
		configDir:       app.configDir,
		configPath:      app.configPath,
		problemScanPath: app.problemScanPath,
	}
	reloaded.loadConfig()
	if got := reloaded.GetSnapshotDirectory(); got != custom {
		t.Fatalf("快照目录未持久化: got=%q want=%q", got, custom)
	}
}

func TestSetSnapshotDirectoryMigratesSnapshots(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "A")
	summary, err := app.CreateSnapshot("迁移测试", snapshotKindFilename)
	if err != nil {
		t.Fatalf("创建文件名快照失败: %v", err)
	}

	oldRoot := app.GetSnapshotDirectory()
	newRoot := filepath.Join(t.TempDir(), "snapshot-store")
	if err := app.SetSnapshotDirectory(newRoot, true); err != nil {
		t.Fatalf("迁移快照目录失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(oldRoot, summary.ID)); !os.IsNotExist(err) {
		t.Fatalf("迁移后旧快照目录仍存在: %v", err)
	}
	if _, err := readSnapshotManifest(filepath.Join(newRoot, summary.ID)); err != nil {
		t.Fatalf("迁移后新快照不可读取: %v", err)
	}
	if got := app.GetSnapshotDirectory(); got != newRoot {
		t.Fatalf("快照目录未切换到新位置: got=%q want=%q", got, newRoot)
	}
}

func TestSnapshotRestoreRejectsStalePreview(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "A")
	summary, err := app.CreateSnapshot("状态测试", snapshotKindFilename)
	if err != nil {
		t.Fatalf("创建文件名快照失败: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(rootDir, "disabled"), 0755); err != nil {
		t.Fatalf("创建 disabled 目录失败: %v", err)
	}
	if err := os.Rename(filepath.Join(rootDir, "A.vpk"), filepath.Join(rootDir, "disabled", "A.vpk")); err != nil {
		t.Fatalf("禁用 A 失败: %v", err)
	}

	plan, err := app.PreviewSnapshotRestore(summary.ID)
	if err != nil {
		t.Fatalf("生成恢复预览失败: %v", err)
	}
	writeSnapshotTestFile(t, filepath.Join(rootDir, "changed.vpk"), "changed")
	if _, err := app.ExecuteSnapshotRestore(plan.ID); err == nil {
		t.Fatalf("预览后状态变化时应拒绝执行")
	}
}

func TestSnapshotManifestRejectsUnsafeSidecarPath(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "A")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.jpg"), "J")
	summary, err := app.CreateSnapshot("路径测试", snapshotKindFull)
	if err != nil {
		t.Fatalf("创建完整备份失败: %v", err)
	}
	manifestPath := filepath.Join(app.GetSnapshotDirectory(), summary.ID, "manifest.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("读取清单失败: %v", err)
	}
	changed := strings.Replace(string(raw), `"name": "A.jpg"`, `"name": "../A.jpg"`, 1)
	if changed == string(raw) {
		t.Fatalf("测试替换失败: %s", raw)
	}
	if err := os.WriteFile(manifestPath, []byte(changed), 0644); err != nil {
		t.Fatalf("写入损坏清单失败: %v", err)
	}
	snapshots, err := app.ListSnapshots()
	if err != nil {
		t.Fatalf("读取快照列表失败: %v", err)
	}
	if len(snapshots) != 1 || !snapshots[0].Corrupt {
		t.Fatalf("不安全侧车路径应将快照标记为损坏: %#v", snapshots)
	}
}

func snapshotActionByModName(t *testing.T, plan SnapshotRestorePlan, modName string) SnapshotRestoreAction {
	t.Helper()
	for _, action := range plan.Actions {
		if action.ModName == modName {
			return action
		}
	}
	t.Fatalf("恢复预览中缺少 Mod %s: %#v", modName, plan.Actions)
	return SnapshotRestoreAction{}
}

func TestFullSnapshotPreviewGroupsFilesByMod(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "a-v1")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.jpg"), "a-image-1")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.meta"), "a-meta")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "B.vpk"), "b-v1")
	addonListPath := filepath.Join(filepath.Dir(rootDir), "addonlist.txt")
	writeSnapshotTestFile(t, addonListPath, "list-v1")

	summary, err := app.CreateSnapshot("分组预览", snapshotKindFull)
	if err != nil {
		t.Fatalf("创建完整备份失败: %v", err)
	}

	// A 的 VPK 与图片被改动，A.meta 保持原样；B 被删除；C 与配套图片是新增文件。
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "a-v2")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.jpg"), "a-image-2")
	if err := os.Remove(filepath.Join(rootDir, "B.vpk")); err != nil {
		t.Fatalf("删除 B.vpk 失败: %v", err)
	}
	writeSnapshotTestFile(t, filepath.Join(rootDir, "C.vpk"), "c-v1")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "C.jpg"), "c-image")
	writeSnapshotTestFile(t, addonListPath, "list-v2")

	plan, err := app.PreviewSnapshotRestore(summary.ID)
	if err != nil {
		t.Fatalf("生成恢复预览失败: %v", err)
	}
	if !plan.CanExecute {
		t.Fatalf("恢复预览被阻塞: %#v", plan.Blockers)
	}
	if len(plan.Actions) != 4 {
		t.Fatalf("每个 Mod 应合并为一项: %#v", plan.Actions)
	}

	a := snapshotActionByModName(t, plan, "A.vpk")
	if len(a.Files) != 3 {
		t.Fatalf("A.vpk 应包含 VPK、图片和 meta: %#v", a.Files)
	}
	if a.Kind != "overwrite" || !containsString(a.Kinds, "skip") {
		t.Fatalf("A.vpk 应标记覆盖并包含跳过: %#v", a)
	}
	var total int64
	for _, file := range a.Files {
		total += file.Size
		base := strings.TrimSuffix(file.FileName, filepath.Ext(file.FileName))
		if !strings.EqualFold(base, "A") {
			t.Fatalf("文件 %s 不属于 Mod A.vpk", file.FileName)
		}
	}
	if a.Size != total {
		t.Fatalf("A.vpk 大小应为文件总和: got=%d want=%d", a.Size, total)
	}
	if !a.Destructive {
		t.Fatalf("A.vpk 合并后应保留覆盖带来的破坏性标记")
	}

	b := snapshotActionByModName(t, plan, "B.vpk")
	if b.Kind != "add" || len(b.Files) != 1 || b.Files[0].FileName != "B.vpk" {
		t.Fatalf("B.vpk 应为单个新增项: %#v", b)
	}

	c := snapshotActionByModName(t, plan, "C.vpk")
	if c.Kind != "disable" || len(c.Files) != 2 {
		t.Fatalf("C.vpk 与配套图片应合并为禁用项: %#v", c)
	}

	addonList := snapshotActionByModName(t, plan, "")
	if addonList.Kind != "addonlist" || addonList.FileName != "addonlist.txt" {
		t.Fatalf("addonlist.txt 应单独成为一项: %#v", addonList)
	}
}

func TestFilenameSnapshotPreviewGroupsCompanionFiles(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), "a-v1")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.jpg"), "a-image")

	summary, err := app.CreateSnapshot("文件分组", snapshotKindFilename)
	if err != nil {
		t.Fatalf("创建文件名快照失败: %v", err)
	}

	disabledDir := filepath.Join(rootDir, "disabled")
	if err := os.MkdirAll(disabledDir, 0755); err != nil {
		t.Fatalf("创建 disabled 目录失败: %v", err)
	}
	for _, name := range []string{"A.vpk", "A.jpg"} {
		if err := os.Rename(filepath.Join(rootDir, name), filepath.Join(disabledDir, name)); err != nil {
			t.Fatalf("禁用 %s 失败: %v", name, err)
		}
	}
	writeSnapshotTestFile(t, filepath.Join(rootDir, "B.vpk"), "b-v1")
	writeSnapshotTestFile(t, filepath.Join(rootDir, "B.jpg"), "b-image")

	plan, err := app.PreviewSnapshotRestore(summary.ID)
	if err != nil {
		t.Fatalf("生成恢复预览失败: %v", err)
	}
	if len(plan.Actions) != 2 {
		t.Fatalf("文件名快照也应把配套文件合并到 Mod: %#v", plan.Actions)
	}

	enabled := snapshotActionByModName(t, plan, "A.vpk")
	if enabled.Kind != "enable" || len(enabled.Files) != 2 {
		t.Fatalf("A.vpk 与图片应合并为启用项: %#v", enabled)
	}
	if enabled.Files[1].FileName != "A.jpg" {
		t.Fatalf("A.jpg 应在合并项中列出: %#v", enabled.Files)
	}

	disabled := snapshotActionByModName(t, plan, "B.vpk")
	if disabled.Kind != "disable" || len(disabled.Files) != 2 {
		t.Fatalf("B.vpk 与图片应合并为禁用项: %#v", disabled)
	}
}

func TestFullSnapshotCompressesVPKEntries(t *testing.T) {
	app, rootDir, _ := newSnapshotTestApp(t)
	// 使用高度可压缩的内容，便于验证 Deflate 是否真正生效。
	payload := strings.Repeat("vpk-manager-compressible-payload\n", 4096)
	writeSnapshotTestFile(t, filepath.Join(rootDir, "A.vpk"), payload)

	summary, err := app.CreateSnapshot("压缩验证", snapshotKindFull)
	if err != nil {
		t.Fatalf("创建完整备份失败: %v", err)
	}

	reader, err := zip.OpenReader(filepath.Join(summary.Directory, "payload.zip"))
	if err != nil {
		t.Fatalf("打开完整备份失败: %v", err)
	}
	defer reader.Close()

	var entry *zip.File
	for _, file := range reader.File {
		if filepath.ToSlash(file.Name) == "addons/A.vpk" {
			entry = file
			break
		}
	}
	if entry == nil {
		t.Fatalf("快照中缺少 addons/A.vpk")
	}
	if entry.Method != zip.Deflate {
		t.Fatalf("VPK 应以 Deflate 压缩，实际 method=%d", entry.Method)
	}
	if entry.CompressedSize64 >= entry.UncompressedSize64 {
		t.Fatalf("VPK 未取得压缩收益: 压缩后 %d >= 原始 %d", entry.CompressedSize64, entry.UncompressedSize64)
	}

	stream, err := entry.Open()
	if err != nil {
		t.Fatalf("打开 VPK 条目失败: %v", err)
	}
	defer stream.Close()
	data, err := io.ReadAll(stream)
	if err != nil {
		t.Fatalf("读取 VPK 条目失败: %v", err)
	}
	if string(data) != payload {
		t.Fatalf("解压后的 VPK 内容与源文件不一致")
	}
}
