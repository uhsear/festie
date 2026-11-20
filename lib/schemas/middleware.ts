// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { sendError, ErrorCodes } from '../response';

// ── Validation middleware factory ───────────────────────────────────
/** The request members the factories read and write, so a bare double can stand in for a request. */
type ValidatedRequest = Pick<Partial<Request>, 'body' | 'query' | 'params' | 'validatedBody' | 'validatedQuery' | 'validatedParams'>;

/** One middleware for all three request sources, so the 400 shape stays in one place. */
function validateSource(source: 'body' | 'query' | 'params', target: 'validatedBody' | 'validatedQuery' | 'validatedParams', schema: z.ZodType) {
  return (req: ValidatedRequest, res: Partial<Response>, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const firstIssue = result.error.issues[0]!;
      const message =
        firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res as Response, 400, message, ErrorCodes.VALIDATION_ERROR, {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req[target] = result.data;
    next();
  };
}

/** Parses req.body and stores the result in req.validatedBody. */
export const validate = (schema: z.ZodType) => validateSource('body', 'validatedBody', schema);

/** Parses req.query and stores the result in req.validatedQuery. */
export const validateQuery = (schema: z.ZodType) => validateSource('query', 'validatedQuery', schema);

/** Parses req.params and stores the result in req.validatedParams. */
export const validateParams = (schema: z.ZodType) => validateSource('params', 'validatedParams', schema);
