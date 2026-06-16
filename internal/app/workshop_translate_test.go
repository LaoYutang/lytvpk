package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkshopTranslateProviderSaveLoadAndValidation(t *testing.T) {
	app := newConfigTestApp(t)

	if got := app.GetWorkshopTranslateProvider(); got != workshopTranslateProviderMicrosoft {
		t.Fatalf("expected default provider %q, got %q", workshopTranslateProviderMicrosoft, got)
	}
	if err := app.SetWorkshopTranslateProvider(workshopTranslateProviderYandex); err != nil {
		t.Fatalf("set provider: %v", err)
	}
	if got := app.GetWorkshopTranslateProvider(); got != workshopTranslateProviderYandex {
		t.Fatalf("expected provider %q, got %q", workshopTranslateProviderYandex, got)
	}
	if err := app.SetWorkshopTranslateProvider("invalid"); err == nil {
		t.Fatalf("expected invalid provider to be rejected")
	}
	if got := app.GetWorkshopTranslateProvider(); got != workshopTranslateProviderYandex {
		t.Fatalf("expected invalid provider not to change state, got %q", got)
	}

	reloaded := newConfigTestApp(t)
	reloaded.configDir = app.configDir
	reloaded.configPath = app.configPath
	reloaded.serversPath = app.serversPath
	reloaded.workshopWatchLaterPath = app.workshopWatchLaterPath
	reloaded.loadConfig()
	if got := reloaded.GetWorkshopTranslateProvider(); got != workshopTranslateProviderYandex {
		t.Fatalf("expected loaded provider %q, got %q", workshopTranslateProviderYandex, got)
	}
}

func TestTranslateWorkshopDescriptionWithYandex(t *testing.T) {
	originalBaseURL := yandexTranslateBaseURL
	originalClient := workshopTranslateClient
	defer func() {
		yandexTranslateBaseURL = originalBaseURL
		workshopTranslateClient = originalClient
	}()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("User-Agent"); got != "ru.yandex.translate/3.20.2024" {
			t.Fatalf("unexpected user agent: %q", got)
		}
		if r.URL.Path == "/api/v1/tr.json/detect" {
			if r.URL.Query().Get("srv") != "android" || r.URL.Query().Get("id") == "" || r.URL.Query().Get("text") != "hello" {
				t.Fatalf("unexpected detect query: %s", r.URL.RawQuery)
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"code":200,"lang":"en"}`))
			return
		}
		if r.URL.Path != "/api/v1/tr.json/translate" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("srv") != "android" || r.URL.Query().Get("format") != "text" || r.URL.Query().Get("ucid") == "" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		if got := r.FormValue("text"); got != "hello" {
			t.Fatalf("unexpected text: %q", got)
		}
		if got := r.FormValue("lang"); got != "en-zh" {
			t.Fatalf("unexpected lang: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"code":200,"lang":"en-zh","text":["你好"]}`))
	}))
	defer server.Close()

	yandexTranslateBaseURL = server.URL + "/api/v1/tr.json"
	workshopTranslateClient = server.Client()

	app := newConfigTestApp(t)
	if err := app.SetWorkshopTranslateProvider(workshopTranslateProviderYandex); err != nil {
		t.Fatalf("set provider: %v", err)
	}
	result, err := app.TranslateWorkshopDescription("hello")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if result.Provider != workshopTranslateProviderYandex || result.Text != "你好" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestTranslateWorkshopDescriptionWithYandexChineseSource(t *testing.T) {
	originalBaseURL := yandexTranslateBaseURL
	originalClient := workshopTranslateClient
	defer func() {
		yandexTranslateBaseURL = originalBaseURL
		workshopTranslateClient = originalClient
	}()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/tr.json/detect" {
			t.Fatalf("expected detect only, got path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"code":200,"lang":"zh"}`))
	}))
	defer server.Close()

	yandexTranslateBaseURL = server.URL + "/api/v1/tr.json"
	workshopTranslateClient = server.Client()

	app := newConfigTestApp(t)
	if err := app.SetWorkshopTranslateProvider(workshopTranslateProviderYandex); err != nil {
		t.Fatalf("set provider: %v", err)
	}
	result, err := app.TranslateWorkshopDescription("你好")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if result.Provider != workshopTranslateProviderYandex || result.Text != "你好" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestTranslateWorkshopDescriptionWithMicrosoftSignature(t *testing.T) {
	originalBaseURL := microsoftTranslateBaseURL
	originalClient := workshopTranslateClient
	defer func() {
		microsoftTranslateBaseURL = originalBaseURL
		workshopTranslateClient = originalClient
	}()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/translate" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("api-version") != "3.0" || r.URL.Query().Get("to") != "zh-Hans" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		if signature := r.Header.Get("X-MT-Signature"); !strings.HasPrefix(signature, "MSTranslatorAndroidApp::") {
			t.Fatalf("missing microsoft signature: %q", signature)
		}

		var body []map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if len(body) != 1 || body[0]["Text"] != "hello" {
			t.Fatalf("unexpected body: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"translations":[{"text":"你好","to":"zh-Hans"}]}]`))
	}))
	defer server.Close()

	microsoftTranslateBaseURL = server.URL
	workshopTranslateClient = server.Client()

	app := newConfigTestApp(t)
	result, err := app.TranslateWorkshopDescription("hello")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if result.Provider != workshopTranslateProviderMicrosoft || result.Text != "你好" {
		t.Fatalf("unexpected result: %#v", result)
	}
}
