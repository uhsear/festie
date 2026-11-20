// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';

// ── Public beacon bodies (unauthenticated, rate-limited) ────────

export const installEventSchema = z.object({
  platform: z.enum(['ios', 'android', 'desktop'], { error: 'Invalid platform' }),
  event: z.enum(['shown', 'accepted', 'dismissed', 'native_fired', 'inapp_blocked'], { error: 'Invalid event' }),
  // Optional extras are dropped, not rejected, when malformed: the beacon is fire-and-forget.
  reason: z.string().optional().catch(undefined),
  engagement_ms: z.number().optional().catch(undefined),
});

export const clientPerfBeaconSchema = z.object({
  lcp: z.number(),
  fid: z.number(),
  cls: z.number().optional(),
  avgRenderMs: z.number().optional(),
  renders: z.number().optional(),
});

export const webVitalsBeaconSchema = z.object({
  name: z.string(),
  value: z.number(),
  rating: z.string().optional().catch(undefined),
  delta: z.number().optional().catch(undefined),
  id: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
  navigationType: z.string().optional().catch(undefined),
});

// ── Meeting Point schemas (Phase 1B) ────────────────────────────
