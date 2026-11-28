package app

import (
	"bytes"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"l4d2-manager-next/pkg/valve/vpk"
)

func TestInspectDroppedFoldersClassifiesContent(t *testing.T) {
	base := t.TempDir()
	addons := filepath.Join(base, "addons")
	collection := filepath.Join(base, "collection")
	source := filepath.Join(base, "source")
	mixed := filepath.Join(base, "mixed")
	unknown := filepath.Join(base, "unknown")
	missing := filepath.Join(base, "missing")
	direct := filepath.Join(base, "direct.vpk")
	writeDropFolderFixture(t, filepath.Join(collection, "alpha.vpk"), "first")
	writeDropFolderFixture(t, filepath.Join(collection, "nested", "beta.VPK"), "second")
	writeDropFolderFixture(t, filepath.Join(collection, "nested", "scripts", "note.txt"), "not a root resource")
	writeDropFolderFixture(t, filepath.Join(source, "Materials", "mod.vmt"), "resource")
	writeDropFolderFixture(t, filepath.Join(mixed, "models", "mod.mdl"), "resource")
	writeDropFolderFixture(t, filepath.Join(mixed, "existing.VpK"), "existing")
	writeDropFolderFixture(t, filepath.Join(unknown, "readme.txt"), "not a resource")
	writeDropFolderFixture(t, direct, "direct")

	app := &App{rootDir: addons}
	inspection := app.InspectDroppedFolders([]string{collection, source, mixed, unknown, direct, missing})
	if inspection.AddonsDir != addons || len(inspection.Folders) != 5 {
		t.Fatalf("unexpected inspection: %+v", inspection)
	}

	want := []struct {
		path         string
		vpkPaths     []string
		hasResources bool
	}{
		{collection, []string{"alpha.vpk", "nested/beta.VPK"}, false},
		{source, nil, true},
		{mixed, []string{"existing.VpK"}, true},
		{unknown, nil, false},
		{missing, nil, false},
	}
	for index, expected := range want {
		folder := inspection.Folders[index]
		if folder.Path != expected.path || !slices.Equal(folder.VPKPaths, expected.vpkPaths) || folder.HasResources != expected.hasResources {
			t.Errorf("unexpected inspection of %s: %+v", expected.path, folder)
		}
		if (folder.Error != "") != (expected.path == missing) {
			t.Errorf("unexpected scan error for %s: %q", expected.path, folder.Error)
		}
	}
	if _, err := os.Stat(addons); !os.IsNotExist(err) {
		t.Fatalf("inspection unexpectedly touched addons: %v", err)
	}
}

func TestHandlePlannedFileDropImportsFolderWithoutOverwriting(t *testing.T) {
	base := t.TempDir()
	addons := filepath.Join(base, "addons")
	collection := filepath.Join(base, "collection")
	writeDropFolderFixture(t, filepath.Join(addons, "already.vpk"), "keep this")
	writeDropFolderFixture(t, filepath.Join(collection, "already.VPK"), "replacement")
	writeDropFolderFixture(t, filepath.Join(collection, "a", "same.vpk"), "first")
	writeDropFolderFixture(t, filepath.Join(collection, "b", "same.vpk"), "second")
	writeDropFolderFixture(t, filepath.Join(collection, "b", "nested.VPK"), "nested")
	writeDropFolderFixture(t, filepath.Join(collection, "not-confirmed.vpk"), "ignore")
	direct := filepath.Join(base, "direct.vpk")
	writeDropFolderFixture(t, direct, "direct drop")
	writeDropFolderFixture(t, filepath.Join(collection, "direct.VPK"), "folder duplicate")

	app := &App{rootDir: addons}
	result, err := app.HandlePlannedFileDrop([]DropImportRequest{
		{
			Path: collection, FolderAction: "import",
			VPKPaths: []string{"already.VPK", "a/same.vpk", "b/same.vpk", "b/nested.VPK", "direct.VPK"},
		},
		{Path: direct},
	}, addons)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 6 || result.Succeeded != 3 || result.Skipped != 3 || result.Failed != 0 || !result.HasInstallChanges {
		t.Fatalf("unexpected import result: %+v", result)
	}
	if !result.Items[1].Skipped || !result.Items[3].Skipped || !result.Items[5].Skipped {
		t.Fatalf("expected duplicate items to be skipped: %+v", result.Items)
	}
	assertFileContent(t, filepath.Join(addons, "already.vpk"), "keep this")
	assertFileContent(t, filepath.Join(addons, "same.vpk"), "first")
	assertFileContent(t, filepath.Join(addons, "nested.VPK"), "nested")
	assertFileContent(t, filepath.Join(addons, "direct.vpk"), "direct drop")
	assertDropFolderEntries(t, addons, 4)
}

func TestHandlePlannedFileDropRestoresExportedSidecars(t *testing.T) {
	base := t.TempDir()
	addons := filepath.Join(base, "addons")
	if err := os.Mkdir(addons, 0755); err != nil {
		t.Fatal(err)
	}
	collection := filepath.Join(base, "collection")
	nested := filepath.Join(collection, "nested")
	writeLocalScanVPK(t, filepath.Join(nested, "Exported.Mod.VPK"), "")
	meta := WorkshopMeta{WorkshopID: "123456", Title: "Exported title"}
	if err := writeWorkshopMeta(filepath.Join(nested, "eXPORTED.mOD.vpk"), meta); err != nil {
		t.Fatal(err)
	}
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewGray(image.Rect(0, 0, 1, 1)), nil); err != nil {
		t.Fatal(err)
	}
	writeDropFolderFixture(t, filepath.Join(nested, "eXPORTED.mOD.JPG"), jpegData.String())
	writeDropFolderFixture(t, filepath.Join(nested, "Exported.Mod.webp"), "unsupported")
	writeDropFolderFixture(t, filepath.Join(nested, "Exported.Mod.txt"), "unrelated")
	writeDropFolderFixture(t, filepath.Join(collection, "Exported.Mod.meta"), "different directory")
	writeDropFolderFixture(t, filepath.Join(collection, "Exported.Mod.jpg"), "different directory")
	writeDropFolderFixture(t, filepath.Join(collection, "bare.vpk"), "no matching files")
	writeDropFolderFixture(t, filepath.Join(nested, "bare.meta"), "different directory")
	writeDropFolderFixture(t, filepath.Join(nested, "bare.jpg"), "different directory")

	app := &App{rootDir: addons}
	inspection := app.InspectDroppedFolders([]string{collection})
	if len(inspection.Folders) != 1 || inspection.Folders[0].Error != "" {
		t.Fatalf("unexpected inspection: %+v", inspection)
	}
	result, err := app.HandlePlannedFileDrop([]DropImportRequest{{
		Path: collection, FolderAction: "import", VPKPaths: inspection.Folders[0].VPKPaths,
	}}, inspection.AddonsDir)
	if err != nil || result.Succeeded != 2 || result.Failed != 0 {
		t.Fatalf("folder VPKs and export sidecars were not imported: %+v (%v)", result, err)
	}

	assertDropFolderEntries(t, addons, 4)
	assertFileContent(t, filepath.Join(addons, "Exported.Mod.jpg"), jpegData.String())
	assertFileContent(t, filepath.Join(addons, "bare.vpk"), "no matching files")
	cache, err := scanVPKFile(filepath.Join(addons, "Exported.Mod.VPK"), vpkScanOptions{rootDir: addons, metaEnabled: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if cache.File.Title != meta.Title || cache.File.WorkshopID != meta.WorkshopID ||
		!strings.HasPrefix(cache.File.PreviewImage, "data:image/jpeg;base64,") {
		t.Fatalf("installed mod preview or metadata was not visible to the scanner: %+v", cache.File)
	}
}

func TestHandlePlannedFileDropPreservesConflictingSidecars(t *testing.T) {
	base := t.TempDir()
	addons := filepath.Join(base, "addons")
	collection := filepath.Join(base, "collection")
	writeDropFolderFixture(t, filepath.Join(addons, "installed.vpk"), "installed VPK")
	writeDropFolderFixture(t, filepath.Join(addons, "installed.meta"), "installed metadata")
	writeDropFolderFixture(t, filepath.Join(addons, "fresh.META"), "existing metadata")
	writeDropFolderFixture(t, filepath.Join(addons, "with-preview.JPG"), "existing preview")
	writeDropFolderFixture(t, filepath.Join(collection, "installed.VPK"), "different VPK")
	writeDropFolderFixture(t, filepath.Join(collection, "installed.meta"), "different metadata")
	writeDropFolderFixture(t, filepath.Join(collection, "installed.jpg"), "different preview")
	writeDropFolderFixture(t, filepath.Join(collection, "fresh.vpk"), "fresh VPK")
	writeDropFolderFixture(t, filepath.Join(collection, "fresh.meta"), "fresh metadata")
	writeDropFolderFixture(t, filepath.Join(collection, "fresh.jpg"), "fresh preview")
	writeDropFolderFixture(t, filepath.Join(collection, "with-preview.vpk"), "other VPK")
	writeDropFolderFixture(t, filepath.Join(collection, "with-preview.meta"), "other metadata")
	writeDropFolderFixture(t, filepath.Join(collection, "with-preview.jpg"), "other preview")

	app := &App{rootDir: addons}
	result, err := app.HandlePlannedFileDrop([]DropImportRequest{{
		Path: collection, FolderAction: "import", VPKPaths: []string{"installed.VPK", "fresh.vpk", "with-preview.vpk"},
	}}, addons)
	if err != nil || result.Total != 3 || result.Succeeded != 2 || result.Skipped != 1 || result.Failed != 0 {
		t.Fatalf("unexpected result: %+v (%v)", result, err)
	}
	for index, sidecar := range []string{"fresh.meta", "with-preview.jpg"} {
		item := result.Items[index+1]
		if !item.Success || !strings.Contains(item.Message, "跳过") || !strings.Contains(strings.ToLower(item.Message), sidecar) {
			t.Errorf("conflict should be visible for %s: %+v", sidecar, item)
		}
	}
	assertFileContent(t, filepath.Join(addons, "installed.vpk"), "installed VPK")
	assertFileContent(t, filepath.Join(addons, "installed.meta"), "installed metadata")
	assertFileContent(t, filepath.Join(addons, "fresh.META"), "existing metadata")
	assertFileContent(t, filepath.Join(addons, "fresh.vpk"), "fresh VPK")
	assertFileContent(t, filepath.Join(addons, "fresh.jpg"), "fresh preview")
	assertFileContent(t, filepath.Join(addons, "with-preview.JPG"), "existing preview")
	assertFileContent(t, filepath.Join(addons, "with-preview.vpk"), "other VPK")
	assertFileContent(t, filepath.Join(addons, "with-preview.meta"), "other metadata")
	assertDropFolderEntries(t, addons, 8)
}

func TestHandlePlannedFileDropSkipsLinkedSidecars(t *testing.T) {
	base := t.TempDir()
	addons := filepath.Join(base, "addons")
	if err := os.Mkdir(addons, 0755); err != nil {
		t.Fatal(err)
	}
	collection := filepath.Join(base, "collection")
	outside := filepath.Join(base, "outside.meta")
	inside := filepath.Join(collection, "unrelated.jpg")
	writeDropFolderFixture(t, filepath.Join(collection, "mod.vpk"), "VPK")
	writeDropFolderFixture(t, outside, "outside metadata")
	writeDropFolderFixture(t, inside, "different photo")
	for link, target := range map[string]string{"mod.meta": outside, "mod.jpg": inside} {
		if err := os.Symlink(target, filepath.Join(collection, link)); err != nil {
			t.Skipf("file symlinks unavailable: %v", err)
		}
	}

	app := &App{rootDir: addons}
	result, err := app.HandlePlannedFileDrop([]DropImportRequest{{
		Path: collection, FolderAction: "import", VPKPaths: []string{"mod.vpk"},
	}}, addons)
	if err != nil || result.Succeeded != 1 || result.Failed != 0 {
		t.Fatalf("a sidecar link should not prevent the VPK import: %+v (%v)", result, err)
	}
	assertFileContent(t, filepath.Join(addons, "mod.vpk"), "VPK")
	assertDropFolderEntries(t, addons, 1)
	assertFileContent(t, outside, "outside metadata")
	assertFileContent(t, inside, "different photo")
}

func TestHandlePlannedFileDropPacksSourceAndMixedFolders(t *testing.T) {
	base := t.TempDir()
	addons := filepath.Join(base, "addons")
	if err := os.Mkdir(addons, 0755); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(base, "source")
	mixed := filepath.Join(base, "mixed")
	writeDropFolderFixture(t, filepath.Join(source, "scripts", "mod.txt"), "source script")
	writeDropFolderFixture(t, filepath.Join(mixed, "materials", "existing.jpg"), "resource from a different directory")
	writeDropFolderFixture(t, filepath.Join(mixed, "nested", "existing.VPK"), "existing")
	writeDropFolderFixture(t, filepath.Join(mixed, "nested", "EXISTING.Meta"), "sidecar metadata")
	writeDropFolderFixture(t, filepath.Join(mixed, "nested", "EXISTING.JPG"), "sidecar preview")
	direct := filepath.Join(base, "direct.vpk")
	writeDropFolderFixture(t, direct, "direct")

	app := &App{rootDir: addons}
	result, err := app.HandlePlannedFileDrop([]DropImportRequest{
		{Path: source, FolderAction: "pack"},
		{Path: mixed, FolderAction: "pack", VPKPaths: []string{"nested/existing.VPK"}},
		{Path: direct},
	}, addons)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 || result.Succeeded != 3 || result.Failed != 0 || !result.HasInstallChanges {
		t.Fatalf("unexpected pack result: %+v", result)
	}
	assertDroppedArchiveEntry(t, filepath.Join(addons, "source.vpk"), "scripts/mod.txt", "source script")
	assertDroppedArchiveEntry(t, filepath.Join(addons, "mixed.vpk"), "materials/existing.jpg", "resource from a different directory")
	assertFileContent(t, filepath.Join(addons, "direct.vpk"), "direct")
	assertDropFolderEntries(t, addons, 3)
}

func TestHandlePlannedFileDropRejectsNewVPKInPreviouslyPureSource(t *testing.T) {
	base := t.TempDir()
	addons := filepath.Join(base, "addons")
	source := filepath.Join(base, "source")
	if err := os.Mkdir(addons, 0755); err != nil {
		t.Fatal(err)
	}
	writeDropFolderFixture(t, filepath.Join(source, "scripts", "mod.txt"), "resource")
	app := &App{rootDir: addons}
	inspection := app.InspectDroppedFolders([]string{source})
	if len(inspection.Folders) != 1 || !inspection.Folders[0].HasResources || len(inspection.Folders[0].VPKPaths) > 0 {
		t.Fatalf("expected source-only inspection: %+v", inspection)
	}
	writeDropFolderFixture(t, filepath.Join(source, "added.vpk"), "existing VPK")
	result, err := app.HandlePlannedFileDrop([]DropImportRequest{{Path: source, FolderAction: "pack"}}, addons)
	if err != nil {
		t.Fatal(err)
	}
	if result.Failed != 1 || result.HasInstallChanges {
		t.Fatalf("expected changed folder to require another choice: %+v", result)
	}
	assertDropFolderEntries(t, addons, 0)
}

func TestHandlePlannedFileDropDoesNotWriteToChangedAddons(t *testing.T) {
	base := t.TempDir()
	previewAddons := filepath.Join(base, "preview-addons")
	currentAddons := filepath.Join(base, "current-addons")
	for _, addons := range []string{previewAddons, currentAddons} {
		if err := os.Mkdir(addons, 0755); err != nil {
			t.Fatal(err)
		}
	}
	collection := filepath.Join(base, "collection")
	writeDropFolderFixture(t, filepath.Join(collection, "mod.vpk"), "existing")
	requests := []DropImportRequest{{Path: collection, FolderAction: "import", VPKPaths: []string{"mod.vpk"}}}

	app := &App{}
	result, err := app.HandlePlannedFileDrop(requests, "")
	if err == nil && (result.Failed != 1 || result.HasInstallChanges) {
		t.Fatalf("expected the operation to reject a missing addons directory: %+v", result)
	}
	app.rootDir = currentAddons
	result, err = app.HandlePlannedFileDrop(requests, previewAddons)
	if err == nil && (result.Failed != 1 || result.HasInstallChanges) {
		t.Fatalf("expected the operation to reject a changed addons directory: %+v", result)
	}
	assertDropFolderEntries(t, previewAddons, 0)
	assertDropFolderEntries(t, currentAddons, 0)
}

func TestInspectDroppedFoldersSkipsDirectoryLinks(t *testing.T) {
	for _, kind := range []string{"symlink", "junction"} {
		t.Run(kind, func(t *testing.T) {
			base := t.TempDir()
			outside := filepath.Join(base, "outside")
			collection := filepath.Join(base, "collection")
			addons := filepath.Join(base, "addons")
			if err := os.Mkdir(addons, 0755); err != nil {
				t.Fatal(err)
			}
			writeDropFolderFixture(t, filepath.Join(outside, "escaped.vpk"), "outside")
			writeDropFolderFixture(t, filepath.Join(collection, "within.vpk"), "inside")
			link := filepath.Join(collection, "materials")
			switch kind {
			case "symlink":
				if err := os.Symlink(outside, link); err != nil {
					t.Skipf("directory symlinks unavailable: %v", err)
				}
			case "junction":
				if runtime.GOOS != "windows" {
					t.Skip("directory junctions require Windows")
				}
				output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/j", link, outside).CombinedOutput()
				if err != nil {
					t.Skipf("directory junctions unavailable: %v (%s)", err, output)
				}
				if _, err := os.Lstat(link); err != nil {
					t.Skipf("junction command did not create a usable link: %v (%s)", err, output)
				}
			}

			app := &App{rootDir: addons}
			inspection := app.InspectDroppedFolders([]string{collection, link})
			if len(inspection.Folders) != 2 {
				t.Fatalf("unexpected inspection: %+v", inspection)
			}
			folder := inspection.Folders[0]
			if folder.Error != "" || folder.HasResources || !slices.Equal(folder.VPKPaths, []string{"within.vpk"}) {
				t.Fatalf("directory link entered the inspection: %+v", folder)
			}
			if inspection.Folders[1].Error == "" {
				t.Fatal("expected a clear error when dropping a directory link")
			}
			result, err := app.HandlePlannedFileDrop([]DropImportRequest{{
				Path: collection, FolderAction: "import", VPKPaths: []string{"materials/escaped.vpk"},
			}}, addons)
			if err == nil && (result.Failed != 1 || result.HasInstallChanges) {
				t.Fatalf("expected link path to be rejected: %+v", result)
			}
			assertDropFolderEntries(t, addons, 0)
		})
	}
}

func writeDropFolderFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func assertDropFolderEntries(t *testing.T, dir string, count int) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != count {
		t.Fatalf("expected %d entries in %s, got %v", count, dir, entries)
	}
}

func assertDroppedArchiveEntry(t *testing.T, path, name, content string) {
	t.Helper()
	opener := vpk.Single(path)
	defer opener.Close()
	archive, err := opener.ReadArchive()
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.Files) != 1 || archive.Files[0].Name() != name {
		t.Fatalf("unexpected packed files: %+v", archive.Files)
	}
	data, err := archive.Files[0].Bytes(opener)
	if err != nil || string(data) != content {
		t.Fatalf("unexpected content for %s: %q (%v)", name, data, err)
	}
}
