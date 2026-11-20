// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';

export const username = z.string().trim().min(1).max(40);
export const password = z.string().min(8).max(200);
export const identifier = z.string().min(1).max(100);
export const shortText = z.string().max(1000);
