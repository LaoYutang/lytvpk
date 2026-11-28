import { workshopDeps } from "./deps.js";
import { translateWorkshopText } from "./detail-translation-text.js";
import { escapeHtml, getWorkshopItemId } from "./utils.js";

const translationCache = new Map();

export function splitDescriptionParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function stripDescriptionFormattingTags(text) {
  return text.replace(
    /\[\/?(?:h[1-3]|b|u|i|strike|spoiler|hr|noparse|table|tr|td|th|list|olist|center|left|right|indent|size|color|font|url|img|code|quote|youtube|previewyoutube|video)(?:=[^\]]*)?\]/gi,
    "",
  );
}

function descriptionToPlainText(text = "") {
  return stripDescriptionFormattingTags(text
    .replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gis, "$2 ($1)")
    .replace(/\[img\](.*?)\[\/img\]/gis, "")
    .replace(/\[quote\](.*?)\[\/quote\]/gis, "\n$1\n")
    .replace(/\[\*\]/g, "\n- "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function bindWorkshopDetailTranslation(detailView, detail, isCurrentDetail) {
  const button = detailView.querySelector("[data-translate-description-btn]");
  if (!button) return;

  const heading = detailView.querySelector(".detail-title-large");
  const originalTitle = String(detail.title || "");
  const titleCaption = document.createElement("p");
  titleCaption.className = "detail-title-original hidden";
  titleCaption.textContent = originalTitle;
  heading.after(titleCaption);

  const paragraphs = splitDescriptionParagraphs(detail.description);
  const segments = Array.from(detailView.querySelectorAll("[data-description-paragraph-index]"), (paragraph, index) => ({
    text: descriptionToPlainText(paragraphs[index]),
    output: paragraph.querySelector(".detail-paragraph-translation"),
    translation: "",
    failed: false,
  })).filter((segment) => segment.text);
  const icon = button.querySelector("svg");
  const label = button.querySelector("span");
  const spinner = createSpinner();
  spinner.classList.add("hidden");
  button.prepend(spinner);

  const isCurrent = () => isCurrentDetail() && detailView.contains(button);
  const itemId = getWorkshopItemId(detail);
  let translatedTitle = "";
  let hasTranslation = false;
  let viewingTranslation = false;

  function updateButton(loading = false) {
    button.disabled = loading;
    icon.classList.toggle("hidden", loading);
    spinner.classList.toggle("hidden", !loading);
    label.textContent = loading ? "翻译中..." : "翻译";
    if (!loading && hasTranslation) {
      label.textContent = viewingTranslation ? "查看原文" : "查看译文";
    }
  }

  function renderTitle(showTranslation) {
    const text = showTranslation ? translatedTitle : "";
    heading.textContent = text || originalTitle;
    titleCaption.classList.toggle("hidden", !text);
  }

  button.addEventListener("click", async () => {
    if (button.disabled || !isCurrent()) return;
    if (hasTranslation) {
      viewingTranslation = !viewingTranslation;
      renderTitle(viewingTranslation);
      segments.forEach((segment) => renderParagraphTranslation(segment, viewingTranslation));
      updateButton();
      return;
    }

    updateButton(true);
    const failures = [];
    try {
      const provider = (await workshopDeps.GetWorkshopTranslateProvider?.()) || "microsoft";
      if (!isCurrent()) return;

      const translate = async (text, isTitle = false) => {
        const key = JSON.stringify([itemId, provider, isTitle, text]);
        if (translationCache.has(key)) return translationCache.get(key);

        const translated = await translateWorkshopText(text, async (input) => {
          const result = await workshopDeps.TranslateWorkshopDescription(input);
          if (result?.provider && result.provider !== provider) {
            throw new Error("翻译服务已更改，请重试");
          }
          return result?.text;
        }, { isTitle, isCurrent });
        const changed = normalizeText(translated) === normalizeText(text) ? "" : translated;
        if (isCurrent()) translationCache.set(key, changed);
        return changed;
      };

      const translateTitle = async () => {
        if (!originalTitle.trim()) return;
        try {
          translatedTitle = await translate(originalTitle, true);
          if (isCurrent()) renderTitle(true);
        } catch (error) {
          failures.push(error);
        }
      };

      const translateDescription = async () => {
        for (const segment of segments) {
          if (!isCurrent()) return;
          showParagraphLoading(segment.output);
          try {
            segment.translation = await translate(segment.text);
            segment.failed = false;
          } catch (error) {
            failures.push(error);
            segment.failed = true;
          }
          if (isCurrent()) renderParagraphTranslation(segment, true);
        }
      };

      await Promise.all([translateTitle(), translateDescription()]);
    } catch (error) {
      failures.push(error);
    } finally {
      if (isCurrent()) {
        hasTranslation = Boolean(translatedTitle) || segments.some((segment) => segment.translation);
        viewingTranslation = hasTranslation;
        updateButton();
        reportTranslationResult(hasTranslation, failures);
      }
    }
  });
}

function createSpinner() {
  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  spinner.setAttribute("aria-hidden", "true");
  return spinner;
}

function showParagraphLoading(output) {
  const label = document.createElement("span");
  label.textContent = "翻译中...";
  output.replaceChildren(createSpinner(), label);
  output.classList.remove("hidden", "detail-translation-enter", "is-error");
  output.classList.add("is-loading");
}

function renderParagraphTranslation({ output, translation, failed }, showTranslation) {
  const text = showTranslation ? translation : "";
  const showError = showTranslation && failed;
  output.classList.remove("is-loading", "detail-translation-enter");
  output.classList.toggle("is-error", showError);
  output.classList.toggle("hidden", !text && !showError);
  output.textContent = showError ? "这一段翻译失败" : text;
  if (text) output.classList.add("detail-translation-enter");
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function reportTranslationResult(hasTranslation, failures) {
  if (failures.length && hasTranslation) {
    workshopDeps.showNotification?.("部分内容翻译失败，已保留对应原文", "info");
  } else if (failures.length) {
    const error = failures[0];
    workshopDeps.showError?.(`翻译失败：${escapeHtml(error?.message || error)}`);
  } else if (hasTranslation) {
    workshopDeps.showNotification?.("翻译完成", "success");
  } else {
    workshopDeps.showNotification?.("没有需要翻译的内容", "info");
  }
}
