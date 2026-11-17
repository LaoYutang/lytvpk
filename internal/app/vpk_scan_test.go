package app

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/panjf2000/ants/v2"
)

func writeLocalScanVPK(t *testing.T, path, addonURL string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	writeTestVPK(t, path, map[string][]byte{
		"addoninfo.txt": []byte(fmt.Sprintf("\"AddonInfo\"\n{\n\"addontitle\" \"Archive title\"\n\"addonURL0\" \"%s\"\n}", addonURL)),
	})
}

func TestScanLocalWorkshopIdentitySources(t *testing.T) {
	const addonURL = "https://steamcommunity.com/sharedfiles/filedetails/?id=345678"
	for _, tc := range []struct {
		name, path, meta, url, want string
	}{
		{"meta wins", "workshop/234567.vpk", `{"workshop_id":"123456"}`, addonURL, "123456"},
		{"filename wins over URL", "workshop/234567.vpk", "", addonURL, "234567"},
		{"uppercase extension", "workshop/234567.VPK", "", "", "234567"},
		{"root addon URL", "custom.vpk", "", addonURL, "345678"},
		{"disabled addon URL", "disabled/custom.vpk", "", addonURL, "345678"},
		{"hidden meta", "_custom.vpk", `{"workshop_id":"123456"}`, "", "123456"},
		{"disabled meta", "disabled/custom.vpk", `{"workshop_id":"123456"}`, "", "123456"},
		{"corrupt meta URL fallback", "custom.vpk", `{broken`, addonURL, "345678"},
		{"corrupt meta filename fallback", "workshop/234567.vpk", `{broken`, "", "234567"},
		{"invalid meta", "custom.vpk", `{"workshop_id":"abc"}`, "", ""},
		{"direct suppresses fallbacks", "workshop/234567.vpk", `{"workshop_id":"direct-123456"}`, addonURL, ""},
		{"root number is not identity", "234567.vpk", "", "", ""},
		{"disabled number is not identity", "disabled/234567.vpk", "", "", ""},
		{"nested number is not Steam convention", "workshop/custom/234567.vpk", "", "", ""},
		{"hidden number is not inferred", "workshop/_234567.vpk", "", "", ""},
		{"tagged number is not inferred", "workshop/[tag]234567.vpk", "", "", ""},
		{"small number rejected", "workshop/123.vpk", "", "", ""},
		{"overflow rejected", "workshop/9223372036854775808.vpk", "", "", ""},
		{"unrelated URL numbers", "custom.vpk", "", "https://steamcommunity.com/profiles/123456", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app, root, _ := newWorkshopMoveTestApp(t, false)
			path := filepath.Join(root, filepath.FromSlash(tc.path))
			writeLocalScanVPK(t, path, tc.url)
			if tc.meta != "" {
				if err := os.WriteFile(GetMetaFilePath(path), []byte(tc.meta), 0644); err != nil {
					t.Fatal(err)
				}
			}
			// Identity works with meta overrides disabled, including cache hits.
			for range 2 {
				if err := app.ScanVPKFiles(); err != nil {
					t.Fatal(err)
				}
				files := app.GetVPKFiles()
				if len(files) != 1 || files[0].WorkshopID != tc.want || files[0].Title != "Archive title" {
					t.Fatalf("unexpected files: %+v", files)
				}
			}
		})
	}
}

func TestScanLocalWorkshopMetaChangesAndFailedFiles(t *testing.T) {
	app, root, _ := newWorkshopMoveTestApp(t, true)
	path := filepath.Join(root, "local.vpk")
	writeLocalScanVPK(t, path, "")
	writeMeta := func(id string) {
		t.Helper()
		if err := writeWorkshopMeta(path, WorkshopMeta{WorkshopID: id, Title: "Meta title"}); err != nil {
			t.Fatal(err)
		}
		// Deterministic cache invalidation even on coarse Windows timestamps.
		stamp := time.Now().Add(time.Hour)
		if err := os.Chtimes(GetMetaFilePath(path), stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	writeMeta("123456")
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	if files := app.GetVPKFiles(); files[0].Title != "Meta title" || files[0].WorkshopID != "123456" {
		t.Fatalf("meta was not applied: %+v", files)
	}
	if err := os.Remove(GetMetaFilePath(path)); err != nil {
		t.Fatal(err)
	}
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	if files := app.GetVPKFiles(); files[0].WorkshopID != "" {
		t.Fatalf("removed meta left stale identity: %+v", files)
	}
	writeMeta("234567")
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("broken VPK"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	if files := app.GetVPKFiles(); len(files) != 0 {
		t.Fatalf("failed parse retained stale identity: %+v", files)
	}
}

func TestScanLocalWorkshopRenameMoveDeleteAndDirectorySwitch(t *testing.T) {
	app, root, workshop := newWorkshopMoveTestApp(t, false)
	path := filepath.Join(workshop, "234567.vpk")
	writeLocalScanVPK(t, path, "")
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	renamed, err := app.RenameVPKFile(path, "custom.vpk")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	if files := app.GetVPKFiles(); files[0].WorkshopID != "" {
		t.Fatalf("renamed filename retained inferred identity: %+v", files)
	}
	if err := os.Remove(renamed); err != nil {
		t.Fatal(err)
	}
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	if len(app.GetVPKFiles()) != 0 {
		t.Fatal("deleted file retained in cache")
	}
	writeLocalScanVPK(t, path, "")
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	result, err := app.MoveWorkshopFilesToAddons([]string{path})
	if err != nil || result.SuccessCount != 1 {
		t.Fatalf("move failed: %+v, %v", result, err)
	}
	if err := app.ScanVPKFiles(); err != nil {
		t.Fatal(err)
	}
	if files := app.GetVPKFiles(); files[0].WorkshopID != "" || files[0].Path != filepath.Join(root, "234567.vpk") {
		t.Fatalf("root file must no longer infer a numeric identity: %+v", files)
	}
	if err := app.SetRootDirectory(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if len(app.GetVPKFiles()) != 0 {
		t.Fatal("directory change retained old files")
	}
}

func TestScanVPKFilesReleasedPoolDoesNotHang(t *testing.T) {
	app, root, _ := newWorkshopMoveTestApp(t, false)
	writeLocalScanVPK(t, filepath.Join(root, "local.vpk"), "")
	app.goroutinePool.Release()
	if err := app.ScanVPKFiles(); err == nil {
		t.Fatal("released pool should return a submission error")
	}
}

func TestScanVPKFilesSerializesDirectorySwitch(t *testing.T) {
	app, root, _ := newWorkshopMoveTestApp(t, false)
	writeLocalScanVPK(t, filepath.Join(root, "local.vpk"), "")
	app.vpkScanMu.Lock()
	pool, err := ants.NewPool(2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	scanDone := make(chan error, 1)
	switchDone := make(chan error, 1)
	newRoot := t.TempDir()
	if err := pool.Submit(func() { scanDone <- app.ScanVPKFiles() }); err != nil {
		t.Fatal(err)
	}
	if err := pool.Submit(func() { switchDone <- app.SetRootDirectory(newRoot) }); err != nil {
		t.Fatal(err)
	}
	select {
	case <-scanDone:
		t.Fatal("scan bypassed directory gate")
	case <-switchDone:
		t.Fatal("switch bypassed scan gate")
	default:
	}
	app.vpkScanMu.Unlock()
	if err := <-scanDone; err != nil {
		t.Fatal(err)
	}
	if err := <-switchDone; err != nil {
		t.Fatal(err)
	}
	if app.GetRootDirectory() != newRoot || len(app.GetVPKFiles()) != 0 {
		t.Fatal("old directory scan leaked into new directory")
	}
}

func TestReplaceExistingModDoesNotExpandToInferredIdentities(t *testing.T) {
	for _, tc := range []struct {
		name, metaID     string
		enabled, replace bool
	}{
		{"filename or URL only", "", true, false},
		{"meta disabled", "123456", false, false},
		{"original meta scope", "123456", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app, root, _ := newWorkshopMoveTestApp(t, tc.enabled)
			oldPath := filepath.Join(root, "old.vpk")
			newPath := filepath.Join(root, "new.vpk")
			writeLocalScanVPK(t, oldPath, "")
			writeLocalScanVPK(t, newPath, "")
			app.vpkCache.Store(oldPath, &VPKFileCache{
				File:           VPKFile{Path: oldPath, Location: "root", WorkshopID: "123456"},
				MetaWorkshopID: tc.metaID,
			})
			app.replaceExistingMod(newPath, "123456", root)
			_, err := os.Stat(oldPath)
			if os.IsNotExist(err) != tc.replace {
				t.Fatalf("replacement=%v, expected %v", os.IsNotExist(err), tc.replace)
			}
		})
	}
}
