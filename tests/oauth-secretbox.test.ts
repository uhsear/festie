import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { open, seal } from '../lib/oauth/secretbox';

describe('oauth secretbox', () => {
  const key = randomBytes(32);

  it('round-trips, with a Buffer key or its base64 text', () => {
    const sealed = seal('rt-apple-1', key);
    assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(open(sealed, key), 'rt-apple-1');
    assert.equal(open(seal('rt-apple-2', key.toString('base64')), key), 'rt-apple-2');
  });

  it('uses a fresh IV every time', () => {
    assert.notEqual(seal('same', key), seal('same', key));
  });

  it('throws when the tag is tampered with', () => {
    const parts = seal('rt-apple-1', key).split('.');
    const bad = Buffer.from(parts[2] ?? '', 'base64url');
    bad.writeUInt8(bad.readUInt8(0) ^ 0xff, 0);
    parts[2] = bad.toString('base64url');
    assert.throws(() => open(parts.join('.'), key));
  });

  it('throws with the wrong key', () => {
    assert.throws(() => open(seal('rt-apple-1', key), randomBytes(32)));
  });

  it('throws on an unknown format', () => {
    assert.throws(() => open('v2.a.b.c', key), /unsupported format/);
    assert.throws(() => open('not-sealed', key), /unsupported format/);
  });
});
