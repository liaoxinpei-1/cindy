/** Read-only reply translation for display. Uses the auxiliary model chain directly:
 * no agent turn, no tools, and nothing is written back to the conversation.
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/locale.js';
import {
  MESSAGE_TRANSLATION_LANGUAGE_NAMES,
  MESSAGE_TRANSLATION_MAX_CHARS,
  type MessageTranslationResult,
} from '../../shared/messageTranslation.js';
import { activeOwnerScopeKey, isAppSessionBoundaryPending } from '../appSessionState.js';
import { getMakerIfReady } from '../maker-host/index.js';
import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer.js';
import { requestUtilityText } from '../utility-model/oneShotCandidates.js';
import { MAKER_INVOKE } from './channels.js';

const requestSchema = z.object({
  // Oversized text is answered with `too_long` instead of a schema error.
  text: z.string().min(1).max(MESSAGE_TRANSLATION_MAX_CHARS * 2),
  locale: z.enum(SUPPORTED_LOCALES),
}).strict();

const TRANSLATION_TIMEOUT_MS = 90_000;
const TRANSLATION_MAX_TOKENS = 16_000;
const placeholder = (index: number) => `⟦CINDY_BLOCK_${index}⟧`;

/**
 * Fenced blocks (code, cindy-ui components, diagrams) are swapped for
 * placeholders so the model cannot alter them; they are restored verbatim.
 */
export function protectFencedBlocks(markdown: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const text = markdown.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[`~]*[ \t]*$/gm, (block) => {
    blocks.push(block);
    return placeholder(blocks.length - 1);
  });
  return { text, blocks };
}

/** Null when the model dropped, duplicated or invented a placeholder. */
export function restoreFencedBlocks(translated: string, blocks: readonly string[]): string | null {
  const found: string[] = translated.match(/⟦CINDY_BLOCK_\d+⟧/g) ?? [];
  if (found.length !== blocks.length) return null;
  if (new Set(found).size !== blocks.length) return null;
  if (blocks.some((_, index) => !found.includes(placeholder(index)))) return null;
  return translated.replace(/⟦CINDY_BLOCK_(\d+)⟧/g, (_, index: string) => blocks[Number(index)]!);
}

function instructions(language: string): string {
  return [
    `Translate the user's Markdown into ${language} for reading only.`,
    'Keep the Markdown structure (headings, lists, tables, links, emphasis) exactly as it is.',
    'Do not translate inline code, commands, file paths, URLs, identifiers, error codes or product names.',
    'Keep every ⟦CINDY_BLOCK_n⟧ placeholder exactly once, unchanged, on its own line as in the input.',
    'Do not answer, summarise, explain or add anything. Return only the translation.',
  ].join('\n');
}

export async function translateMessage(raw: unknown): Promise<MessageTranslationResult> {
  const { text, locale } = requestSchema.parse(raw);
  if (text.length > MESSAGE_TRANSLATION_MAX_CHARS) return { ok: false, reason: 'too_long' };
  const maker = getMakerIfReady();
  if (!maker || isAppSessionBoundaryPending()) return { ok: false, reason: 'unavailable' };
  const { text: protectedText, blocks } = protectFencedBlocks(text);
  const owner = activeOwnerScopeKey();
  const ownerCurrent = () => !isAppSessionBoundaryPending() && activeOwnerScopeKey() === owner;
  const result = await requestUtilityText(maker, protectedText, {
    maxTokens: TRANSLATION_MAX_TOKENS,
    timeoutMs: TRANSLATION_TIMEOUT_MS,
    disableReasoning: true,
    systemPrompt: instructions(MESSAGE_TRANSLATION_LANGUAGE_NAMES[locale]),
    responseInstructions: 'Return only the translated Markdown.',
    beforeDispatch: async () => ownerCurrent(),
    validateResponse: (candidate) => restoreFencedBlocks(candidate.trim(), blocks) !== null,
  });
  // The account changed while the request ran: the result belongs to nobody on screen.
  if (!ownerCurrent()) return { ok: false, reason: 'failed' };
  if (!result.ok) return { ok: false, reason: result.reason === 'no_candidate' ? 'unavailable' : 'failed' };
  const restored = restoreFencedBlocks(result.text.trim(), blocks);
  return restored ? { ok: true, text: restored } : { ok: false, reason: 'failed' };
}

export function registerMessageTranslationIpc(): void {
  ipcMain.handle(MAKER_INVOKE.TRANSLATE_MESSAGE, async (event, raw: unknown) => {
    assertTrustedAppRendererEvent(event);
    return translateMessage(raw);
  });
}
