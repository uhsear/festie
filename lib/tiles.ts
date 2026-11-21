// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { Application, Request, Response } from 'express';

/**
 * Self-hosted PMTiles files (offline maps). The server serves the .pmtiles files in
 * config.TILES_DIR at /tiles/<name>.pmtiles. The feature is off while TILES_DIR is empty.
 * The strict name pattern is the only guard against path traversal, so keep it narrow.
 */
export const TILES_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}\.pmtiles$/;
export const TILES_PATH_RE = /^\/tiles\/[a-z0-9][a-z0-9_-]{0,63}\.pmtiles$/;

/** Turn a same-origin /tiles/ path in a festival's map config into an absolute URL, in place. */
export function absolutizeTilesUrl(mapConfig: any, origin: string): void {
  const url = mapConfig?.offlineBasemap?.pmtilesUrl;
  if (typeof url === 'string' && TILES_PATH_RE.test(url)) {
    mapConfig.offlineBasemap.pmtilesUrl = `${origin.replace(/\/+$/, '')}${url}`;
  }
}

interface TilesDeps {
  config: { TILES_DIR?: string; MOBILE_ORIGINS?: string[] };
  isAllowedOrigin: (origin: string | undefined, host: string | undefined) => boolean;
  sendError: (res: Response, status: number, message: string, code: any) => unknown;
  ErrorCodes: Record<string, any>;
}

export function mountTiles(app: Application, { config, isAllowedOrigin, sendError, ErrorCodes }: TilesDeps): void {
  app.use('/tiles', (req: Request, res: Response) => {
    // CORS: only our own origins (and the configured mobile ones) may read the file cross-origin.
    // Range is not CORS-safelisted for cross-origin requests, so the preflight must allow it.
    const origin = req.headers.origin;
    // The app's WebView map loads an inline page, so its origin is the opaque "null". The file is public and
    // needs no credentials, so that origin may read it too, as it may read /uploads/basemaps.
    const allowed =
      !!origin &&
      (origin === 'null' || isAllowedOrigin(origin, req.get('host')) || (config.MOBILE_ORIGINS ?? []).includes(origin));
    res.setHeader('Vary', 'Origin');
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, If-Range, If-None-Match');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, ETag');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.status(allowed || !origin ? 204 : 403).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return res.status(405).end();
    }

    if (!config.TILES_DIR) return sendError(res, 404, 'Offline map files are not enabled', ErrorCodes.NOT_FOUND);
    const name = req.path.slice(1);
    if (!TILES_NAME_RE.test(name)) {
      return sendError(res, 400, 'Use a file name like fest-2026.pmtiles', ErrorCodes.INVALID_INPUT);
    }
    // send() answers Range with 206, sets Accept-Ranges and a weak ETag, and honours If-None-Match/If-Range.
    return res.sendFile(
      name,
      {
        root: config.TILES_DIR,
        dotfiles: 'deny',
        cacheControl: false,
        headers: {
          'Content-Type': 'application/octet-stream',
          // no-transform stops a proxy re-compressing the archive, which would change its byte count.
          // A re-extract needs a new file name because the cache is immutable.
          'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
        },
      },
      (err: any) => {
        if (!err || res.headersSent) return;
        if (err.code === 'ENOENT' || err.status === 404) return sendError(res, 404, 'Map file not found', ErrorCodes.NOT_FOUND);
        return sendError(res, 500, 'Failed to read map file', ErrorCodes.INTERNAL_ERROR);
      },
    );
  });
}
