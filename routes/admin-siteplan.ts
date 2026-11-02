// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Site-plan image upload (admin).
 *
 * POST /api/v1/admin/festivals/:id/siteplan-image   multipart/form-data, field `image`
 *
 * Re-encodes a PNG, JPEG or WebP to WebP, shrunk to fit inside 4096 px, stores it
 * under public/uploads/siteplans/ and returns { imageUrl }. It does not change the
 * festival: the admin saves the URL into map_config with the map editor.
 */
import crypto from 'crypto';

import {
  createSiteplanUpload,
  SITEPLAN_MAX_EDGE,
  SITEPLAN_MAX_PIXELS,
  SITEPLAN_WEBP_QUALITY,
} from '../lib/siteplan-upload.js';

export default function createAdminSiteplanRoutes(deps: any) {
  const {
    express,
    config,
    log,
    pool,
    stores,
    avatarPool,
    adminAuth,
    rateLimit,
    validateParams,
    schemas,
    setNoStore,
    sendSuccess,
    sendError,
    ErrorCodes,
    getRequestIp,
  } = deps;

  const router = express.Router();
  const { handleSiteplanUpload, writeSiteplan } = createSiteplanUpload({ config, sendError, ErrorCodes });

  router.post(
    '/festivals/:id/siteplan-image',
    adminAuth,
    rateLimit(10, 'siteplan-upload'),
    validateParams(schemas.genericIdParams),
    handleSiteplanUpload,
    async (req: any, res: any) => {
      const festivalId = req.params.id;
      // The returned URL is stored in map_config, whose siteplan schema accepts https only.
      if (!String(config.PUBLIC_ORIGIN || '').startsWith('https://')) {
        return sendError(res, 503, 'Site-plan upload needs PUBLIC_ORIGIN set to an https address on the server.', ErrorCodes.SERVICE_UNAVAILABLE);
      }
      try {
        const { rows } = await pool.query('SELECT id FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
        if (rows.length === 0) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        if (!req.file?.buffer) return sendError(res, 400, 'Choose an image to upload.', ErrorCodes.MISSING_FIELD);

        let webp: any;
        try {
          webp = await avatarPool.process(req.file.buffer, config, {
            size: SITEPLAN_MAX_EDGE,
            maxPixels: SITEPLAN_MAX_PIXELS,
            quality: SITEPLAN_WEBP_QUALITY,
            fit: 'inside',
          });
        } catch (error: any) {
          if (error.statusCode) return sendError(res, 400, error.message, ErrorCodes.INVALID_INPUT);
          log.warn('siteplan image processing failed', { festivalId, error: error.message });
          return sendError(res, 400, "We couldn't read that image. Try a PNG or JPEG.", ErrorCodes.INVALID_INPUT);
        }

        const key = await writeSiteplan(webp);
        setNoStore(res);
        if (stores.auditLog) {
          res.locals.auditWritten = true;
          stores.auditLog
            .insert({
              id: crypto.randomUUID(),
              actorType: 'admin',
              actorId: req.user?.userId,
              action: 'festival:siteplan-upload',
              targetType: 'festival',
              targetId: festivalId,
              detailsJson: JSON.stringify({ key }),
              ip: getRequestIp(req),
            })
            .catch((e: any) => log.warn('audit log write failed', { error: e.message }));
        }
        res.status(201);
        return sendSuccess(res, { imageUrl: `${config.PUBLIC_ORIGIN}/uploads/siteplans/${key}.webp` });
      } catch (error: any) {
        log.error('siteplan upload failed', { festivalId, error: error.message });
        return sendError(res, 500, 'Site-plan upload failed. Try again.', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
