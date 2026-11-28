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
const protectedTerm = new RegExp(`${technicalTag}|${webAddress}|${gameTerms}`, "giu");
const letter = /\p{L}/u;
const han = /\p{Script=Han}/u;
const segmentContent = /[\p{L}\p{N}](?:[\s\S]*[\p{L}\p{M}\p{N}])?/u;

export async function translateWorkshopText(text, translate, { isTitle = false, isCurrent = () => true } = {}) {
  const original = String(text ?? "").trim();
  const parts = splitProtectedTerms(original);
  const translatable = parts.filter((part) => !part.protected && hasTranslatableLetters(part.text, isTitle));
  if (translatable.length === 0 || !isCurrent()) return original;

  if (parts.length === 1) {
    const result = await translate(original);
    return isCurrent() ? changedText(result, original) : original;
  }

  // Give the provider the full context when terms are embedded in prose.
  // Straightforward titles with one prose span need only one request.
  const terms = parts.filter((part) => part.protected);
  const hasNamedTerm = terms.some((part) => part.isNamedTerm);
  if (translatable.length > 1 || (!isTitle && hasNamedTerm)) {
    const contextual = String(await translate(original) ?? "").trim();
    if (!isCurrent()) return original;
    if (contextual && keptEveryTerm(contextual, terms)) return changedText(contextual, original);
  }

  const translatedParts = new Map();
  for (const part of translatable) {
    const segment = part.text.match(segmentContent);
    const input = segment[0];
    if (!translatedParts.has(input)) {
      if (!isCurrent()) return original;
      const result = await translate(input);
      if (!isCurrent()) return original;
      translatedParts.set(input, changedText(result, input));
    }
    part.text = part.text.slice(0, segment.index) + translatedParts.get(input)
      + part.text.slice(segment.index + input.length);
  }
  return changedText(parts.map((part) => part.text).join(""), original);
}

function splitProtectedTerms(text) {
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(protectedTerm)) {
    let value = match[0];
    const isAddress = /^(?:https?:\/\/|www\.)/i.test(value);
    if (isAddress) value = value.replace(/[.,!?;:，。！？；：]+$/u, "");
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    const isNamedTerm = !isAddress && !value.startsWith("[") && !value.startsWith("【");
    parts.push({ text: value, protected: true, isNamedTerm });
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

function keptEveryTerm(text, originalTerms) {
  const counts = new Map();
  for (const { text } of originalTerms) counts.set(text, (counts.get(text) || 0) + 1);
  for (const part of splitProtectedTerms(text)) {
    if (!part.protected) continue;
    const count = counts.get(part.text);
    if (!count) return false;
    if (count === 1) counts.delete(part.text);
    else counts.set(part.text, count - 1);
  }
  return counts.size === 0;
}

function changedText(result, original) {
  const translated = String(result ?? "").trim();
  return translated && translated.replace(/\s+/g, " ") !== original.replace(/\s+/g, " ")
    ? translated
    : original;
}
