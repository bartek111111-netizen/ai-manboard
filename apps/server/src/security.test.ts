import { describe, it, expect } from 'vitest';
import { isLoopbackHost, validateSecurityConfig } from './security.js';

describe('security S-1 (Faza 10.3)', () => {
  describe('isLoopbackHost', () => {
    it('returns true for loopback addresses', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('localhost')).toBe(true);
    });

    it('returns false for non-loopback addresses', () => {
      expect(isLoopbackHost('0.0.0.0')).toBe(false);
      expect(isLoopbackHost('192.168.1.1')).toBe(false);
      expect(isLoopbackHost('example.com')).toBe(false);
    });
  });

  describe('validateSecurityConfig', () => {
    it('passes for loopback host without token', () => {
      expect(() => validateSecurityConfig('127.0.0.1', null)).not.toThrow();
      expect(() => validateSecurityConfig('localhost', null)).not.toThrow();
    });

    it('passes for loopback host with token', () => {
      expect(() => validateSecurityConfig('127.0.0.1', 'secret')).not.toThrow();
    });

    it('passes for non-loopback host with token', () => {
      expect(() => validateSecurityConfig('0.0.0.0', 'secret')).not.toThrow();
    });

    it('throws for non-loopback host without token', () => {
      expect(() => validateSecurityConfig('0.0.0.0', null)).toThrow('S-1');
      expect(() => validateSecurityConfig('192.168.1.1', null)).toThrow('S-1');
    });

    it('throws for non-loopback host with empty token', () => {
      expect(() => validateSecurityConfig('0.0.0.0', '')).toThrow('S-1');
    });
  });
});
