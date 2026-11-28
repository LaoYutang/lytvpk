const annotations = /\[[^\[\]\r\n]*\]|【[^【】\r\n]*】|\([^()\r\n]*\)|（[^（）\r\n]*）|〔[^〔〕\r\n]*〕|《[^《》\r\n]*》/gu;
const letter = /\p{L}/u;
const han = /\p{Script=Han}/u;
const hanRun = /\p{Script=Han}+/gu;
const latin = /\p{Script=Latin}/u;
const latinWord = /\p{Script=Latin}[\p{Script=Latin}\p{M}\p{N}]*(?:[-.'’][\p{Script=Latin}\p{M}\p{N}]+)*/gu;
const kanaOrHangul = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const shortChineseLabel = /^(?:中文|中[译譯]|[汉漢]化|[简簡]中|繁中|[简簡][体體](?:中文)?|繁[体體](?:中文)?|[国國]服|地[图圖]|皮[肤膚]|合集|(?:武器|地[图圖])?模[组組])$/u;

export function shouldKeepChineseTitle(text) {
  const main = titleMain(text);
  return isChineseMain(main, describeTitle(main));
}

export function isSafeChineseTitleTranslation(original, candidate) {
  const source = String(original ?? "");
  const translated = String(candidate ?? "");
  const main = titleMain(translated);
  const output = describeTitle(main);
  if (!isChineseMain(main, output)) return false;

  const sourceMain = titleMain(source);
  const sourceIsJapaneseOrKorean = kanaOrHangul.test(sourceMain);
  // Han in a Japanese or Korean sentence may change during translation, but
  // balanced annotations without Kana or Hangul may be Chinese labels.
  const existing = sourceIsJapaneseOrKorean
    ? (source.match(annotations) || []).filter((part) => !kanaOrHangul.test(part)).join(" ")
    : source;
  let offset = 0;
  for (const run of existing.match(hanRun) || []) {
    const index = translated.indexOf(run, offset);
    if (index === -1) return false;
    offset = index + run.length;
  }

  if (!sourceIsJapaneseOrKorean && describeTitle(translated).han <= describeTitle(source).han) return false;
  if (output.han > 1) return true;
  const input = describeTitle(sourceMain);
  return input.words.length <= 1 && (!sourceIsJapaneseOrKorean || input.han + input.foreign <= 4);
}

function titleMain(text) {
  const normalized = String(text ?? "").normalize("NFKC");
  const main = normalized.replace(annotations, " ");
  const letters = main.replace(/[^\p{L}]/gu, "");
  const couldBeOnlyLabel = shortChineseLabel.test(letters) || (Array.from(letters).length === 1 && han.test(letters));
  return letters && !couldBeOnlyLabel ? main : normalized;
}

function describeTitle(text) {
  const hanLetters = [];
  const foreignLetters = [];
  for (const character of text) {
    if (!letter.test(character)) continue;
    if (han.test(character)) hanLetters.push(character);
    else foreignLetters.push(character);
  }
  return {
    han: hanLetters.length,
    hasOnlyLabel: shortChineseLabel.test(hanLetters.join("")),
    foreign: foreignLetters.length,
    onlyLatin: foreignLetters.every((character) => latin.test(character)),
    words: text.match(latinWord) || [],
  };
}

function isChineseMain(main, stats) {
  if (!stats.han || !stats.onlyLatin) return false;
  // The title alone does not distinguish Han-only Chinese from Japanese Kanji.
  if (!stats.foreign) return true;
  if (stats.hasOnlyLabel) return false;

  const sections = main.split(/[/|]/u).filter((section) => letter.test(section));
  if (sections.length === 2) {
    const [left, right] = sections.map(describeTitle);
    const [chinese, other] = left.han ? [left, right] : [right, left];
    if (chinese.han >= 2 && !chinese.foreign && !chinese.hasOnlyLabel && !other.han
        && isShortLatinLabel(other, chinese.han, true)) return true;
  }

  // Mixed prose needs a substantive Chinese portion to treat the Latin segment
  // as a name or model. A short Chinese prefix alone does not qualify.
  return stats.han >= 4 && isShortLatinLabel(stats, stats.han);
}

function isShortLatinLabel({ words, foreign, onlyLatin }, chineseLength, paired = false) {
  if (!onlyLatin || !words.length || words.length > 3 || foreign > chineseLength * 4 + 6) return false;
  const looksNamed = words.every((word) => /^\p{Lu}/u.test(word) || /\p{N}/u.test(word));
  return looksNamed || words.length * 2 <= chineseLength + (paired ? 2 : 0);
}
