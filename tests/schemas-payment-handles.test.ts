import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentHandlesSchema } from '../lib/schemas.js';

const parse = (body: Record<string, unknown>) => paymentHandlesSchema.safeParse(body);

describe('paymentHandlesSchema', () => {
  test('accepts plain handles and an empty string that clears one', () => {
    const r = parse({ venmoHandle: 'jane-doe_1.x', cashappCashtag: 'JaneDoe1', paypalHandle: '' });
    assert.equal(r.success, true);
  });

  test('strips a leading @ or $', () => {
    const r = parse({ venmoHandle: '@jane', cashappCashtag: '$jane' });
    assert.equal(r.success && r.data.venmoHandle, 'jane');
    assert.equal(r.success && r.data.cashappCashtag, 'jane');
  });

  test('rejects spaces and punctuation outside the allowed set', () => {
    assert.equal(parse({ venmoHandle: 'bad handle!!' }).success, false);
    assert.equal(parse({ paypalHandle: 'a/b' }).success, false);
    assert.equal(parse({ cashappCashtag: 'jane.doe' }).success, false);
  });

  test('reduces a pasted profile URL to its handle', () => {
    const r = parse({
      venmoHandle: 'https://venmo.com/u/jane-doe?txn=pay',
      cashappCashtag: 'https://cash.app/$JaneDoe',
      paypalHandle: 'paypal.me/janedoe/5',
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.venmoHandle, 'jane-doe');
      assert.equal(r.data.cashappCashtag, 'JaneDoe');
      assert.equal(r.data.paypalHandle, 'janedoe');
    }
  });

  test('names the handle in the error', () => {
    const r = parse({ venmoHandle: 'bad handle!!' });
    assert.equal(r.success, false);
    if (!r.success) assert.match(r.error.issues[0]!.message, /Venmo/);
  });
});
