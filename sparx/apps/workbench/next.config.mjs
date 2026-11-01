import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The local api-rest origin as an image host, in development only.
 *
 * Returns nothing in production (where media comes from the CDN) and nothing if
 * NEXT_PUBLIC_API_URL is missing or unparseable — a bad value must not take the
 * whole config down at boot.
 *
 * @returns {import('next').NextConfig['images']['remotePatterns']}
 */
function devMediaPatterns() {
  if (process.env.NODE_ENV === 'production') return [];
  try {
    const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100');
    return [
      {
        protocol: api.protocol === 'https:' ? 'https' : 'http',
        hostname: api.hostname,
        ...(api.port ? { port: api.port } : {}),
        pathname: '/v1/public/media/**',
      },
    ];
  } catch {
    return [];
  }
}

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // `next build` type-checks without the tests: some import files outside the image
  // (scripts/, a sibling app), and the CI Typecheck job still checks them.
  typescript: { tsconfigPath: './tsconfig.build.json' },
  // No `X-Powered-By: Next.js`: it tells a scanner which exploits to try.
  poweredByHeader: false,
  // An ENFORCED baseline CSP of rules no page here can trip. The edge already
  // allows framing only by this origin (X-Frame-Options SAMEORIGIN),
  // and frame-ancestors says the same in CSP terms; base-uri and object-src close
  // the <base> and plugin tricks (WizeLens, 2026-10-29).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
  // @wizeworksllc/api-client ships raw TypeScript (main points at src/index.ts), so it
  // must be transpiled rather than treated as a prebuilt dependency. workbench
  // is its first consumer — it had never been through a bundler before.
  transpilePackages: [
    '@wizeworksllc/app-kit',
    // The sign-up action resolves the legal-acceptance record's address with it;
    // ships source from ./src like app-kit.
    '@wizeworks/silicaui-react',
    '@wizeworks/silicaui-charts',
    // The rich-text editor (bootcamp description) ships a client TipTap surface.
    '@wizeworks/silicaui-editor',
    '@sparx/brand',
    '@wizeworksllc/api-client',
    // The CMS block editor ships raw TypeScript/TSX (its exports point at
    // ./src/*), so it must be transpiled rather than treated as prebuilt — and
    // so must @wizeworksllc/ui, which it imports `cn` from and which also ships source.
    '@wizeworksllc/cms-editor',
    '@wizeworksllc/ui',
    // The visual site builder (builder.studio) mounts silica's <Builder> over a
    // sparx BuilderHost; these ship raw TypeScript from ./src.
    '@wizeworksllc/builder-schemas',
    '@wizeworksllc/silica-catalog',
    '@wizeworksllc/site-themes',
    // The social calendar imports `slotOccurrences` — a RUNTIME value, unlike the
    // type-only schema packages above, whose imports erase at compile time. So this one
    // ships source that actually has to be compiled. It lives in its own one-file
    // package with no relative imports: the social barrel's internal `./thing.js`
    // specifiers are not rewritten to `.ts` by Turbopack, which failed the production
    // build even though dev and typecheck passed.
    '@wizeworksllc/social-cadence',
    // Every platform package this app installs, so it still compiles once they
    // come from GitHub Packages as TypeScript source (docs/153, Phase 3).
    '@wizeworksllc/attribution',
    '@wizeworksllc/auth-client',
    '@wizeworksllc/auth-client-server',
    '@wizeworksllc/automation-schemas',
    '@wizeworksllc/brand-core',
    '@wizeworksllc/commerce-schemas',
    '@wizeworksllc/crm-schemas',
    '@wizeworksllc/email-sequence-schemas',
    '@wizeworksllc/field-schema',
    '@wizeworksllc/links',
    '@wizeworksllc/migration',
    '@wizeworksllc/module-roster',
    '@wizeworksllc/query',
    '@wizeworksllc/silica-corrections',
    '@wizeworksllc/story-schemas',
  ],
  typedRoutes: false,
  // WizeLens patches node:http and reads its own files: load it from node_modules, not a bundle.
  serverExternalPackages: ['@wizeworks/lens-node'],
  // Tenant media lives on a DIFFERENT origin from the workbench, so every
  // thumbnail is a remote image and `next/image` refuses one that is not
  // allow-listed here. Two hosts, because the media origin differs by
  // environment:
  //
  //   prod — https://media.sparx.works, the Cloudflare-fronted public bucket
  //          (k8s/sparx-prod/app-env-configmap.yaml: MEDIA_PUBLIC_URL).
  //   dev  — api-rest itself, which serves `/v1/public/media/file/*` off disk
  //          when GCS_MEDIA_BUCKET is unset. Derived from NEXT_PUBLIC_API_URL
  //          rather than hardcoded to :3100, so a developer running api-rest on
  //          another port still gets thumbnails instead of a blank grid.
  //
  // Pathnames are pinned to the media routes: an allow-listed HOST would
  // otherwise let any path on the API origin be proxied through the image
  // optimizer.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'media.sparx.works', pathname: '/v1/public/media/**' },
      ...devMediaPatterns(),
    ],
  },
  output: 'standalone',
  outputFileTracingRoot: join(__dirname, '../../../'),
};

export default config;
