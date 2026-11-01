#!/usr/bin/env node
// Every platform package sparx installs must be one that publishes,
// and nothing that publishes may carry the database (docs/153, D2 and D3).
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Each brand leaves this repository and installs platform packages from GitHub
// Packages instead of linking them. Piggles already has (docs/153, Phase 4), and
// its own CI builds from the published versions. A package sparx installs that
// is not published installs fine today, because the workspace links it, and
// fails the day sparx moves out. The check makes that day today.
//
// The database half matters as much. Five packages the apps used carried
// @wizeworksllc/db for code the apps never ran, and publishing any of them would
// have shipped the data layer to every app (Phase 3 split them). A new import
// that drags one back in typechecks, builds and passes every test.
//
// ── WHAT IT CHECKS ──────────────────────────────────────────────────────────
//
//   1. Every platform package in the consumers' closure publishes.
//   2. Every workspace dependency of a published package publishes too, or the
//      published package installs with a hole in it.
//   3. No published package depends on @wizeworksllc/db or @prisma/client.
//   4. Every file a published package exports is inside its `files` list, so
//      the tarball holds what its exports point at.
//   5. Every published package has a `repository`, which is what links it to
//      this repository on GitHub and lets the release's token publish it.
//   6. Every Next.js app in sparx lists every platform package it
//      installs in `transpilePackages`. Packages publish as TypeScript source,
//      and Next.js compiles a dependency in node_modules only when it is listed.
//      The workspace hides a gap here: a linked package resolves outside
//      node_modules and compiles anyway, so the build breaks only after the
//      brand switches to published versions.
//
// The closure is asserted non-empty and the counts are printed. A check that
// scans nothing prints green and protects nothing.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONSUMER_GROUPS,
  REPO_ROOT,
  consumerClosure,
  isPublishable,
  packageClosure,
  readWorkspace,
  runtimeWorkspaceDeps,
} from './lib/published-packages.mjs';

const DATABASE = ['@wizeworksllc/db', '@prisma/client', 'prisma'];

const pkgs = readWorkspace();
const need = consumerClosure(pkgs);
const published = [...pkgs].filter(([, p]) => isPublishable(p.json));
const problems = [];

if (need.size === 0) {
  console.error('\nx check-publishable found no platform package in sparx.');
  console.error('  Either the trees moved or the scan broke; it would pass blind.\n');
  process.exit(1);
}

for (const [name, from] of need) {
  const pkg = pkgs.get(name);
  if (!pkg) {
    problems.push(`${from} depends on ${name}, which is not a workspace package`);
  } else if (!isPublishable(pkg.json)) {
    problems.push(
      `${name} is installed by ${from} but does not publish. Add ` +
        `"publishConfig": { "registry": "https://npm.pkg.github.com" } to ${pkg.dir}/package.json`
    );
  }
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

let apps = 0;
for (const [name, { dir }] of pkgs) {
  if (!CONSUMER_GROUPS.some((g) => dir.startsWith(`${g}/`))) continue;
  const config = join(REPO_ROOT, dir, 'next.config.mjs');
  if (!existsSync(config)) continue;
  apps += 1;
  const source = readFileSync(config, 'utf8').replace(/\/\/.*$/gm, '');
  const list = source.match(/transpilePackages:\s*\[([^\]]*)\]/);
  const listed = new Set(list ? [...list[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : []);
  for (const dep of packageClosure(pkgs, name)) {
    if (!listed.has(dep)) {
      problems.push(`${name} installs ${dep} but ${dir}/next.config.mjs does not transpile it`);
    }
  }
}
if (apps === 0) problems.push('found no Next.js app in sparx; the transpile scan saw nothing');

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
  `✓ publishable: sparx installs ${need.size} platform package(s); ` +
    `${published.length} publish, none carries the database; ${apps} app(s) transpile all of theirs`
);
