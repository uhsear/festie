// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
/** The shared `ctx` that routes/admin.ts builds and passes to each admin sub-route module. */
import type crypto from 'crypto';
import type { Router } from 'express';
import type { createPasswordResetRateLimit } from '../lib/rate-limiting.js';
import type { parsePageParams, paginateArray } from '../lib/pagination.js';
import type { RouteDeps } from '../lib/types';

export interface AdminRouteCtx {
  adminWriteLimit: ReturnType<RouteDeps['rateLimit']>;
  passwordResetRateLimit: ReturnType<typeof createPasswordResetRateLimit>;
  crypto: typeof crypto;
  parsePageParams: typeof parsePageParams;
  paginateArray: typeof paginateArray;
  enrichAuditEntries: (rows: any[]) => Promise<any[]>;
}

/** Each module names the ctx keys it reads, so a test only has to supply those. */
export interface AdminMountArgs<K extends keyof AdminRouteCtx> {
  router: Router;
  deps: RouteDeps;
  ctx: Pick<AdminRouteCtx, K>;
}
