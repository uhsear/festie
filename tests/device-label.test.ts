import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { describeDevice } from '../lib/helpers/device-label';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
  chromeOS:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  rnIOS: 'Festie/1 CFNetwork/1494.0.7 Darwin/23.4.0',
  okhttp: 'okhttp/4.12.0',
};

describe('describeDevice', () => {
  test('browsers get "<browser> on <system>"', () => {
    assert.equal(describeDevice(UA.iphoneSafari, false), 'Safari on iPhone');
    assert.equal(describeDevice(UA.iphoneChrome, false), 'Chrome on iPhone');
    assert.equal(describeDevice(UA.androidChrome, false), 'Chrome on Android');
    assert.equal(describeDevice(UA.windowsEdge, false), 'Edge on Windows');
    assert.equal(describeDevice(UA.windowsChrome, false), 'Chrome on Windows');
    assert.equal(describeDevice(UA.macSafari, false), 'Safari on Mac');
    assert.equal(describeDevice(UA.macFirefox, false), 'Firefox on Mac');
    assert.equal(describeDevice(UA.chromeOS, false), 'Chrome on ChromeOS');
  });

  test('the native app is named by platform', () => {
    assert.equal(describeDevice(UA.rnIOS, true), 'Festie app on iOS');
    assert.equal(describeDevice(UA.okhttp, true), 'Festie app on Android');
    assert.equal(describeDevice('SomethingElse/1.0', true), 'Festie app');
  });

  test('an unknown agent falls back to "Browser" with no system', () => {
    assert.equal(describeDevice('curl/8.4.0', false), 'Browser');
  });

  test('an empty agent is "Festie app" when native, else null', () => {
    assert.equal(describeDevice('', true), 'Festie app');
    assert.equal(describeDevice(undefined, true), 'Festie app');
    assert.equal(describeDevice('', false), null);
    assert.equal(describeDevice(undefined, false), null);
  });

  test('reads only the first 512 characters', () => {
    assert.equal(describeDevice(`${'x'.repeat(512)} Windows Firefox/127.0`, false), 'Browser');
  });
});
