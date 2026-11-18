import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { detectPlatform, normalizeArtistLink, type ArtistLinkPlatform } from '../lib/artist-links';

const ID = '4gzpq5DPGxSnKTe4SA8HAU';

const ok = (platform: ArtistLinkPlatform, url: string) => {
  const result = normalizeArtistLink(platform, url);
  assert.equal(result.ok, true, `${url}: ${result.ok ? '' : result.message}`);
  return result as { ok: true; url: string; spotifyId?: string };
};

const rejected = (platform: ArtistLinkPlatform, url: string) => {
  const result = normalizeArtistLink(platform, url);
  assert.equal(result.ok, false, url);
  return (result as { ok: false; message: string }).message;
};

describe('detectPlatform', () => {
  test('reads the platform from the host', () => {
    assert.equal(detectPlatform(`https://open.spotify.com/artist/${ID}`), 'spotify');
    assert.equal(detectPlatform(`spotify:artist:${ID}`), 'spotify');
    assert.equal(detectPlatform('https://m.soundcloud.com/zeds-dead'), 'soundcloud');
    assert.equal(detectPlatform('http://www.instagram.com/zedsdead/'), 'instagram');
    assert.equal(detectPlatform('https://twitter.com/zedsdead'), 'twitter');
    assert.equal(detectPlatform('https://x.com/zedsdead'), 'twitter');
    assert.equal(detectPlatform('https://www.tiktok.com/@zedsdead'), 'tiktok');
    assert.equal(detectPlatform('https://fb.com/zedsdead'), 'facebook');
  });

  test('an unknown host or an unreadable link has no platform', () => {
    assert.equal(detectPlatform('https://zedsdead.com'), null);
    assert.equal(detectPlatform('not a url'), null);
    assert.equal(detectPlatform('javascript:alert(1)'), null);
    assert.equal(detectPlatform(''), null);
  });
});

describe('spotify', () => {
  test('canonical form and id from a URL, an intl URL and a URI', () => {
    for (const url of [
      `https://open.spotify.com/artist/${ID}`,
      `http://open.spotify.com/intl-de/artist/${ID}?si=abc&utm_source=x#frag`,
      `https://open.spotify.com/artist/${ID}/`,
      `spotify:artist:${ID}`,
    ]) {
      const result = ok('spotify', url);
      assert.equal(result.url, `https://open.spotify.com/artist/${ID}`);
      assert.equal(result.spotifyId, ID);
    }
  });

  test('a track, album or playlist link says to open the artist page', () => {
    assert.equal(rejected('spotify', `https://open.spotify.com/track/${ID}`), 'This is a Spotify track link. Open the artist page and copy that link.');
    assert.match(rejected('spotify', `https://open.spotify.com/album/${ID}`), /album link/);
    assert.match(rejected('spotify', `https://open.spotify.com/playlist/${ID}`), /playlist link/);
  });

  test('a short id, another host and a SoundCloud link are rejected', () => {
    rejected('spotify', 'https://open.spotify.com/artist/short');
    rejected('spotify', 'https://soundcloud.com/zeds-dead');
  });
});

describe('other platforms', () => {
  test('soundcloud takes one segment and rejects on.soundcloud.com and track paths', () => {
    assert.equal(ok('soundcloud', 'https://www.soundcloud.com/zeds-dead/?utm_medium=x').url, 'https://soundcloud.com/zeds-dead');
    assert.equal(rejected('soundcloud', 'https://on.soundcloud.com/abc123'), 'Open the link and copy the full soundcloud.com address of the artist.');
    rejected('soundcloud', 'https://soundcloud.com/zeds-dead/some-track');
  });

  test('instagram canonical host, and a post is rejected', () => {
    assert.equal(ok('instagram', 'http://instagram.com/zedsdead/?igshid=abc').url, 'https://www.instagram.com/zedsdead');
    assert.equal(rejected('instagram', 'https://www.instagram.com/p/Cabc123/'), 'This is a post. Copy the profile link.');
  });

  test('twitter and x become x.com, and a status link is rejected', () => {
    assert.equal(ok('twitter', 'https://twitter.com/zedsdead').url, 'https://x.com/zedsdead');
    assert.equal(ok('twitter', 'https://www.x.com/zedsdead').url, 'https://x.com/zedsdead');
    rejected('twitter', 'https://x.com/zedsdead/status/123');
  });

  test('tiktok needs an @handle and rejects a video', () => {
    assert.equal(ok('tiktok', 'https://tiktok.com/@zedsdead').url, 'https://www.tiktok.com/@zedsdead');
    rejected('tiktok', 'https://www.tiktok.com/@zedsdead/video/123');
    rejected('tiktok', 'https://www.tiktok.com/zedsdead');
  });

  test('facebook accepts fb.com and a numeric profile.php id', () => {
    assert.equal(ok('facebook', 'https://fb.com/zedsdead?fbclid=abc').url, 'https://www.facebook.com/zedsdead');
    assert.equal(ok('facebook', 'https://m.facebook.com/profile.php?id=123&ref=x').url, 'https://www.facebook.com/profile.php?id=123');
    rejected('facebook', 'https://www.facebook.com/zedsdead/posts/1');
  });

  test('website keeps an https address, cleans it, and sends a known host to its own field', () => {
    assert.equal(ok('website', 'https://Zedsdead.com/Tour/?utm_source=x&ref=a#top').url, 'https://zedsdead.com/Tour?ref=a');
    assert.equal(ok('website', 'https://zedsdead.com/').url, 'https://zedsdead.com');
    assert.equal(rejected('website', 'https://instagram.com/zedsdead'), 'This is an Instagram link. Put it in the Instagram field.');
    assert.equal(rejected('website', 'http://zedsdead.com'), 'Use an https link.');
  });
});

describe('every platform', () => {
  test('rejects an empty value, a non-web scheme, a login in the URL and an over-long link', () => {
    for (const platform of ['spotify', 'soundcloud', 'instagram', 'twitter', 'tiktok', 'facebook', 'website'] as const) {
      rejected(platform, '');
      rejected(platform, 'javascript:alert(1)');
      rejected(platform, 'ftp://example.com/a');
    }
    rejected('website', 'https://user:pw@example.com/a');
    rejected('website', `https://example.com/${'a'.repeat(500)}`);
  });
});
