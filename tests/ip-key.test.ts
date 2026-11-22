import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIpKey } from '../lib/helpers/ip-key.js';
import { loadConfig } from '../lib/config.js';

describe('ipKey', () => {
  test('IPv4 is unchanged', () => {
    assert.equal(clientIpKey('203.0.113.9'), '203.0.113.9');
    assert.equal(clientIpKey('unknown'), 'unknown');
  });

  test('IPv6 addresses in one /64 share a key, other /64s do not', () => {
    const a = clientIpKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    assert.equal(clientIpKey('2001:db8:1:2::1'), a);
    assert.equal(clientIpKey('2001:0DB8:0001:0002:0:0:0:ffff'), a);
    assert.notEqual(clientIpKey('2001:db8:1:3::1'), a);
  });

  test('compressed prefix and IPv4-mapped forms', () => {
    assert.equal(clientIpKey('2001:db8::5'), clientIpKey('2001:db8:0:0:1:2:3:4'));
    assert.equal(clientIpKey('::ffff:198.51.100.4'), '198.51.100.4');
  });
});

describe('LOGIN_GLOBAL_LOCK_FAILURES config', () => {
  const load = (o: Record<string, any>) => loadConfig({ DATABASE_URL: 'postgresql://x/festie_test', ...o });
  test('defaults to 50', () => {
    assert.equal(load({}).LOGIN_GLOBAL_LOCK_FAILURES, 50);
  });
  test('stays above MAX_LOGIN_FAILURES', () => {
    const c = load({ MAX_LOGIN_FAILURES: 80 });
    assert.ok(c.LOGIN_GLOBAL_LOCK_FAILURES > c.MAX_LOGIN_FAILURES);
    assert.equal(load({ LOGIN_GLOBAL_LOCK_FAILURES: 200 }).LOGIN_GLOBAL_LOCK_FAILURES, 200);
  });
});
