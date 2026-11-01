// Where Piggles is, for the checks that read both consoles.
//
// Piggles lives in its own repository (wizeworksllc/piggles) since docs/153
// Phase 4. Its CI checks this repository out and its own at `piggles/` inside
// it, then runs the cross-console checks here unchanged, so each one still joins
// `piggles/...` onto this root. In this repository on its own there is no
// `piggles/` folder, and those checks read sparx's console alone.
//
// The rule: a Piggles path is dropped ONLY when the whole Piggles checkout is
// absent. With Piggles present, every path is kept, and a missing one still
// fails the check that named it. So a moved file inside Piggles is still caught,
// and the console-parity checks still compare both consoles in Piggles' CI.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** True when a Piggles checkout sits at `piggles/` under this repository. */
export const HAS_PIGGLES = existsSync(join(ROOT, 'piggles', 'apps', 'workbench'));

/** Whether a path, relative to the repository root or absolute, is under `piggles/`. */
export function isPigglesPath(path) {
  const abs = isAbsolute(path) ? path : resolve(ROOT, path);
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  return rel === 'piggles' || rel.startsWith('piggles/');
}

/**
 * The entries of `list` that can be read here: all of them when Piggles is
 * checked out, and only the non-Piggles ones when it is not. `pathOf` picks the
 * path out of an entry that is not itself a path.
 */
export function present(list, pathOf = (entry) => entry) {
  return HAS_PIGGLES ? list : list.filter((entry) => !isPigglesPath(pathOf(entry)));
}
