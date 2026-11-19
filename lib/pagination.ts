// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';

// Cursor-based pagination utilities for API endpoints
// Cursors are opaque base64-encoded JSON: {field, value, id}

export const DEFAULT_PAGE_SIZE = 50;
// Clamp ceiling for parsePageParams and the cap the admin audit query rejects above.
export const MAX_PAGE_SIZE = 200;
// Public list endpoints stay at the lower cap they have always enforced. The two
// numbers differ on purpose; naming both is what stops them drifting silently.
export const MAX_PUBLIC_PAGE_SIZE = 100;

export function encodeCursor(data: Record<string, any>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeCursor(cursor: any): Record<string, any> | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    return decoded;
  } catch {
    return null;
  }
}

// Fetch limit+1 rows, then trim the extra one; its presence means another page exists.
export function takePage<T>(rows: T[], limit: number, toCursor: (last: T) => string): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, nextCursor: hasMore ? toCursor(rows[rows.length - 1] as T) : null };
}

// Wire format `<created_at ISO>|<id>` for (created_at DESC, id DESC) keyset pages.
export function encodeTimeIdCursor(createdAt: string | Date, id: string): string {
  return `${new Date(createdAt).toISOString()}|${id}`;
}

// A cursor without a usable `|` (e.g. a stale bare id) is not a cursor: callers restart from page 1.
export function decodeTimeIdCursor(cursor: unknown): { createdAt: string; id: string } | null {
  if (typeof cursor !== 'string') return null;
  const sep = cursor.lastIndexOf('|');
  if (sep <= 0) return null;
  return { createdAt: cursor.slice(0, sep), id: cursor.slice(sep + 1) };
}

const limitSchema = z.coerce.number().int().min(1);
// Postgres rejects NUL in text parameters; an array from a repeated ?cursor= is not a cursor either.
const cursorSchema = z.string().min(1).refine((v) => !v.includes('\u0000'));

// Lenient on purpose: a bad limit or cursor falls back to the default instead of failing the request.
export function parsePageParams(query: Record<string, any>, { defaultSize = DEFAULT_PAGE_SIZE, maxSize = MAX_PAGE_SIZE } = {}) {
  const parsedLimit = limitSchema.safeParse(query.limit || query.pageSize);
  const limit = parsedLimit.success ? Math.min(parsedLimit.data, maxSize) : defaultSize;

  const parsedCursor = cursorSchema.safeParse(query.cursor || query.after);
  const cursor = parsedCursor.success ? parsedCursor.data : null;
  const direction = query.direction === 'prev' ? 'prev' : 'next';

  return { limit, cursor, direction };
}

interface PaginateArrayOptions {
  limit: number;
  cursor?: string | null;
  cursorField?: string;
  idField?: string;
}

export function paginateArray(items: any[], { limit, cursor = null, cursorField = 'createdAt', idField = 'id' }: PaginateArrayOptions) {
  let startIndex = 0;
  let hasMore = false;

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      startIndex = items.findIndex((item) => {
        if (item[cursorField] === decoded.value) {
          return item[idField] > decoded.id;
        }
        return item[cursorField] > decoded.value;
      });
      if (startIndex === -1) startIndex = items.length;
    }
  }

  const page = items.slice(startIndex, startIndex + limit + 1);
  if (page.length > limit) {
    hasMore = true;
    page.pop();
  }

  const nextCursor = hasMore && page.length > 0
    ? encodeCursor({ value: page[page.length - 1][cursorField], id: page[page.length - 1][idField] })
    : null;

  return {
    items: page,
    pagination: {
      hasMore,
      nextCursor,
      pageSize: limit,
      total: items.length,
    },
  };
}

export function buildPaginatedResponse(data: any, pagination: any) {
  return {
    data,
    pagination,
  };
}
