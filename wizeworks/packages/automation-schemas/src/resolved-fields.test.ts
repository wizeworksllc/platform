// The two lists in resolved-fields.ts say what the resolvers and the campaign
// library really do. They are read here from those sources, so a resolver that
// gains, loses or renames a field fails this test until the list follows.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GOAL_FIELD_PATHS, RESOLVED_FIELD_PATHS } from './resolved-fields';

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

function resolverPaths(): string[] {
  const dirs = [join(PACKAGES, 'automation/src'), join(PACKAGES, 'automation-actions/src')];
  const out = new Set<string>();
  for (const file of dirs.flatMap(sources)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/^\s+'([a-zA-Z0-9]+\.[a-zA-Z0-9.]+)':/gm)) {
      out.add(m[1]!);
    }
  }
  return [...out].sort();
}

function libraryGoalPaths(): string[] {
  const library = readFileSync(join(PACKAGES, 'funnels/src/library.ts'), 'utf8');
  const fields = [...library.matchAll(/field: '([a-zA-Z0-9.]+)'/g)].map((m) => m[1]!);
  return [...new Set(fields)].filter((p) => p !== 'event.type').sort();
}

describe('the condition paths the platform publishes', () => {
  it('match every path a resolver or a scan writes', () => {
    const found = resolverPaths();
    expect(found.length, 'the scan read nothing').toBeGreaterThan(100);
    expect([...RESOLVED_FIELD_PATHS].sort()).toEqual(found);
  });

  it('match every detail a library goal checks', () => {
    const found = libraryGoalPaths();
    expect(found.length, 'the scan read nothing').toBeGreaterThan(3);
    expect([...GOAL_FIELD_PATHS].sort()).toEqual(found);
  });

  it('name only goals the server can fill', () => {
    const resolved = new Set(RESOLVED_FIELD_PATHS);
    expect(GOAL_FIELD_PATHS.filter((p) => !resolved.has(p))).toEqual([]);
  });
});
