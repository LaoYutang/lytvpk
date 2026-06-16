package app

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	workshopTranslateProviderYandex    = "yandex"
	workshopTranslateProviderMicrosoft = "microsoft"
	workshopTranslateProviderCustom    = "custom"
	workshopTranslateTargetYandex      = "zh"
	workshopTranslateTargetMicrosoft   = "zh-Hans"
	yandexTranslateUserAgent           = "ru.yandex.translate/3.20.2024"
)

var (
	yandexTranslateBaseURL    = "https://translate.yandex.net/api/v1/tr.json"
	microsoftTranslateBaseURL = "https://api.cognitive.microsofttranslator.com"
	workshopTranslateClient   = &http.Client{Timeout: 15 * time.Second}
)

type WorkshopTranslationResult struct {
	Provider string `json:"provider"`
	Text     string `json:"text"`
}

func normalizeWorkshopTranslateProvider(provider string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case workshopTranslateProviderMicrosoft, "":
		return workshopTranslateProviderMicrosoft, nil
	case workshopTranslateProviderYandex:
		return workshopTranslateProviderYandex, nil
	case workshopTranslateProviderCustom:
		return workshopTranslateProviderCustom, nil
	default:
		return "", fmt.Errorf("不支持的翻译类型: %s", provider)
	}
}

func (a *App) GetWorkshopTranslateProvider() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.workshopTranslateProvider == "" {
		return workshopTranslateProviderMicrosoft
	}
	return a.workshopTranslateProvider
}

func (a *App) SetWorkshopTranslateProvider(provider string) error {
	normalized, err := normalizeWorkshopTranslateProvider(provider)
	if err != nil {
		return err
	}

	a.mu.Lock()
	a.workshopTranslateProvider = normalized
	a.mu.Unlock()

	a.saveConfig()
	return nil
}

func (a *App) TranslateWorkshopDescription(text string) (WorkshopTranslationResult, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return WorkshopTranslationResult{}, fmt.Errorf("描述为空，无法翻译")
	}

	provider := a.GetWorkshopTranslateProvider()
	switch provider {
	case workshopTranslateProviderYandex:
		translated, err := translateWorkshopDescriptionWithYandex(text)
		if err != nil {
			return WorkshopTranslationResult{}, err
		}
		return WorkshopTranslationResult{Provider: workshopTranslateProviderYandex, Text: translated}, nil
	case workshopTranslateProviderCustom:
		translated, err := a.translateWorkshopDescriptionWithCustom(text)
		if err != nil {
			return WorkshopTranslationResult{}, err
		}
		return WorkshopTranslationResult{Provider: workshopTranslateProviderCustom, Text: translated}, nil
	default:
		translated, err := translateWorkshopDescriptionWithMicrosoft(text)
		if err != nil {
			return WorkshopTranslationResult{}, err
		}
		return WorkshopTranslationResult{Provider: workshopTranslateProviderMicrosoft, Text: translated}, nil
	}
}

func translateWorkshopDescriptionWithYandex(text string) (string, error) {
	sourceLang := detectWorkshopDescriptionYandexLanguage(text)
	if sourceLang == workshopTranslateTargetYandex {
		return text, nil
	}
	if sourceLang == "" {
		sourceLang = "en"
	}

	endpoint := strings.TrimRight(yandexTranslateBaseURL, "/") + "/translate"
	values := url.Values{}
	values.Set("ucid", newWorkshopTranslateUCID())
	values.Set("srv", "android")
	values.Set("format", "text")
	endpoint += "?" + values.Encode()

	form := url.Values{}
	form.Set("text", text)
	form.Set("lang", sourceLang+"-"+workshopTranslateTargetYandex)

	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", yandexTranslateUserAgent)

	resp, err := workshopTranslateClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", translateHTTPError(resp)
	}

	var result struct {
		Code    int      `json:"code"`
		Message string   `json:"message"`
		Text    []string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Code != 0 && result.Code != http.StatusOK {
		if result.Message != "" {
			return "", fmt.Errorf("Yandex 翻译失败: %s", result.Message)
		}
		return "", fmt.Errorf("Yandex 翻译失败，状态码: %d", result.Code)
	}
	if len(result.Text) == 0 || strings.TrimSpace(result.Text[0]) == "" {
		return "", fmt.Errorf("Yandex 翻译没有返回结果")
	}
	return result.Text[0], nil
}

func detectWorkshopDescriptionYandexLanguage(text string) string {
	endpoint := strings.TrimRight(yandexTranslateBaseURL, "/") + "/detect"
	values := url.Values{}
	values.Set("id", newWorkshopTranslateUCID()+"-0-0")
	values.Set("srv", "android")
	values.Set("text", trimWorkshopTranslateDetectText(text))
	endpoint += "?" + values.Encode()

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", yandexTranslateUserAgent)

	resp, err := workshopTranslateClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}

	var result struct {
		Code int    `json:"code"`
		Lang string `json:"lang"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ""
	}
	if result.Code != 0 && result.Code != http.StatusOK {
		return ""
	}
	return normalizeYandexDetectedLanguage(result.Lang)
}

func trimWorkshopTranslateDetectText(text string) string {
	text = strings.TrimSpace(text)
	const maxRunes = 1000
	runes := []rune(text)
	if len(runes) <= maxRunes {
		return text
	}
	return string(runes[:maxRunes])
}

func normalizeYandexDetectedLanguage(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if lang == "" || lang == "auto" {
		return ""
	}
	if strings.HasPrefix(lang, "zh") {
		return workshopTranslateTargetYandex
	}
	if dash := strings.IndexByte(lang, '-'); dash > 0 {
		lang = lang[:dash]
	}
	if underscore := strings.IndexByte(lang, '_'); underscore > 0 {
		lang = lang[:underscore]
	}
	if len(lang) != 2 {
		return ""
	}
	return lang
}

func translateWorkshopDescriptionWithMicrosoft(text string) (string, error) {
	endpoint := strings.TrimRight(microsoftTranslateBaseURL, "/") + "/translate?api-version=3.0&to=" + url.QueryEscape(workshopTranslateTargetMicrosoft)
	signaturePath, err := signaturePathFromURL(endpoint)
	if err != nil {
		return "", err
	}

	payload, err := json.Marshal([]map[string]string{{"Text": text}})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36")
	req.Header.Set("X-MT-Signature", getMicrosoftTranslateSignature(signaturePath))

	resp, err := workshopTranslateClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", translateHTTPError(resp)
	}

	var result []struct {
		Translations []struct {
			Text string `json:"text"`
		} `json:"translations"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result) == 0 || len(result[0].Translations) == 0 || strings.TrimSpace(result[0].Translations[0].Text) == "" {
		return "", fmt.Errorf("Microsoft 翻译没有返回结果")
	}
	return result[0].Translations[0].Text, nil
}

func translateHTTPError(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	message := strings.TrimSpace(string(body))
	if message == "" {
		return fmt.Errorf("翻译接口返回状态码: %d", resp.StatusCode)
	}
	return fmt.Errorf("翻译接口返回状态码: %d，%s", resp.StatusCode, message)
}

func signaturePathFromURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	return parsed.Host + parsed.RequestURI(), nil
}

func getMicrosoftTranslateSignature(requestPath string) string {
	guid := newWorkshopTranslateUCID()
	escapedURL := url.QueryEscape(requestPath)
	dateTime := time.Now().UTC().Format("Mon, 02 Jan 2006 15:04:05GMT")
	signatureText := strings.ToLower("MSTranslatorAndroidApp" + escapedURL + dateTime + guid)

	mac := hmac.New(sha256.New, microsoftTranslatePrivateKey)
	mac.Write([]byte(signatureText))
	hash := mac.Sum(nil)

	return "MSTranslatorAndroidApp::" + base64.StdEncoding.EncodeToString(hash) + "::" + dateTime + "::" + guid
}

func newWorkshopTranslateUCID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err == nil {
		return hex.EncodeToString(b[:])
	}
	return hex.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
}

var microsoftTranslatePrivateKey = []byte{
	0xa2, 0x29, 0x3a, 0x3d, 0xd0, 0xdd, 0x32, 0x73,
	0x97, 0x7a, 0x64, 0xdb, 0xc2, 0xf3, 0x27, 0xf5,
	0xd7, 0xbf, 0x87, 0xd9, 0x45, 0x9d, 0xf0, 0x5a,
	0x09, 0x66, 0xc6, 0x30, 0xc6, 0x6a, 0xaa, 0x84,
	0x9a, 0x41, 0xaa, 0x94, 0x3a, 0xa8, 0xd5, 0x1a,
	0x6e, 0x4d, 0xaa, 0xc9, 0xa3, 0x70, 0x12, 0x35,
	0xc7, 0xeb, 0x12, 0xf6, 0xe8, 0x23, 0x07, 0x9e,
	0x47, 0x10, 0x95, 0x91, 0x88, 0x55, 0xd8, 0x17,
}

// --- 自定义AI翻译 ---

type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

func (a *App) translateWorkshopDescriptionWithCustom(text string) (string, error) {
	a.mu.RLock()
	baseURL := a.workshopTranslateCustomBaseURL
	encryptedAPIKey := a.workshopTranslateCustomAPIKey
	modelID := a.workshopTranslateCustomModelId
	a.mu.RUnlock()

	if baseURL == "" {
		return "", fmt.Errorf("自定义AI翻译Base URL未设置")
	}
	if encryptedAPIKey == "" {
		return "", fmt.Errorf("自定义AI翻译API Key未设置")
	}
	if modelID == "" {
		return "", fmt.Errorf("自定义AI翻译模型ID未设置")
	}

	apiKey, err := unprotectSecret(encryptedAPIKey)
	if err != nil {
		return "", fmt.Errorf("解密自定义AI翻译API Key失败: %w", err)
	}

	endpoint := strings.TrimRight(baseURL, "/") + "/chat/completions"

	payload, err := json.Marshal(map[string]interface{}{
		"model": modelID,
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": "你是一位专业的翻译助手。请将以下英文内容翻译成中文，保持语义准确、语言自然流畅。直接返回翻译结果，不要添加解释或额外内容。",
			},
			{
				"role":    "user",
				"content": "请翻译：" + text,
			},
		},
		"temperature": 0.3,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", translateHTTPError(resp)
	}

	var result openAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if result.Error != nil && result.Error.Message != "" {
		return "", fmt.Errorf("自定义AI翻译失败: %s", result.Error.Message)
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("自定义AI翻译没有返回结果")
	}
	return strings.TrimSpace(result.Choices[0].Message.Content), nil
}

func (a *App) GetWorkshopTranslateCustomBaseURL() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopTranslateCustomBaseURL
}

func (a *App) SetWorkshopTranslateCustomBaseURL(url string) {
	a.mu.Lock()
	a.workshopTranslateCustomBaseURL = strings.TrimSpace(url)
	a.mu.Unlock()
	a.saveConfig()
}

func (a *App) GetWorkshopTranslateCustomModelId() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopTranslateCustomModelId
}

func (a *App) SetWorkshopTranslateCustomModelId(modelID string) {
	a.mu.Lock()
	a.workshopTranslateCustomModelId = strings.TrimSpace(modelID)
	a.mu.Unlock()
	a.saveConfig()
}

func (a *App) SetWorkshopTranslateCustomAPIKey(key string) error {
	encrypted, err := protectSecret(strings.TrimSpace(key))
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.workshopTranslateCustomAPIKey = encrypted
	a.mu.Unlock()
	a.saveConfig()
	return nil
}

func (a *App) HasWorkshopTranslateCustomAPIKey() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopTranslateCustomAPIKey != ""
}
