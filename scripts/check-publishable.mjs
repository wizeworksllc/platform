#!/usr/bin/env node
// Every package that publishes must install whole and carry no database
// (docs/153, D2 and D3).
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Both brands install platform packages from GitHub Packages instead of linking
// them: Piggles since docs/153 Phase 4, sparx since Phase 5. A published package
// that installs with a hole in it, or drags the data layer along, breaks every
// brand at once.
//
// The database half matters as much. Five packages the apps used carried
// @wizeworksllc/db for code the apps never ran, and publishing any of them would
// have shipped the data layer to every app (Phase 3 split them). A new import
// that drags one back in typechecks, builds and passes every test.
//
// ── WHAT IT CHECKS ──────────────────────────────────────────────────────────
//
//   1. Every workspace dependency of a published package publishes too, or the
//      published package installs with a hole in it.
//   2. No published package depends on @wizeworksllc/db or @prisma/client.
//   3. Every file a published package exports is inside its `files` list, so
//      the tarball holds what its exports point at.
//   4. Every published package has a `repository`, which is what links it to
//      this repository on GitHub and lets the release's token publish it.
//
// TWO RULES MOVED OUT with the brands' apps. "Every package a brand installs
// publishes" is now proved by that brand's own install, which fails on a package
// the registry does not have. "Every Next.js app transpiles every platform
// package it installs" is scripts/check-transpile-packages.mjs in each brand's
// repository, which reads the apps' real installed versions.
//
// The published set is asserted non-empty and the counts are printed. A check
// that scans nothing prints green and protects nothing.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  isPublishable,
  readWorkspace,
  runtimeWorkspaceDeps,
} from './lib/published-packages.mjs';

const DATABASE = ['@wizeworksllc/db', '@prisma/client', 'prisma'];

const pkgs = readWorkspace();
const published = [...pkgs].filter(([, p]) => isPublishable(p.json));
const problems = [];

if (published.length === 0) {
  console.error('\nx check-publishable found no package that publishes.');
  console.error('  Either the trees moved or the scan broke; it would pass blind.\n');
  process.exit(1);
}

for (const [name, { dir, json }] of published) {
  for (const dep of runtimeWorkspaceDeps(json)) {
    if (!isPublishable(pkgs.get(dep)?.json ?? {})) {
      problems.push(`${name} publishes but depends on ${dep}, which does not`);
    }
  }
  for (const db of DATABASE) {
    if (json.dependencies?.[db] || json.peerDependencies?.[db]) {
      problems.push(`${name} publishes and depends on ${db}; no app may install the database`);
    }
  }
  if (json.private) problems.push(`${name} publishes but is still "private": true`);
  if (!json.repository?.directory) {
    problems.push(`${name} publishes but has no repository.directory`);
  }
  const files = json.files;
  if (!Array.isArray(files) || files.length === 0) {
    problems.push(`${name} publishes with no "files" list; the tarball would be guesswork`);
    continue;
  }
  const included = files.filter((f) => !f.startsWith('!')).map((f) => f.replace(/\/$/, ''));
  for (const target of new Set(exportTargets(json.exports ?? json.main))) {
    const rel = target.replace(/^\.\//, '');
    const covered = included.some((f) => rel === f || rel.startsWith(`${f}/`));
    if (!covered) problems.push(`${name} exports ${target}, which its "files" list leaves out`);
    if (!rel.includes('*') && !existsSync(join(REPO_ROOT, dir, rel))) {
      problems.push(`${name} exports ${target}, which does not exist`);
    }
  }
}

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets);
  return [];
}

if (problems.length > 0) {
  console.error(`\nx check-publishable: ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `✓ publishable: ${published.length} package(s) publish, each installs whole, none carries the database`
);
