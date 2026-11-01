#!/usr/bin/env node
/**
 * A brand's logo is drawn in ONE place, and the deployment carries a copy.
 * This fails the build when the two disagree.
 *
 * ─── WHY THERE IS A COPY AT ALL ─────────────────────────────────────────────
 *
 * The attribution badge at the foot of every tenant's public site is rendered by
 * `wizeworks/apps/site` — one deployment serving the public sites of every
 * brand, which is exactly why it may not import `@piggles/*` or `@sparx/*`
 * (check-boundaries RULE 1). It cannot reach a brand's marks package, so it
 * reads the geometry as configuration: `<BRAND>_BRAND_WORDMARK`, beside the name,
 * the accent and the destination it already reads the same way.
 *
 * That is a second copy of a logo, and a second copy of anything drifts. The
 * drift would be quiet in the worst way: the badge renders a perfectly clean
 * wordmark that is simply the previous version of the logo, on every tenant site
 * the platform serves, and nothing anywhere reports a problem.
 *
 * So the platform keeps the art in its brand registry
 * (`wizeworks/packages/brand-registry/brands/<brand>/wordmark.json`), the
 * ConfigMap holds its serialisation, and this compares them. `--update` rewrites
 * the ConfigMap from the registry.
 *
 * This check used to read the brand's own drawing (`piggles/packages/brand`)
 * instead, which it cannot do once a brand has its own repository (docs/153,
 * Phase 2). The other half, that the brand's drawing equals the registry, is the
 * brand's own test: `piggles/packages/config/src/platform-registry.test.ts`.
 *
 * ─── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 *
 * Pass quietly when it cannot find something. A check that shrugs at a missing
 * file is worse than no check, because its OK is indistinguishable from a real
 * one — five sibling checks in this repo went blind that way in a single tree
 * move. Every lookup here is asserted, and the counts are printed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * One row per brand that publishes a drawn wordmark.
 *
 * A brand whose mark IS its letterforms belongs nowhere on this list — sparx
 * sets its name as type with an Ember "x" (`SPARX_BRAND_ACCENT_CHARS=1`), which
 * is the badge's other treatment and needs no geometry.
 */
const BRANDS = [
  {
    key: 'piggles',
    envVar: 'PIGGLES_BRAND_WORDMARK',
    source: 'wizeworks/packages/brand-registry/brands/piggles/wordmark.json',
    /** Asserted, so a re-drawn logo with a different number of letterforms is a
     *  deliberate edit here rather than a silent change in what ships. */
    expectPaths: 7,
    expectAccent: true,
  },
];

const CONFIGMAP = 'k8s/azure/infra/app-env-configmap.env';

function fail(...lines) {
  console.error('\nBrand wordmark check FAILED:');
  for (const l of lines) console.error('  ' + l);
  console.error('');
  process.exit(1);
}

/** Read the geometry out of the brand registry. Every field is asserted. */
function readArt(brand) {
  const abs = join(ROOT, brand.source);
  if (!existsSync(abs)) {
    fail(
      brand.source + ' does not exist.',
      'A moved or renamed registry file makes this check blind. Fix the path.'
    );
  }
  let art;
  try {
    art = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    fail(brand.source + ' is not valid JSON: ' + err.message);
  }
  const { viewBox, paths, accentPath = null } = art ?? {};

  if (typeof viewBox !== 'string' || !Array.isArray(paths)) {
    fail(
      brand.source + ' has no viewBox / paths in the shape the badge reads',
      '({ viewBox: string, paths: string[], accentPath: string | null }).'
    );
  }

  if (paths.length !== brand.expectPaths) {
    fail(
      brand.key + ': found ' + paths.length + ' letterform path(s), expected ' + brand.expectPaths,
      'If the mark was genuinely re-drawn, update expectPaths in this file in the same',
      'commit — the count is asserted so a partial parse cannot pass as a correct one.'
    );
  }
  if (brand.expectAccent && !accentPath) {
    fail(brand.key + ': accentPath is missing — the accent shape is the mark.');
  }

  return JSON.stringify({ viewBox, paths, accentPath });
}

const cfgPath = join(ROOT, CONFIGMAP);
if (!existsSync(cfgPath)) {
  fail(CONFIGMAP + ' does not exist. Fix the path; do not delete the check.');
}
let cfg = readFileSync(cfgPath, 'utf8');
const update = process.argv.includes('--update');
const drifted = [];

for (const brand of BRANDS) {
  const art = readArt(brand);
  // The value is matched RAW and written UNQUOTED. Kustomize's env parser keeps
  // quotes as part of the value (dotenv strips them; kustomize does not), so the
  // single-quoted line this used to write and read deployed as `'{…}'`, which is
  // not JSON — and the badge quietly fell back to plain type on every tenant site
  // while this check, which stripped the quotes before comparing, printed OK.
  const line = new RegExp('^' + brand.envVar + '=(.*)$', 'm');
  const found = line.exec(cfg);

  if (update) {
    const replacement = brand.envVar + '=' + art;
    cfg = found ? cfg.replace(line, replacement) : cfg.trimEnd() + '\n' + replacement + '\n';
    continue;
  }

  if (!found) {
    drifted.push(brand.envVar + ' is absent from ' + CONFIGMAP + ' — the badge would set the');
    drifted.push('  brand name as plain type instead of drawing its logo.');
    continue;
  }
  if (/^['"]|['"]$/.test(found[1])) {
    drifted.push(brand.envVar + ' is wrapped in quotes. Kustomize keeps them, so the');
    drifted.push('  deployed value is not JSON and the badge falls back to plain type.');
    continue;
  }
  if (found[1] !== art) {
    drifted.push(
      brand.envVar +
        ' does not match ' +
        brand.source +
        ' (' +
        found[1].length +
        ' configured bytes vs ' +
        art.length +
        ' in the registry).'
    );
  }
}

if (update) {
  writeFileSync(cfgPath, cfg, 'utf8');
  console.log(
    'Updated ' + BRANDS.length + ' wordmark(s) in ' + relative(ROOT, cfgPath).split(sep).join('/')
  );
  process.exit(0);
}

console.log('Brand wordmark check: ' + BRANDS.length + ' brand(s) with a drawn wordmark compared.');

if (drifted.length > 0) {
  fail(
    ...drifted,
    '',
    'The brand registry is the source. Run `pnpm check:brand-wordmark --update` to',
    'rewrite the ConfigMap from it, and update the local .env files the same way.'
  );
}
console.log('OK: every configured wordmark matches the brand registry.');
