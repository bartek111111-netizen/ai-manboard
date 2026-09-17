import { describe, expect, it } from 'vitest';
import { killTargetFor, parseDshPs } from './dsh.js';

describe('DSH control (dsh.ts): ps parsing + kill target', () => {
  it('parseDshPs: reads pid+pgid, dedupes by process group, skips non-numeric lines', () => {
    const out = [
      '  1234  1234 node --import tsx/esm apps/cli/src/bin.ts web',
      '  1240  1234 node_modules/.vite/vite.js',
      '  1250  1250 pnpm dsh web',
      'grep: no match',
    ].join('\n');
    // Two distinct groups: 1234 (wrapper + Vite, deduped to one entry) and 1250 (pnpm).
    expect(parseDshPs(out)).toEqual([
      { pid: 1234, pgid: 1234 },
      { pid: 1250, pgid: 1250 },
    ]);
  });

  it('parseDshPs: empty or error output → no processes', () => {
    expect(parseDshPs('')).toEqual([]);
    expect(parseDshPs('  \n  ')).toEqual([]);
    expect(parseDshPs('grep: something went wrong')).toEqual([]);
  });

  it('killTargetFor: a group leader (our detached spawn) kills the whole group (-pgid)', () => {
    expect(killTargetFor({ pid: 1234, pgid: 1234 })).toBe(-1234);
  });

  it('killTargetFor: not a group leader (external group) kills just that pid', () => {
    // A member of someone else's group must not drag that group down.
    expect(killTargetFor({ pid: 1240, pgid: 1234 })).toBe(1240);
  });
});
