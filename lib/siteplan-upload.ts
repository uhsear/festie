// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Site-plan image upload: multer wiring and file storage for
 * POST /api/v1/admin/festivals/:id/siteplan-image (routes/admin-siteplan.ts).
 *
 * The image is re-encoded by the avatar worker pool and written under
 * public/uploads/siteplans/, which lib/middleware.ts serves.
 */
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';

import { avatarStorage } from './avatar-storage';

export const SITEPLAN_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SITEPLAN_MAX_PIXELS = 50_000_000;
export const SITEPLAN_MAX_EDGE = 4096;
export const SITEPLAN_WEBP_QUALITY = 80;

const ALLOWED_SITEPLAN_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const WRONG_TYPE_MESSAGE = 'Upload a PNG, JPEG or WebP image. For a PDF, save the page as a PNG first.';

export function createSiteplanUpload({ config, sendError, ErrorCodes }: { config: any; sendError: any; ErrorCodes: any }) {
  function siteplanDirPath() {
    return path.join(config.PUBLIC_DIR, 'uploads', 'siteplans');
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: SITEPLAN_MAX_UPLOAD_BYTES, files: 1, parts: 10 },
    fileFilter: (_req: any, file: any, callback: any) => {
      if (!ALLOWED_SITEPLAN_MIME_TYPES.has(file.mimetype)) {
        const error: any = new Error(WRONG_TYPE_MESSAGE);
        error.statusCode = 400;
        callback(error);
        return;
      }
      callback(null, true);
    },
  });

  function handleSiteplanUpload(req: any, res: any, next: any) {
    upload.single('image')(req, res, (error: any) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 400, 'The image must be 10 MB or smaller.', ErrorCodes.INVALID_INPUT);
      }
      if (error.statusCode) {
        return sendError(res, error.statusCode, error.message, ErrorCodes.INVALID_INPUT);
      }
      return sendError(res, 400, 'Send one image file in the "image" field.', ErrorCodes.INVALID_INPUT);
    });
  }

  // shortcut: an upload that is never saved, or a replaced site plan, leaves its file behind; add a sweep when public/uploads/siteplans passes 1 GB.
  async function writeSiteplan(buffer: any) {
    const key = crypto.randomBytes(16).toString('hex');
    if (!/^[a-f0-9]{32}$/.test(key)) throw new Error('Invalid site-plan key');
    const dir = siteplanDirPath();
    avatarStorage.ensureDir(dir);
    await avatarStorage.writeFileAtomic(path.join(dir, `${key}.webp`), buffer);
    return key;
  }

  return { siteplanDirPath, handleSiteplanUpload, writeSiteplan };
}
