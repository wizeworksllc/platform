#!/usr/bin/env node
// No em dash in a sentence the shared SEED packages write into a row.
//
// Copy a shop owner reads is not only written in a console component. A large
// part of it is written ONCE into a row and read off a screen later: the Add
// palette's component descriptions, the ready-made AI prompt library, the
// built-in CRM reports, the legal templates, the demo business every trial
// tenant starts with. Both consoles seed from exactly these files.
//
// This half lived in the Piggles copy of the em-dash check
// (piggles/scripts/check-em-dashes.mjs) while both brands shared this
// repository. Piggles moved to its own repository (docs/153, Phase 4), and the
// files it reads live here, so this repository checks them itself.
// check-em-dash.mjs covers sparx's console; this covers the seeds.
//
// On 2026-09-25 the Customers app showed five em dashes at once, out of the
// database, seeded from `report-builtins.ts`. A stale ROW is a migration and is
// not this. This stops the next one being typed.
//
// Comments are not copy and are stripped first. A bare dash in a table cell, a
// number range ("61–90 days") and a quoted glyph explaining the empty-cell mark
// are allowed. An en dash between words is the same mistake and is caught.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SEED_ROOTS = [
  join(ROOT, 'wizeworks', 'packages', 'builder-schemas', 'src', 'catalog'),
  join(ROOT, 'wizeworks', 'packages', 'db', 'src', 'sample-data'),
  join(ROOT, 'wizeworks', 'packages', 'db', 'prisma'),
  join(ROOT, 'wizeworks', 'packages', 'crm', 'src', 'services'),
  join(ROOT, 'wizeworks', 'packages', 'legal-templates', 'src'),
  join(ROOT, 'wizeworks', 'packages', 'modules', 'src'),
  join(ROOT, 'wizeworks', 'packages', 'silica-catalog', 'src'),
  join(ROOT, 'wizeworks', 'packages', 'email', 'src', 'templates'),
  join(ROOT, 'wizeworks', 'services', 'api-rest', 'src', 'lib', 'ai'),
];

// Every root asserted. A check that scans a directory which has moved reports
// zero problems, in green, forever.
for (const root of SEED_ROOTS) {
  if (!existsSync(root)) {
    console.error(`check:seed-dashes — scan root is missing: ${relative(ROOT, root)}`);
    console.error('Point this at its new home; carrying on would scan nothing.');
    process.exit(1);
  }
}

const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trim().startsWith('//') ? '' : line))
    .join('\n');
}

/** The props that carry a sentence. `className` is pointedly not one. */
const COPY_PROPS =
  /\b(?:title|description|label|placeholder|detail|blurb|body|help|helpText|message|summary|tagline)\s*[:=]\s*(?:\{\s*)?(['"`])([^'"`]{8,600})\1/g;

const JSX_TEXT = />((?:[^<>'"`]|\{[^{}<>]*\}){8,600})</g;
const INTERPOLATION = /\{[^{}]*\}/g;

/** Whether a captured run is a SENTENCE rather than code that happened to sit
 *  between a `>` and a `<`. Same test as check-plain-words, and the reason it
 *  is repeated rather than shared is that the two checks disagree about what
 *  they scan next. */
function isProse(text) {
  if (!/\s/.test(text)) return false;
  if (/[;={}()[\]|<>]/.test(text)) return false;
  if (/\s\./.test(text)) return false;
  if (/\w\.\w/.test(text) && !/[a-z][.!?]\s/i.test(text)) return false;
  if (!/[A-Za-z]{2,}/.test(text)) return false;
  return (
    text
      .trim()
      .split(/\s+/)
      .filter((word) => /[A-Za-z]/.test(word)).length >= 2
  );
}

function readableText(source) {
  const out = [];
  for (const [, , text] of source.matchAll(COPY_PROPS)) out.push(text.replace(/\s+/g, ' ').trim());
  for (const [, text] of source.matchAll(JSX_TEXT)) {
    out.push(text.replace(INTERPOLATION, ' … ').replace(/\s+/g, ' ').trim());
  }
  return out.filter(isProse);
}

/**
 * The two shapes a dash is ALLOWED to take, removed before the test.
 *
 * A NUMBER RANGE is what an en dash is actually for: "61–90 days late" and
 * "15–30% light" are correct typography, not slips, and banning them would be
 * banning the punctuation mark rather than the habit.
 *
 * A QUOTED GLYPH is the console explaining its own empty-cell mark: the page
 * results note tells a person a figure can read “—” rather than zero, and it
 * has to print the thing it is talking about.
 */
const NUMBER_RANGE = /\d\s*[–—]\s*\d/g;
const QUOTED_GLYPH = /[“‘"']\s*[–—]\s*[”’"']/g;

function offendingDash(text) {
  const clean = text.replace(QUOTED_GLYPH, ' … ').replace(NUMBER_RANGE, ' 0 ');
  if (clean.includes('—')) return 'em dash';
  if (clean.includes('–')) return 'en dash';
  return null;
}

const found = [];
let files = 0;
let sentences = 0;
for (const root of SEED_ROOTS) {
  for (const file of walk(root)) {
    files += 1;
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const text of readableText(source)) {
      sentences += 1;
      const kind = offendingDash(text);
      if (!kind) continue;
      found.push({ file: relative(ROOT, file).split('\\').join('/'), kind, text });
    }
  }
}

if (files === 0 || sentences === 0) {
  console.error(
    `check:seed-dashes — read ${String(files)} file(s) and found ${String(sentences)} sentence(s).`
  );
  console.error('Nothing was checked. Fix the scan before trusting this.');
  process.exit(1);
}

if (found.length > 0) {
  console.error(
    `\n${String(found.length)} seeded sentence(s) put a dash on screen where a word belongs.\n\n` +
      'Reword it. A colon, a full stop or a comma does the same job and reads the\n' +
      'way a person writes. A bare dash in a table cell is fine and is not this.\n'
  );
  for (const f of found) console.error(`  [${f.kind}] ${f.file}\n      ${f.text.slice(0, 160)}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check:seed-dashes — ${String(sentences)} seeded sentence(s) across ${String(files)} file(s), ` +
    'and not one of them reaches for a dash instead of a word.'
);
