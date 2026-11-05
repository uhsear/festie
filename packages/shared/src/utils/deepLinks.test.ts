import { describe, it, expect } from 'vitest';
import { rewriteWebPathForApp } from './deepLinks';

describe('rewriteWebPathForApp', () => {
  it.each([
    ['https://festie.us/s/abc_123-X', '/friend-picks?from=abc_123-X'],
    ['https://festie.us/s/abc/', '/friend-picks?from=abc'],
    ['https://festie.us/s/u/Jane', '/friend-picks?from=u%2Fjane'],
    ['festie://s/u/jane', '/friend-picks?from=u%2Fjane'],
    ['https://festie.us/compare', '/crew-compare'],
    ['https://festie.us/compare?x=1', '/crew-compare?x=1'],
  ])('rewrites %s', (input, expected) => {
    expect(rewriteWebPathForApp(input)).toBe(expected);
  });

  it.each([
    'https://festie.us/join/ABC',
    'https://festie.us/set/1',
    'https://festie.us/f/edc',
    'https://festie.us/s/abc/json',
    'https://festie.us/s/bad%20token',
    'https://festie.us/s/%E0%A4%A',
    'https://evil.example/s/abc',
    'festie://friend-picks?from=abc',
  ])('leaves %s alone', (input) => {
    expect(rewriteWebPathForApp(input)).toBeNull();
  });
});
