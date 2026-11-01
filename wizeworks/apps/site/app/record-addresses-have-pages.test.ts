// Every record address the platform hands out is a page this site serves.
//
// `RECORD_ADDRESSES` is where both consoles print a product's, collection's or
// category's web address from. A prefix with no page folder behind it puts a
// Not Found link in front of the owner (sparx persona issue 225: "/c/injectors").
// The consoles used to check this by reading this folder from their own tests,
// which they cannot do once they live in their own repositories.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RECORD_ADDRESSES } from '@wizeworksllc/silica-catalog';
import { describe, expect, it } from 'vitest';

const app = dirname(fileURLToPath(import.meta.url));

describe('record addresses', () => {
  it.each(RECORD_ADDRESSES.map((a) => [a.recordType, a.prefix, a.param] as const))(
    '%s: the site has a page at %s',
    (_type, prefix, param) => {
      expect(existsSync(join(app, prefix, `[${param}]`, 'page.tsx'))).toBe(true);
    }
  );
});
