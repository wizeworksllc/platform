// Which platform packages publish to GitHub Packages (docs/153, D2 and Phase 3).
//
// A package publishes when its package.json says so: `publishConfig.registry` is
// the GitHub Packages npm registry. There is no list here to keep in step. The two
// scripts that read this — check-publishable (the push gate) and publish-packages
// (the release job) — agree on the set because they compute it the same way.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY = 'https://npm.pkg.github.com';
export const SCOPE = '@wizeworksllc/';

/** Every directory pnpm-workspace.yaml globs. A missing one is a moved tree. */
const WORKSPACE_GROUPS = ['wizeworks/apps', 'wizeworks/packages', 'wizeworks/services'];

/** name → { dir, json } for every workspace package. Throws on a missing group,
 *  so a moved tree fails here rather than scanning less and passing. */
export function readWorkspace() {
  const pkgs = new Map();
  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) {
      throw new Error(`workspace group '${group}' does not exist; fix WORKSPACE_GROUPS`);
    }
    for (const entry of readdirSync(groupDir)) {
      const manifest = join(groupDir, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, 'utf8'));
      pkgs.set(json.name, { dir: `${group}/${entry}`, json });
    }
  }
  return pkgs;
}

export function isPublishable(json) {
  return json.publishConfig?.registry === REGISTRY;
}

/** The workspace packages a published package hands to whoever installs it.
 *  devDependencies are not among them: they are stripped at publish. */
export function runtimeWorkspaceDeps(json) {
  return Object.entries({ ...json.dependencies, ...json.peerDependencies })
    .filter(([, range]) => String(range).startsWith('workspace:'))
    .map(([name]) => name);
}

/** The `catalog:` versions from pnpm-workspace.yaml (the default catalog only;
 *  named catalogs are refused rather than guessed at). */
export function readCatalog() {
  const text = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const catalog = new Map();
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^catalogs:/.test(line)) throw new Error('named catalogs are not supported here');
    if (/^catalog:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^\S/.test(line)) inside = false;
    if (!inside) continue;
    const m = line.match(/^\s+['"]?([^'":]+)['"]?\s*:\s*['"]?([^'"#\s]+)['"]?/);
    if (m) catalog.set(m[1], m[2]);
  }
  return catalog;
}
