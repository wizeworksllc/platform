#!/usr/bin/env node
// Publish the platform packages that changed in this release to GitHub Packages
// (docs/153, D2 and Phase 3). Run by release.yml after the containers deploy, so
// a published version always matches a deployed API.
//
//   node scripts/publish-packages.mjs --version 1.262.0
//   node scripts/publish-packages.mjs --version 1.262.0 --dry-run
//
// ── THE VERSION IS THE RELEASE'S ────────────────────────────────────────────
//
// A package that changed is published at the release's own version (the tag the
// release is about to cut). One that did not keeps its last published version.
// So `@wizeworksllc/links@1.262.0` means "links as it shipped in v1.262.0", and
// nothing has to be bumped by hand or committed back by a bot.
//
// "Changed" means its directory differs from the previous release tag, it has
// never been published, or a platform package it depends on is being published.
// That last rule exists because a `workspace:*` dependency publishes as an EXACT
// version: when `field-schema` moves, `commerce-schemas` must move with it, or it
// would keep pointing at the old one.
//
// ── WHAT A PUBLISHED PACKAGE CONTAINS ───────────────────────────────────────
//
// Its tracked files, filtered by its own `files` list, with a manifest rewritten
// for a stranger: `workspace:` and `catalog:` become real versions, and
// `devDependencies` and `scripts` are dropped (no consumer needs them, and a
// lifecycle script would run on every install). The repository is never edited;
// each package is staged into a temporary directory and published from there.
//
// Packages are TypeScript source, the way the apps consume them today. Next.js
// compiles them through `transpilePackages`.
//
// Re-running is safe: a version that already exists is skipped, not refused.

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  REGISTRY,
  REPO_ROOT,
  SCOPE,
  isPublishable,
  readCatalog,
  readWorkspace,
  runtimeWorkspaceDeps,
} from './lib/published-packages.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args[args.indexOf('--version') + 1];
if (!args.includes('--version') || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  fail('pass --version X.Y.Z, the version this release is about to tag');
}
const token = process.env.NODE_AUTH_TOKEN;
if (!dryRun && !token) fail('NODE_AUTH_TOKEN is not set; nothing can be published');

function fail(message) {
  console.error(`\nx publish-packages: ${message}\n`);
  process.exit(1);
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

// The registry config lives in a throwaway file, never the repository's .npmrc:
// the token must not land on disk anywhere a later step could commit or cache it.
// The staging area holds that file, so it is removed on every exit.
const work = mkdtempSync(join(tmpdir(), 'publish-packages-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const npmrc = join(work, '.npmrc');
writeFileSync(
  npmrc,
  `${SCOPE.slice(0, -1)}:registry=${REGISTRY}\n` +
    `//${new URL(REGISTRY).host}/:_authToken=\${NODE_AUTH_TOKEN}\n`
);

function npm(npmArgs, options = {}) {
  return spawnSync('npm', [...npmArgs, '--userconfig', npmrc], {
    cwd: options.cwd ?? work,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_AUTH_TOKEN: token ?? '' },
  });
}

/** Every published version of a package, or [] if it has never been published.
 *  Any other failure stops the run: guessing "never published" would republish
 *  everything, and guessing "published" would skip a real change. */
function publishedVersions(name) {
  if (dryRun && !token) return [];
  const r = npm(['view', name, 'versions', '--json']);
  if (r.status === 0) {
    const parsed = JSON.parse(r.stdout || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  if (/E404|404 Not Found/.test(r.stderr)) return [];
  fail(`could not read ${name} from ${REGISTRY}:\n${r.stderr.trim()}`);
}

function latest(versions) {
  const key = (v) => v.split('.').map((n) => n.padStart(6, '0')).join('.');
  return [...versions].sort((a, b) => key(a).localeCompare(key(b))).at(-1);
}

// ── Which packages, and in what order ───────────────────────────────────────

const pkgs = readWorkspace();
const publishable = new Map([...pkgs].filter(([, p]) => isPublishable(p.json)));
if (publishable.size === 0) fail('no package publishes; check-publishable should have caught this');

let previousTag = null;
try {
  previousTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD');
} catch {
  // No release tag yet: every package counts as changed.
}

const versions = new Map([...publishable.keys()].map((name) => [name, publishedVersions(name)]));

const changed = new Set();
const reasons = new Map();
for (const [name, { dir }] of publishable) {
  if (versions.get(name).length === 0) {
    changed.add(name);
    reasons.set(name, 'first publish');
  } else if (!previousTag) {
    changed.add(name);
    reasons.set(name, 'no previous release tag');
  } else if (git('diff', '--name-only', previousTag, 'HEAD', '--', dir) !== '') {
    changed.add(name);
    reasons.set(name, `changed since ${previousTag}`);
  }
}
// A dependent of anything publishing publishes too: its exact pin must move.
for (let grew = true; grew; ) {
  grew = false;
  for (const [name, { json }] of publishable) {
    if (changed.has(name)) continue;
    const moved = runtimeWorkspaceDeps(json).find((dep) => changed.has(dep));
    if (moved) {
      changed.add(name);
      reasons.set(name, `depends on ${moved}`);
      grew = true;
    }
  }
}

/** The version a dependency resolves to in what this run publishes. */
function targetVersion(name) {
  if (changed.has(name)) return version;
  const current = latest(versions.get(name) ?? []);
  if (!current) fail(`${name} is depended on but has never been published`);
  return current;
}

// Dependencies first, so no published manifest names a version that does not exist yet.
const order = [];
const placed = new Set();
const place = (name) => {
  if (placed.has(name) || !changed.has(name)) return;
  placed.add(name);
  for (const dep of runtimeWorkspaceDeps(publishable.get(name).json)) place(dep);
  order.push(name);
};
for (const name of [...changed].sort()) place(name);

// ── Stage and publish ───────────────────────────────────────────────────────

const catalog = readCatalog();

function resolveRange(name, range) {
  if (range.startsWith('workspace:')) {
    const spec = range.slice('workspace:'.length);
    const v = targetVersion(name);
    if (spec === '*' || spec === '') return v;
    if (spec === '^' || spec === '~') return `${spec}${v}`;
    return spec; // an explicit range written after workspace:
  }
  if (range === 'catalog:' || range === 'catalog:default') {
    const v = catalog.get(name);
    if (!v) fail(`${name} uses catalog: but pnpm-workspace.yaml has no entry for it`);
    return v;
  }
  if (range.startsWith('catalog:')) fail(`${name} uses a named catalog, which is not supported`);
  return range;
}

function stage(name) {
  const { dir, json } = publishable.get(name);
  const out = join(work, 'stage', name.replace('/', '__'));
  for (const file of git('ls-files', '--', dir).split('\n').filter(Boolean)) {
    const target = join(out, file.slice(dir.length + 1));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(REPO_ROOT, file), target);
  }
  const manifest = { ...json, version };
  delete manifest.devDependencies;
  delete manifest.scripts;
  delete manifest.private;
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (!manifest[field]) continue;
    manifest[field] = Object.fromEntries(
      Object.entries(manifest[field]).map(([dep, range]) => [dep, resolveRange(dep, range)])
    );
  }
  writeFileSync(join(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  return out;
}

const results = [];
for (const name of order) {
  const dir = stage(name);
  if (versions.get(name).includes(version)) {
    results.push([name, version, 'already published']);
    continue;
  }
  const r = dryRun ? npm(['pack', '--dry-run', '--json'], { cwd: dir }) : npm(['publish'], { cwd: dir });
  if (r.status !== 0) fail(`${name}@${version} did not publish:\n${r.stderr.trim()}`);
  let note = reasons.get(name);
  if (dryRun) {
    const [packed] = JSON.parse(r.stdout);
    note += ` (${packed.entryCount} files, ${Math.round(packed.size / 1024)} KB)`;
  }
  results.push([name, version, note]);
  console.log(`${dryRun ? 'would publish' : 'published'} ${name}@${version}: ${note}`);
}

const unchanged = publishable.size - order.length;
console.log(
  `\n${dryRun ? 'Dry run: ' : ''}${order.length} package(s) at ${version}, ` +
    `${unchanged} unchanged since ${previousTag ?? 'the start'}.`
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Packages${dryRun ? ' (dry run)' : ''}`,
    '',
    order.length === 0
      ? `No platform package changed since \`${previousTag}\`; nothing published.`
      : `${order.length} published at \`${version}\`, ${unchanged} unchanged.`,
    '',
  ];
  if (order.length > 0) {
    lines.push('| package | version | why |', '| --- | --- | --- |');
    for (const [name, v, why] of results) lines.push(`| \`${name}\` | ${v} | ${why} |`);
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
