// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { AUDIT_ACTIONS, LEGACY_AUDIT_ACTIONS, genericAuditAction } from '../lib/audit-actions.js';
// The backend cannot depend on @festie/shared at run time, so the labels are
// imported by relative path, as tests/constants-parity.test.ts does.
import { AUDIT_ACTION_LABELS } from '../packages/shared/src/utils/auditActions.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_SQL = fs.readFileSync(path.join(ROOT, 'migrations', '082_audit_action_names.sql'), 'utf8');

function tsFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(rel);
    return entry.name.endsWith('.ts') ? [rel] : [];
  });
}

describe('audit action names', () => {
  it('every action has a label in packages/shared/src/utils/auditActions.ts', () => {
    const missing = Object.values(AUDIT_ACTIONS).filter((action) => !AUDIT_ACTION_LABELS[action]);
    assert.deepEqual(missing, [], 'add a label to AUDIT_ACTION_LABELS for each of these');
  });

  it('every legacy value maps to a current action', () => {
    const current = new Set<string>(Object.values(AUDIT_ACTIONS));
    for (const [legacy, dotted] of Object.entries(LEGACY_AUDIT_ACTIONS)) {
      assert.ok(current.has(dotted), `${legacy} maps to ${dotted}, which is not in AUDIT_ACTIONS`);
    }
  });

  it('migration 082 renames every legacy value to its dotted value', () => {
    for (const [legacy, dotted] of Object.entries(LEGACY_AUDIT_ACTIONS)) {
      assert.ok(MIGRATION_SQL.includes(`WHEN '${legacy}' THEN '${dotted}'`), `missing CASE line for ${legacy}`);
      assert.ok(new RegExp(`IN \\([^)]*'${legacy}'`).test(MIGRATION_SQL), `missing ${legacy} in the WHERE list`);
    }
  });

  it('every audit writer names its action through AUDIT_ACTIONS', () => {
    const writers = [...tsFiles('routes'), ...tsFiles('lib')].filter((file) => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      return /auditLog\s*\.\s*insert|\baudit\(|\bwriteAudit(?:Row)?\(/.test(src);
    });
    assert.ok(writers.includes(path.join('routes', 'admin-siteplan.ts')), 'the scan must see multi-line inserts');

    const problems: string[] = [];
    for (const file of writers) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      // A string literal, or a bare constant that bypasses AUDIT_ACTIONS.
      for (const m of src.matchAll(/\baction:\s*(['"`][^'"`]*['"`]|[A-Z][A-Z0-9_]*\b(?!\.))/g)) {
        problems.push(`${file}: action: ${m[1]}`);
      }
      for (const m of src.matchAll(/(?<!function )\b(audit|writeAudit|writeAuditRow)\(([^)]*)/g)) {
        if (!m[2]!.includes('AUDIT_ACTIONS.')) problems.push(`${file}: ${m[1]}(${m[2]!.trim().slice(0, 60)}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('genericAuditAction names middleware rows <resource>.<past tense>', () => {
    assert.equal(genericAuditAction('POST', 'crews'), 'crews.created');
    assert.equal(genericAuditAction('PUT', 'festivals'), 'festivals.replaced');
    assert.equal(genericAuditAction('PATCH', 'web-vitals'), 'web-vitals.updated');
    assert.equal(genericAuditAction('DELETE', 'users'), 'users.deleted');
    assert.equal(genericAuditAction('OPTIONS', 'users'), 'users.options');
  });
});
