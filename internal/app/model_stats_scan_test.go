package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/panjf2000/ants/v2"
)

func TestCollectModelStatsScanTargetsSkipsDisabledMods(t *testing.T) {
	root := t.TempDir()
	writeEmptyFile(t, filepath.Join(root, "enabled.vpk"))
	writeEmptyFile(t, filepath.Join(root, "notes.txt"))
	writeEmptyFile(t, filepath.Join(root, "disabled", "disabled.vpk"))
	writeEmptyFile(t, filepath.Join(root, "workshop", "3710541769.vpk"))
	writeEmptyFile(t, filepath.Join(root, "workshop", "nested", "child.vpk"))

	targets, err := collectModelStatsScanTargets(root)
	if err != nil {
		t.Fatalf("collect targets: %v", err)
	}

	got := make([]string, 0, len(targets))
	for _, target := range targets {
		rel, err := filepath.Rel(root, target.Path)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, filepath.ToSlash(rel)+":"+target.Location)
	}

	want := []string{
		"enabled.vpk:root",
		"workshop/3710541769.vpk:workshop",
		"workshop/nested/child.vpk:workshop",
	}
	if len(got) != len(want) {
		t.Fatalf("expected %d targets, got %d: %#v", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("target %d: expected %q, got %q (all=%#v)", i, want[i], got[i], got)
		}
	}
}

func TestModelStatsScanWorkerCountUsesPoolSlots(t *testing.T) {
	pool, err := ants.NewPool(4)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	defer pool.Release()

	app := &App{goroutinePool: pool}
	if got := app.modelStatsScanWorkerCount(10); got != 3 {
		t.Fatalf("expected 3 workers with a 4-slot pool, got %d", got)
	}
	if got := app.modelStatsScanWorkerCount(2); got != 2 {
		t.Fatalf("expected worker count to be capped by target count, got %d", got)
	}
	if got := app.modelStatsScanWorkerCount(0); got != 0 {
		t.Fatalf("expected zero workers for zero targets, got %d", got)
	}
}

func writeEmptyFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}
}
