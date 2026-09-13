import { describe, expect, it } from 'vitest';
import { classifyLlamaServerLog } from './logpatterns.js';

describe('classifyLlamaServerLog (PLAN §10.4 — Faza 2.6)', () => {
  it('RADV conformance warning is a known warning, not an error', () => {
    const c = classifyLlamaServerLog(
      'WARNING: radv is not a conformant Vulkan implementation, testing use only',
    );
    expect(c).toEqual({ level: 'info', knownWarning: true });
  });

  it('error patterns are classified as error', () => {
    for (const line of [
      'out of memory: cannot allocate 2 GB',
      'Vulkan: failed to create device',
      'no Vulkan devices found',
      'failed to load model weights',
      'error loading context',
      'could not allocate buffer',
    ]) {
      expect(classifyLlamaServerLog(line).level).toBe('error');
    }
  });

  it('a RADV line mentioning "failed" is still a known warning (known warnings win first)', () => {
    // The known-warning check runs before error patterns.
    const c = classifyLlamaServerLog('radv is not a conformant Vulkan implementation — failed test');
    expect(c).toEqual({ level: 'info', knownWarning: true });
  });

  it('warning lines are classified as warn', () => {
    expect(classifyLlamaServerLog('warning: falling back to CPU').level).toBe('warn');
  });

  it('ready markers are informational', () => {
    expect(classifyLlamaServerLog('[server] server is listening on 127.0.0.1:8081')).toEqual({
      level: 'info',
      readyMarker: true,
    });
    expect(classifyLlamaServerLog('all slots are idle')).toEqual({ level: 'info', readyMarker: true });
    expect(classifyLlamaServerLog('model loaded in 12.3s')).toEqual({ level: 'info', readyMarker: true });
  });

  it('plain lines are info without markers', () => {
    expect(classifyLlamaServerLog('building model...')).toEqual({ level: 'info' });
    expect(classifyLlamaServerLog('slot 0: processing request')).toEqual({ level: 'info' });
  });
});
