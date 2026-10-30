import type { SupportedLocale } from './locale';

/** Upper bound for one reply sent to the auxiliary model for translation. */
export const MESSAGE_TRANSLATION_MAX_CHARS = 40_000;

export interface MessageTranslationRequest {
  text: string;
  locale: SupportedLocale;
}

/** `unavailable` = no auxiliary model can run; `failed` = the attempt itself did not succeed. */
export type MessageTranslationResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'unavailable' | 'failed' | 'too_long' };

type Script = 'han' | 'kana' | 'hangul' | 'latin' | 'cyrillic' | 'other';

const SCRIPT_PATTERNS: ReadonlyArray<[Script, RegExp]> = [
  ['kana', /[぀-ヿ]/u],
  ['hangul', /[가-힯ᄀ-ᇿ]/u],
  ['han', /\p{Script=Han}/u],
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['other', /\p{L}/u],
];

function scriptOf(char: string): Script | null {
  for (const [script, pattern] of SCRIPT_PATTERNS) if (pattern.test(char)) return script;
  return null;
}

/** Prose only: code, links and inline literals stay as written and must not decide the language. */
function proseOf(markdown: string): string {
  return markdown
    // A fence left open at the end of a reply still runs to the end of the text.
    .replace(/^[ \t>]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t>]*\1[^\n]*$|(?![\s\S]))/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ');
}

/**
 * Frequent English words that are not also common words in other Latin-script
 * languages (so no `a`, `in`, `is`, `no`, `on`, `die`, `was`).
 */
const ENGLISH_MARKERS = new Set([
  'the', 'and', 'of', 'to', 'that', 'this', 'with', 'for', 'you', 'your', 'are', 'be', 'been',
  'it', 'its', 'not', 'have', 'has', 'will', 'can', 'from', 'by', 'would', 'should', 'there',
  'which', 'what', 'they', 'we', 'these', 'those', 'because', 'if', 'or', 'but', 'when', 'then',
]);

function looksEnglish(latinWords: readonly string[]): boolean {
  const hits = latinWords.filter((word) => ENGLISH_MARKERS.has(word.toLowerCase())).length;
  return hits >= 2 && hits / latinWords.length >= 0.15;
}

/**
 * Whether to offer a translate action for a reply. The entry is hidden only
 * when the reply is recognisably in the UI language; when that cannot be told
 * (a Latin-script reply that is not clearly English, Chinese characters
 * without kana in a Japanese UI, …) the manual entry stays available.
 */
export function needsTranslation(markdown: string, locale: SupportedLocale): boolean {
  const counts: Record<Script, number> = { han: 0, kana: 0, hangul: 0, latin: 0, cyrillic: 0, other: 0 };
  const latinWords: string[] = [];
  let total = 0;
  // Latin is counted per word so a Chinese sentence is not outweighed by one English term.
  for (const token of proseOf(markdown).match(/\p{Script=Latin}+|\p{L}/gu) ?? []) {
    const script = scriptOf(token[0]!);
    if (!script) continue;
    if (script === 'latin') latinWords.push(token);
    counts[script] += 1;
    total += 1;
  }
  // Nothing worth translating ("OK", a lone emoji or a code-only reply).
  if (total < 3) return false;
  const share = (script: Script) => counts[script] / total;
  switch (locale) {
    case 'zh-CN':
    case 'zh-TW':
      // Han without kana is Chinese; either script variant stays readable.
      return !(counts.kana === 0 && share('han') >= 0.5);
    case 'ja':
      // Japanese prose always carries kana; Han alone is more likely Chinese.
      return !(counts.kana > 0 && share('kana') + share('han') >= 0.5);
    case 'ko':
      return !(share('hangul') >= 0.5);
    case 'en':
      return !(share('latin') >= 0.5 && looksEnglish(latinWords));
  }
}

export const MESSAGE_TRANSLATION_LANGUAGE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
};
