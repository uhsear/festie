import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { avatarStorage } from '../lib/avatar-storage';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-storage-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('avatarStorage.ensureDir', () => {
  it('creates nested directories', () => {
    const dir = path.join(root, 'a', 'b');
    avatarStorage.ensureDir(dir);
    assert.ok(fs.statSync(dir).isDirectory());
  });

  it('sweeps only .tmp files', () => {
    fs.writeFileSync(path.join(root, 'x.webp.tmp'), 'x');
    fs.writeFileSync(path.join(root, 'x.webp'), 'x');
    avatarStorage.ensureDir(root);
    assert.deepEqual(fs.readdirSync(root), ['x.webp']);
  });

  it('throws on a .tmp directory, as before', () => {
    fs.mkdirSync(path.join(root, 'd.tmp'));
    assert.throws(() => avatarStorage.ensureDir(root));
  });
});

describe('avatarStorage.writeFileAtomic', () => {
  it('writes the target and leaves no temp file', async () => {
    const target = path.join(root, 'u1.webp');
    await avatarStorage.writeFileAtomic(target, Buffer.from('abc'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'abc');
    assert.deepEqual(fs.readdirSync(root), ['u1.webp']);
  });

  it('replaces an existing target', async () => {
    const target = path.join(root, 'u1.webp');
    fs.writeFileSync(target, 'old');
    await avatarStorage.writeFileAtomic(target, Buffer.from('new'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'new');
  });

  it('rethrows the original error and removes the temp file when rename fails', async () => {
    const target = path.join(root, 'u1.webp');
    fs.mkdirSync(target); // rename of a file over a directory fails
    await assert.rejects(avatarStorage.writeFileAtomic(target, Buffer.from('abc')), (err: any) => {
      assert.equal(err.statusCode, undefined);
      return true;
    });
    assert.equal(fs.existsSync(`${target}.tmp`), false);
  });

  it('rejects when the directory is missing', async () => {
    await assert.rejects(avatarStorage.writeFileAtomic(path.join(root, 'nope', 'u.webp'), Buffer.from('a')));
  });
});

describe('avatarStorage.removeFile', () => {
  it('removes a file and tolerates a double delete', async () => {
    const target = path.join(root, 'u1.webp');
    fs.writeFileSync(target, 'x');
    await avatarStorage.removeFile(target);
    assert.equal(fs.existsSync(target), false);
    await avatarStorage.removeFile(target);
  });
});
