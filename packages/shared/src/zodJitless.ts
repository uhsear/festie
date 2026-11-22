import { z } from 'zod';

/**
 * Web-only side-effect module: import it before anything that builds a zod schema. Zod's JIT
 * fast path probes `new Function('')` when an object schema is built. The web CSP forbids eval,
 * so that probe fires a script-src violation on every page load even though zod catches it.
 */
z.config({ jitless: true });
