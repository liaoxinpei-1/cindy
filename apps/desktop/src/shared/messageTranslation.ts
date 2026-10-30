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
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ');
}

/**
 * Whether a reply is mostly written in a language other than `locale`, so a
 * translate action is worth offering. Chinese UI accepts either Chinese
 * script variant; Japanese text is recognised by kana, not by kanji alone.
 */
export function needsTranslation(markdown: string, locale: SupportedLocale): boolean {
  const counts: Record<Script, number> = { han: 0, kana: 0, hangul: 0, latin: 0, cyrillic: 0, other: 0 };
  let total = 0;
  // Latin is counted per word so a Chinese sentence is not outweighed by one English term.
  for (const token of proseOf(markdown).match(/\p{Script=Latin}+|\p{L}/gu) ?? []) {
    const script = scriptOf(token[0]!);
    if (!script) continue;
    counts[script] += 1;
    total += 1;
  }
  if (total < 3) return false;
  const share = (script: Script) => counts[script] / total;
  switch (locale) {
    case 'zh-CN':
    case 'zh-TW':
      return counts.kana > 0 || share('han') < 0.5;
    case 'ja':
      return share('kana') + share('han') < 0.5;
    case 'ko':
      return share('hangul') < 0.5;
    case 'en':
      return share('latin') < 0.5;
  }
}

export const MESSAGE_TRANSLATION_LANGUAGE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
};
