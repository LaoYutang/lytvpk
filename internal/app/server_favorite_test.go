package app

import (
	"os"
	"testing"
)

func TestAddFavoriteServer(t *testing.T) {
	app := newConfigTestApp(t)

	added, err := app.addFavoriteServer("  测试服务器  ", "  example.com  ")
	if err != nil {
		t.Fatalf("addFavoriteServer returned error: %v", err)
	}
	if !added {
		t.Fatal("expected server to be added")
	}

	storage := app.GetServerStorage()
	if len(storage.Servers) != 1 {
		t.Fatalf("expected one favorite server, got %#v", storage.Servers)
	}
	server := storage.Servers[0]
	if server.Name != "测试服务器" || server.Address != "example.com:27015" {
		t.Fatalf("unexpected favorite server: %#v", server)
	}
	if server.ID == "" {
		t.Fatal("expected favorite server to receive an ID")
	}
}

func TestAddFavoriteServerIsIdempotentByAddress(t *testing.T) {
	app := newConfigTestApp(t)
	if err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{Name: "原名称", Address: "EXAMPLE.com:27015", Weight: 10}},
	}); err != nil {
		t.Fatalf("save initial server: %v", err)
	}

	added, err := app.addFavoriteServer("新名称", "example.COM")
	if err != nil {
		t.Fatalf("addFavoriteServer returned error: %v", err)
	}
	if added {
		t.Fatal("expected duplicate server address to be skipped")
	}

	storage := app.GetServerStorage()
	if len(storage.Servers) != 1 || storage.Servers[0].Name != "原名称" {
		t.Fatalf("expected existing favorite to remain unchanged, got %#v", storage.Servers)
	}
}

func TestAddFavoriteServerDoesNotOverwriteInvalidStorage(t *testing.T) {
	app := newConfigTestApp(t)
	badJSON := []byte("{bad json")
	if err := os.WriteFile(app.serversPath, badJSON, 0644); err != nil {
		t.Fatalf("write invalid storage: %v", err)
	}

	if _, err := app.addFavoriteServer("测试服务器", "127.0.0.1:27015"); err == nil {
		t.Fatal("expected invalid storage to prevent adding a favorite")
	}

	got, err := os.ReadFile(app.serversPath)
	if err != nil {
		t.Fatalf("read invalid storage: %v", err)
	}
	if string(got) != string(badJSON) {
		t.Fatalf("expected invalid storage to remain untouched, got %q", got)
	}
}

func TestSaveServerStorageUsesDefaultPort(t *testing.T) {
	app := newConfigTestApp(t)
	if err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{Name: "无端口服务器", Address: "127.0.0.1"}},
	}); err != nil {
		t.Fatalf("SaveServerStorage returned error: %v", err)
	}

	storage := app.GetServerStorage()
	if len(storage.Servers) != 1 || storage.Servers[0].Address != "127.0.0.1:27015" {
		t.Fatalf("expected default port in stored address, got %#v", storage.Servers)
	}
}
