import { describe, expect, it } from 'vitest';

import {
  extractToolResultDiagnostics,
  formatToolResultCompactionBytes,
  parseToolResultCompactionMarker,
} from '../toolResultCompaction.js';

describe('tool result compaction marker', () => {
  const marker = {
    type: 'tool_result_compacted',
    version: 1,
    originalBytes: 128 * 1024,
    compactedAt: 500,
  } as const;

  it('parses persisted strings and mapped message objects', () => {
    expect(parseToolResultCompactionMarker(JSON.stringify(marker))).toEqual(marker);
    expect(parseToolResultCompactionMarker(marker)).toEqual(marker);
  });

  it('rejects malformed or unsupported values', () => {
    expect(parseToolResultCompactionMarker('{')).toBeNull();
    expect(parseToolResultCompactionMarker({ ...marker, version: 2 })).toBeNull();
    expect(parseToolResultCompactionMarker({ ...marker, originalBytes: -1 })).toBeNull();
    expect(parseToolResultCompactionMarker('ordinary tool output')).toBeNull();
  });

  it('formats the retained original byte count consistently across clients', () => {
    expect(formatToolResultCompactionBytes(128 * 1024)).toBe('128 KB');
    expect(formatToolResultCompactionBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });

  it('字节数取整后跨过档位时升档,不留 "1024 KB" / "1024.0 MB"', () => {
    expect(formatToolResultCompactionBytes(1023.6)).toBe('1.0 KB');
    expect(formatToolResultCompactionBytes(1024 * 1024 - 1)).toBe('1.0 MB');
    expect(formatToolResultCompactionBytes(1023)).toBe('1023 B');
    expect(formatToolResultCompactionBytes(1024 * 1023)).toBe('1023 KB');
    // 各档原有精度不变:MB/GB 始终一位小数,只有取整后真的达到 1024 才升档。
    expect(formatToolResultCompactionBytes(12.4 * 1024 * 1024)).toBe('12.4 MB');
    expect(formatToolResultCompactionBytes(10.5 * 1024 * 1024)).toBe('10.5 MB');
    expect(formatToolResultCompactionBytes(50.49 * 1024 * 1024)).toBe('50.5 MB');
    expect(formatToolResultCompactionBytes(1024 * 1024 * 1023.6)).toBe('1023.6 MB');
  });
});


// CU-008: preserve observed uncertainty without retaining private payloads or guessing from prose.
describe('tool result diagnostics', () => {
  it('keeps verification and observation separate from an unknown action', () => {
    expect(extractToolResultDiagnostics(JSON.stringify({
      tool: 'click', ok: false, outcome: { status: 'unknown' },
      data: { outcome_unknown: true, effect: 'unverifiable', status: 'unsatisfied', delivery: { mode: 'background' } },
      observation: { ok: true, screenshot: 'PRIVATE' },
    }))).toEqual({ ok: false, outcome: 'unknown', outcomeUnknown: true, effect: 'unverifiable',
      verificationStatus: 'unsatisfied', deliveryMode: 'background', observationOk: true });
  });

  it('drops private and unrecognized fields when reading a marker', () => {
    const marker = { type: 'tool_result_compacted', version: 1, originalBytes: 200, compactedAt: 1 };
    expect(parseToolResultCompactionMarker({ ...marker, diagnostics: {
      ok: false, errorCode: 'PRIVATE_SECRET', afterSnapshotErrorCode: 'PRIVATE_TOKEN', observationErrorCode: 'PRIVATE', effect: 'PRIVATE', input: 'PRIVATE', message: 'PRIVATE',
    } })).toEqual({ ...marker, diagnostics: { ok: false } });
    expect(parseToolResultCompactionMarker({ ...marker, diagnostics: { errorCode: 'PRIVATE' } })).toEqual(marker);
  });

  it('unwraps one MCP text result while preserving the outer error flag', () => {
    expect(extractToolResultDiagnostics({ isError: true, content: [{ type: 'text',
      text: JSON.stringify({ ok: false, errorCode: 'BROWSER_RUNTIME_INVALID_REQUEST' }) }] }))
      .toEqual({ ok: false, isError: true, errorCode: 'BROWSER_RUNTIME_INVALID_REQUEST' });
    expect(extractToolResultDiagnostics({ content: [
      { type: 'text', text: '{"ok":true}' }, { type: 'text', text: '{"ok":false}' },
    ] })).toBeUndefined();
  });

  it('handles encoded errors without inventing a code from free text', () => {
    expect(extractToolResultDiagnostics(JSON.stringify('<tool_use_error>{"ok":false,"code":"STALE_SNAPSHOT"}</tool_use_error>')))
      .toEqual({ ok: false, isError: true, errorCode: 'STALE_SNAPSHOT' });
    expect(extractToolResultDiagnostics('<tool_use_error>PRIVATE failure</tool_use_error>')).toEqual({ isError: true });
    expect(extractToolResultDiagnostics('STALE_SNAPSHOT PRIVATE failure')).toBeUndefined();
    expect(extractToolResultDiagnostics({ status: 'unknown' })).toEqual({ verificationStatus: 'unknown' });
    expect(extractToolResultDiagnostics('{"ok":true')).toBeUndefined();
    expect(extractToolResultDiagnostics(JSON.stringify({ ok: true, data: 'x'.repeat(1024 * 1024) }))).toBeUndefined();
  });
});
