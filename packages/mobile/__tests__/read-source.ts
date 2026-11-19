import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads a file under packages/mobile as UTF-8 text, for source-text guards. */
export const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
