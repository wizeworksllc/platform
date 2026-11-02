// Where each brand's code is, for the checks that read a brand's apps.
//
// Neither brand's apps live in this repository any more. Piggles moved to
// wizeworksllc/piggles in docs/153 Phase 4, and sparx's apps (web, workbench,
// market and the brand package) to wizeworksllc/sparx in Phase 5. Each of those
// repositories' CI checks this one out, puts its own checkout INSIDE it
// (`piggles/` or `sparx/`), and runs the checks here unchanged, so every check
// still joins `piggles/...` or `sparx/...` onto this root. In this repository on
// its own neither folder exists, and a check reads only the platform's code.
//
// The rule: a brand's paths are dropped ONLY when that brand's whole checkout is
// absent. With it present, every path is kept, and a missing one still fails the
// check that named it. So a moved file inside a brand is still caught in that
// brand's CI, and the cross-console checks still compare both consoles there.
//
// A check whose every scan root belongs to a brand has nothing to read here, and
// says so through skipWhenEmpty() rather than passing over nothing in silence.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** True when a Piggles checkout sits at `piggles/` under this repository. */
export const HAS_PIGGLES = existsSync(join(ROOT, 'piggles', 'apps', 'workbench'));

/** True when a sparx checkout sits at `sparx/` under this repository. */
export const HAS_SPARX = existsSync(join(ROOT, 'sparx', 'apps', 'workbench'));

function under(path, brand) {
  const abs = isAbsolute(path) ? path : resolve(ROOT, path);
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  return rel === brand || rel.startsWith(`${brand}/`);
}

/** Whether a path, relative to the repository root or absolute, is under `piggles/`. */
export function isPigglesPath(path) {
  return under(path, 'piggles');
}

/** Whether a path, relative to the repository root or absolute, is under `sparx/`. */
export function isSparxPath(path) {
  return under(path, 'sparx');
}

/** Whether a path can be read here: not inside a brand that is not checked out. */
export function isPresent(path) {
  if (!HAS_PIGGLES && isPigglesPath(path)) return false;
  if (!HAS_SPARX && isSparxPath(path)) return false;
  return true;
}

/**
 * The entries of `list` that can be read here: every one inside a brand that is
 * checked out, and every one outside both brands. `pathOf` picks the path out of
 * an entry that is not itself a path.
 */
export function present(list, pathOf = (entry) => entry) {
  return list.filter((entry) => isPresent(pathOf(entry)));
}

/**
 * Exit 0 with a printed note when `list` is empty because every root it named
 * belongs to a brand that is not checked out here. That brand's own CI runs the
 * check with its tree in place. A list that is empty for any OTHER reason is not
 * this helper's business: the check's own "scan root missing" guard still fires.
 */
export function skipWhenEmpty(list, name) {
  if (list.length > 0) return;
  console.log(
    `${name}: skipped. Everything it reads is a brand's app, and no brand is checked out here ` +
      "(sparx's apps are in wizeworksllc/sparx, Piggles' in wizeworksllc/piggles). " +
      "Each brand's CI runs this check with its tree in place."
  );
  process.exit(0);
}
