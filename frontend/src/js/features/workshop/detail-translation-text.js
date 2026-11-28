import { isSafeChineseTitleTranslation, shouldKeepChineseTitle } from "./detail-title-language.js";

const tagName = String.raw`(?:[a-z0-9][a-z0-9.+/_:-]{0,31}|Source Engine|Steam Workshop|No HUD|\d+\s+(?:Players|Survivors)|(?:VScript|RNG|HD|4K)[ :,-]+[a-z0-9 +/_:-]{1,32})`;
const technicalTag = String.raw`(?:\[[ \t]*${tagName}[ \t]*\]|【[ \t]*${tagName}[ \t]*】)`;
const webAddress = String.raw`(?:https?://|www\.)[^\s<>"'()\[\]【】]+`;
const gameTermNames = [
  "Bill|Francis|Louis|Zoey|Coach|Ellis|Nick|Rochelle",
  "Tank|Witch|Hunter|Smoker|Boomer|Charger|Jockey|Spitter",
  "AK[- ]?(?:47|74)|AKM|M16(?:A[1-4])?|M4(?:A1)?|SG[- ]?552|SCAR(?:[- ][HL])?|M60",
  "Uzi|MAC[- ]?10|MP[- ]?5(?:SD)?|Mini[- ]?14|AWP|SPAS(?:[- ]?12)?|M1014",
  String.raw`Glock(?:[- ]?\d{2})?|Desert Eagle|P90|UMP[- ]?45|SSG[- ]?08`,
  "VScript|L4D2?|Source Engine|SourceMod|Squirrel|Steam Workshop|Steam|RNG|HUD|VPK|VTF|VMT|BSP|MDL",
];
const gameTerms = String.raw`\b(?:${gameTermNames.join("|")})\b`;
const protectedTerms = `${technicalTag}|${webAddress}|${gameTerms}`;
const protectedTerm = new RegExp(protectedTerms, "giu");
const hanLabel = String.raw`[ \t]*\p{Script=Han}[\p{Script=Han}0-9 \t·-]*`;
const chineseAnnotation = String.raw`(?:\[${hanLabel}\]|【${hanLabel}】|\(${hanLabel}\)|（${hanLabel}）)`;
const nameCandidate = String.raw`(?<nameCandidate>\b[A-Za-z][A-Za-z0-9]*\b)`;
const titleBrackets = String.raw`[()（）\[\]【】〔〕《》「」『』{}]`;
const titleBracket = new RegExp(titleBrackets, "u");
const titleBoundaryBrackets = new RegExp(String.raw`^(?:${titleBrackets}|\s)+|(?:${titleBrackets}|\s)+$`, "gu");
const titleLanguageTerms = new RegExp(`${protectedTerms}|${nameCandidate}`, "giu");
const protectedChineseTitleTerm = new RegExp(`${chineseAnnotation}|${protectedTerms}|${titleBrackets}|${nameCandidate}`, "giu");
const letter = /\p{L}/u;
const han = /\p{Script=Han}/u;
const segmentContent = /[\p{L}\p{N}](?:[\s\S]*[\p{L}\p{M}\p{N}])?/u;

export async function translateWorkshopText(text, translate, { isTitle = false, targetLanguage = "", isCurrent = () => true } = {}) {
  const original = String(text ?? "").trim();
  const chineseTitle = isTitle && /^zh(?:$|[-_])/i.test(targetLanguage);
  const originalParts = splitProtectedTerms(original, chineseTitle ? titleLanguageTerms : protectedTerm);
  if (chineseTitle && shouldKeepChineseTitle(unprotectedText(originalParts))) return original;

  const termPattern = chineseTitle ? protectedChineseTitleTerm : protectedTerm;
  const parts = chineseTitle ? splitProtectedTerms(original, termPattern) : originalParts;
  const translatable = parts.filter((part) => !part.protected && hasTranslatableLetters(part.text, isTitle));
  if (translatable.length === 0 || !isCurrent()) return original;

  if (parts.length === 1) {
    const result = await translate(original);
    return isCurrent() ? changedFragment(result, original, chineseTitle) : original;
  }

  // Give the provider the full context when terms are embedded in prose.
  // Straightforward titles with one prose span need only one request.
  const terms = parts.filter((part) => part.protected);
  const hasNamedTerm = terms.some((part) => part.isNamedTerm);
  // Preserve the title's own delimiters and translate the prose separately from
  // stylized names, so a provider cannot treat the whole phrase as a name.
  const needsSeparateTitleParts = chineseTitle && (titleBracket.test(original) || terms.some((part) => part.stylizedName));
  if (!needsSeparateTitleParts && (translatable.length > 1 || (!isTitle && hasNamedTerm))) {
    const contextual = String(await translate(original) ?? "").trim();
    if (!isCurrent()) return original;
    if (contextual && keptEveryTerm(contextual, terms, termPattern)) return changedText(contextual, original, chineseTitle);
  }

  const translatedParts = new Map();
  for (const part of translatable) {
    const segment = part.text.match(segmentContent);
    const input = segment[0];
    if (!translatedParts.has(input)) {
      if (!isCurrent()) return original;
      const result = await translate(input);
      if (!isCurrent()) return original;
      translatedParts.set(input, changedFragment(result, input, chineseTitle));
    }
    part.text = part.text.slice(0, segment.index) + translatedParts.get(input)
      + part.text.slice(segment.index + input.length);
  }
  return changedText(parts.map((part) => part.text).join(""), original, chineseTitle);
}

function splitProtectedTerms(text, termPattern = protectedTerm) {
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(termPattern)) {
    let value = match[0];
    const stylizedName = Boolean(match.groups?.nameCandidate);
    if (stylizedName && !/[a-z][A-Z]/.test(value)) continue;
    const isAddress = /^(?:https?:\/\/|www\.)/i.test(value);
    if (isAddress) value = value.replace(/[.,!?;:，。！？；：]+$/u, "");
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    const isNamedTerm = !isAddress && !value.startsWith("[") && !value.startsWith("【");
    parts.push({ text: value, protected: true, isNamedTerm, stylizedName });
    offset = match.index + value.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

function hasTranslatableLetters(text, isTitle) {
  if (!isTitle) return letter.test(text);
  // Han-only titles are treated as Chinese. Kana and Hangul still trigger
  // translation, but a Japanese title written entirely in Kanji is ambiguous.
  return Array.from(text).some((character) => letter.test(character) && !han.test(character));
}

function keptEveryTerm(text, originalTerms, termPattern) {
  const counts = new Map();
  for (const { text } of originalTerms) counts.set(text, (counts.get(text) || 0) + 1);
  for (const part of splitProtectedTerms(text, termPattern)) {
    if (!part.protected) continue;
    const count = counts.get(part.text);
    if (!count) return false;
    if (count === 1) counts.delete(part.text);
    else counts.set(part.text, count - 1);
  }
  return counts.size === 0;
}

function unprotectedText(parts) {
  return parts.filter((part) => !part.protected).map((part) => part.text).join(" ");
}

function changedFragment(result, original, chineseTitle) {
  if (!chineseTitle) return changedText(result, original, false);

  // Title delimiters are already stored in the source parts. Remove wrappers
  // inserted at fragment boundaries, including repeated or unmatched ones.
  const translated = String(result ?? "").replace(titleBoundaryBrackets, "");
  if (titleBracket.test(translated)) return original;
  return changedText(translated, original, true);
}

function changedText(result, original, chineseTitle) {
  const translated = String(result ?? "").trim();
  if (!translated || translated.replace(/\s+/g, " ") === original.replace(/\s+/g, " ")) return original;
  if (chineseTitle && !isSafeChineseTitleTranslation(
    unprotectedText(splitProtectedTerms(original, titleLanguageTerms)),
    unprotectedText(splitProtectedTerms(translated, titleLanguageTerms)),
  )) return original;
  return translated;
}
