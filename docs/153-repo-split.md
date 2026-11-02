# Splitting the platform, sparx and Piggles into three repositories

**Version:** 0.8
**Author:** Brandon Korous
**Last Updated:** 2026-11-01

## Why

One repository holds three things: the shared platform (`wizeworks/`, about
745k lines), sparx (`sparx/`, about 465k) and Piggles (`piggles/`, about 480k,
31% of the tracked files). Every push type-checks, lints and tests all three,
and every release builds every image, so a one-line Piggles fix rides a
two-hour release. Splitting them lets each repository check and ship only
itself.

## Decisions (2026-10-30)

|     | Decision                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Three repositories.** The platform, sparx and Piggles each get their own.                                                        |
| D2  | **Shared private packages publish to GitHub Packages**, scope `@wizeworksllc`.                                                     |
| D3  | **No app touches the database or runs the auth server.** Not Piggles, not sparx. Apps reach data only through the platform's APIs. |
| D4  | **The two consoles stay matched** for now, by a check that runs across repositories.                                               |
| Q1  | **Today's repository becomes the platform**, renamed `wizeworksllc/platform`. sparx and Piggles move out of it, Piggles first.     |
| Q2  | **The staff auth server runs inside api-rest.** No new service.                                                                    |

## What stays shared

Both brands keep **one database, one tenant pool, one api-rest**. A Piggles
tenant is a platform tenant with `platformBrand = 'piggles'`. Nothing here
forks the backend. The platform keeps every brand feature it serves today: the
Piggles-only internal endpoints (furnish, billing), the domain-check hosts,
`<slug>.piggles.site` tenant sites, the `piggles-starter` blueprint, the Piggles
Stripe keys.

| Repository | Holds                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| platform   | `wizeworks/services/*`, `wizeworks/packages/*`, `wizeworks/apps/site` (tenant sites for both brands), the Prisma schema and migrations, `marketplace-catalog/`, the release pipeline, `k8s/` |
| sparx      | `sparx/apps/*` (web, market, workbench), `sparx/packages/*`                                                                                                                                  |
| piggles    | `piggles/apps/*` (web, account, console), `piggles/packages/*`                                                                                                                               |

## What ties the apps to the platform today

Measured at `58e3d13c5`.

1. **Workspace packages.** All 98 `wizeworks/packages/*` are `"private": true`;
   none is published. Piggles uses about 25 of them (the console's Dockerfile
   copies about 40). sparx uses its own similar set.
2. **The auth server runs inside the apps.** `sparx/apps/workbench` and
   `piggles/apps/account` each mount Better Auth at `app/api/auth/[...all]` and
   run it against the shared user and session tables. sparx's workbench imports
   `@wizeworksllc/auth` in 37 files. Both apps' pods load `sparx-app-secrets`,
   including `DATABASE_URL`.
3. **Direct database reads.** `piggles/apps/account` imports `@wizeworksllc/db` in
   11 places (`lib/account-load.ts`, `lib/onboarding-save.ts`,
   `lib/business-slug.ts`, ...). sparx's workbench has one
   (`app/api/consent/route.ts`).
4. **A platform signing secret.** Both consoles mint api-rest JWTs themselves
   with `SPARX_INTERNAL_JWT_SECRET` (`app/api/token/route.ts`).
5. **api-rest calls back into the apps.** Password reset calls piggles-account
   (`api-rest/src/lib/users/password-reset.ts`).
6. **Shared config.** `piggles-app-env`, the `PIGGLES_*` keys in the shared
   `app-env-configmap.env`, `BILLING_PLANS` built from
   `piggles/config/billing-plan.json`, the wordmark serialized into the
   ConfigMap.
7. **Tooling.** Root `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`,
   `turbo.json`, `.npmrc`; 13 root `piggles/scripts/*` checks, the pre-push
   hook, two CI jobs and about 58 root scripts that scan `piggles/`.
8. **Console parity.** `check:console-parity` compares the two consoles
   structurally. The Piggles console is about 423k lines in 2,414 files.
9. **Stale.** `piggles/apps/account/Dockerfile` lines 59 and 108 still copy
   `sparx/packages/brand`. `check:deletability` misses it: it walks imports,
   not Dockerfiles.
10. **`@wizeworks/studio` is used only by Piggles.**

## How the shared packages publish (D2)

- **Scope `@wizeworksllc`.** GitHub Packages requires a package's scope to
  match its owner, so `@wizeworks/api-client` became
  `@wizeworksllc/api-client`. `@wizeworks` stays the public npm scope
  (silicaui, the wizelens SDKs). One scope can resolve from only one registry,
  so keeping the two apart is what lets the public packages keep installing
  from npm with no token.
- **The rename is one mechanical sweep** of every `wizeworks/packages/*` name
  and every import of it, done while all three trees are still in one
  repository, so the typecheck proves it. The diff is read back before it is
  committed.
- **Cost.** wizeworksllc is on GitHub Free. Private packages get 500 MB of
  storage and 1 GB of transfer per month at no charge, and downloads inside
  GitHub Actions using `GITHUB_TOKEN` do not count. These are small JavaScript
  packages. Check the Packages line on the org billing page after the first
  month.
- **Access.** Every developer machine needs a token with `read:packages` in
  `~/.npmrc`. In CI, each package must grant the sparx and piggles repositories
  read access, or `GITHUB_TOKEN` cannot install it. Docker builds receive the
  token as a build secret, never a build argument, so it never lands in an
  image layer.
- **Versioning.** A changed package publishes at the version the platform
  release tags (see Phase 3). The release publishes after its containers
  deploy, so a published version always matches a deployed API. The first
  publish was `v1.262.0`, 28 packages, on 2026-10-31.
- **Who switches, and when.** sparx and Piggles keep `workspace:*` while they
  live in this repository, so a platform change and the app change that uses it
  still land in one pull request. Each brand switches to published versions in
  its own repository (Phases 4 and 5), together with the `.npmrc` scope line,
  the CI token and the Docker build secret.

## The plan

Each phase ships on its own and leaves every product working. Phases 1 to 3
run inside today's repository, so nothing moves until it no longer needs to be
here.

### Phase 1. The apps stop touching the database (D3)

- **Move the staff auth server into the platform** (where: Q2). Each app keeps
  its own cookies by proxying `/api/auth/*` to it, so sessions stay
  first-party on app.sparx.works, getpiggles.com and mypiggles.com. The brand
  settings that exist today (each brand's `BETTER_AUTH_SECRET`, cookie prefix,
  app name) carry over unchanged, so nobody is signed out.
- **Server-side session checks become an API call** (or a token the app
  verifies with a public key), replacing `requireSession()` against the
  database. This touches sparx's 37 auth-importing files.
- **Every `@wizeworksllc/db` use in an app moves behind an api-rest endpoint.**
  Piggles' account load, onboarding save and business slug; sparx's consent
  route.
- **A platform token endpoint replaces both consoles' own JWT minting**, so
  `SPARX_INTERNAL_JWT_SECRET` leaves the apps.
- **App pods get only their own secrets**, not `sparx-app-secrets`.
- Remove the stale `sparx/packages/brand` copy from the account Dockerfile, and
  teach `check:deletability` to read Dockerfiles.

Done when no app imports `@wizeworksllc/db` or the auth server, and no app pod can
read `DATABASE_URL`. A test pass on both brands covers sign-up, sign-in, the
getpiggles.com to mypiggles.com handoff, password reset and two-step
verification before it ships. This is the riskiest phase.

### Phase 2. Each thing on its own side

Done 2026-10-31.

- The studio engine moved to `piggles/packages/studio` and is now
  `@piggles/studio`. Only the Piggles console used it.
- Piggles' platform config moved to `@wizeworksllc/brand-registry`
  (`brands/piggles/billing-plan.json`, `brands/piggles/wordmark.json`). The
  ConfigMap is checked against it by `check:billing-plans` and
  `check:brand-wordmark`, which no longer read `piggles/`. Piggles' own test
  (`@piggles/config`, `platform-registry.test.ts`) holds its quoted price and
  its drawn logo equal to the registry. api-rest still reads the same
  ConfigMap values, so nothing changed at runtime.
- No app in `piggles/` or `sparx/` reaches into `wizeworks/` by folder path.
  CSS `@source` lines name the package in `node_modules`, and
  `builder-vocabulary.css` is a `@wizeworksllc/silica-catalog` export (the compiled
  CSS is byte-identical). The condition picker's test imports
  `RESOLVED_FIELD_PATHS` and `GOAL_FIELD_PATHS` from
  `@wizeworksllc/automation-schemas`, whose own test keeps them true to the
  resolvers. That every record address has a page is now the site app's test.

### Phase 3. Rename and publish the shared packages (D2)

- Done 2026-10-31: the `@wizeworks` to `@wizeworksllc` rename sweep for
  workspace packages. Applied migrations were left byte-for-byte, because their
  checksums are keys in every database.
- Done 2026-10-31: no app installs the database layer. The apps used small,
  database-free parts of five packages that also carry `@wizeworksllc/db`, so
  publishing those packages would have shipped the data layer to every app.
  Each part is now its own package, and the original re-exports it, so platform
  code did not change:

  | New package                            | Split from                      | What the apps use                                                   |
  | -------------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
  | `@wizeworksllc/auth-client`            | `@wizeworksllc/auth`            | the browser client, role and access vocabularies, MCP scopes, slugs |
  | `@wizeworksllc/module-roster`          | `@wizeworksllc/modules`         | `ModuleSlug`, `ALL_MODULES`, the bundling and requirement rules     |
  | `@wizeworksllc/usage-meters`           | `@wizeworksllc/usage`           | the meters, how a reading is judged, the capacity report shape      |
  | `@wizeworksllc/social-cadence`         | `@wizeworksllc/social`          | `slotOccurrences`, the posting-slot maths                           |
  | `@wizeworksllc/email-sequence-schemas` | `@wizeworksllc/email-sequences` | the sequence zod schemas                                            |

  The user fields Better Auth adds (`tenantId`, `role`, `platformBrand`) are now
  one list in `@wizeworksllc/auth-client/user-fields` that the server and the
  browser client both read. The client used to infer them from the server's
  type, which a frontend cannot import. The three app images that installed the
  database (both consoles, the account app) no longer copy it or run
  `prisma generate`.

- Packages publish as TypeScript source, the way the apps consume them today.
  Every consumer is a Next.js app, and Next.js compiles a dependency's
  TypeScript when the dependency is in `transpilePackages`. A build step would
  add a second shape to keep in sync for no reader. Today the workspace links
  resolve outside `node_modules`, so Next.js compiles them without the list.
  When an app switches to published versions, every `@wizeworksllc` package it
  uses must go on its `transpilePackages` list in the same change.
- Done 2026-10-31: the release publishes. The 28 platform packages sparx and
  Piggles install carry `publishConfig` for GitHub Packages, and the `publish`
  job (after `containers`, before `tag`) runs `scripts/publish-packages.mjs`.
  A package that changed since the previous release tag is published at the
  version the tag is about to cut; one that did not keeps its last version. A
  dependent moves with its dependency, because `workspace:*` publishes as an
  exact version. The tag waits for the job, so a tag means its packages exist.
  This replaced the Changesets plan: Changesets versions through a pull request
  a bot opens, and this repository has none. `check:publishable` (push gate and
  CI) fails when a brand installs a package that does not publish, or when a
  published package depends on the database. A full set is about 1 MB.
- Confirmed 2026-10-31: wizeworksllc members may publish public and private
  packages, so the first `publish` job is not blocked by org settings.
- Done 2026-10-31: every Next.js app in sparx and Piggles lists every platform
  package it installs in `transpilePackages`. Today the workspace links compile
  anyway; published versions compile only when listed. `check:publishable`
  holds the lists complete.

### Phase 4. Piggles moves to `wizeworksllc/piggles`

Done 2026-11-01. Piggles lives in the private repository `wizeworksllc/piggles`,
and all three apps run in namespace `piggles`.

- Created from the history of `piggles/` with `git filter-repo`, so history and
  blame survive. The doc zips and `piggles/images` were dropped from history.
- Its own TypeScript, ESLint and Prettier config, turbo pipeline, pre-push hook,
  CI and release. The `piggles/scripts/*` checks moved with it, and they find
  sparx through `scripts/lib/platform-dir.mjs` (`$PLATFORM_DIR`, or a sibling
  checkout named `sparx.works` or `sparx`). Two checks were added there:
  `check-transpile-packages` (each app lists every `@wizeworksllc/*` package it
  installs, the whole closure) and `check-k8s` (the availability rules that were
  sparx's `check-k8s-overlays`: two account pods, a PodDisruptionBudget that
  keeps one, and memory requests at measured use).
- Infrastructure first: wize-infrastructure PR #10 added the deploy identity
  `gha-piggles-prod`, the vault `kv-piggles-prod-cus` and the Caddy upstreams
  for meetpiggles.com, getpiggles.com and mypiggles.com. During the move each
  host listed the `piggles` namespace first and the `sparx-prod` copy as a
  fallback, so each app moved with no gap. PR #11 removed the fallback once all
  three ran in `piggles`.
- Images publish to `ghcr.io/wizeworksllc/piggles-{web,account,console}`, and
  the three packages are public, because the cluster pulls without credentials.
  A package pushed from a private repository starts private, and GitHub has no
  API to change that, so a new image needs its visibility set once by hand.
- Cut over one app at a time by listing its manifest in the Piggles repository's
  `k8s/kustomization.yaml`: web, then account, then the console.
- **Console parity (D4):** Piggles' CI checks sparx out at `platform/` and
  Piggles at `platform/piggles/`, then runs 42 of sparx's cross-console checks
  unchanged (`scripts/platform-checks.mjs`). In sparx alone, those checks read
  sparx's console only (then `scripts/lib/piggles.mjs`, now
  `scripts/lib/brand-trees.mjs`).
- sparx PR #161 removed `piggles/`, its workspace globs, release entries,
  manifests and Dockerfile entries. Its next release pruned the `sparx-prod`
  copies of the three apps.

What the first Piggles releases taught, for Phase 5:

- A private repository gets the smaller GitHub runner, and Node sizes its
  default heap from the machine. The console's type-aware lint ran out of
  memory, so lint and typecheck carry a heap cap in CI only.
- turbo passes a task only the environment variables it is told about, so
  `PLATFORM_DIR` must be listed for the tests that read the platform's source.
- An app built from published packages fails in `next build` with "Unknown
  module type" when a package is missing from `transpilePackages`. Nothing
  before the image build notices, which is why `check-transpile-packages` exists.

Piggles went first because it is the less critical product, so the playbook is
proven on it before sparx follows.

### Phase 5. sparx moves to its own repository

Done 2026-11-01. sparx's apps live in the public repository `wizeworksllc/sparx`
(id 1442332718), and web, market and the workbench run in namespace `sparx`.

- **The rename (Q1).** wize-infrastructure #13 trusted
  `repo:wizeworksllc@350084568/platform@1251494871` first. Then this repository
  was renamed `wizeworksllc/platform` and every checkout's remote updated.
  Platform #163 and #164 moved the images to `ghcr.io/wizeworksllc/platform/*`
  and every published package's repository link. wize-infrastructure #14 moved
  the plain-form subject and the CI default. The first release under the new
  name signed in to Azure, built, deployed and published the 28 packages.
- **The new repository.** Created from the history of `sparx/apps`,
  `sparx/packages/brand` and `sparx/docs` (now `apps/`, `packages/`, `docs/`),
  with the platform's version tags dropped. Its platform dependencies are pinned
  published `@wizeworksllc/*` versions, not `workspace:*`. Public, so its CI gets
  the large runner and needs no heap cap, and its images are public on first push.
- **Its own identity, never the platform's.** wize-infrastructure #15 added
  `gha-sparx-apps-prod` (federated to the new repository's id-qualified
  subject), the vault `kv-sparxapps-prod-cus` with the six keys the apps read
  (`next-actions-key-*`, `wizelens-key-*`, copied unchanged from
  `kv-sparx-prod-cus`), and Caddy upstreams that tried `sparx-<app>.sparx` first
  and `<app>.sparx-prod` second. The platform's `gha` identity reads every
  platform secret, so the apps' pipeline never gets it.
- **Cut over one app at a time** by listing its manifest in the sparx
  repository's `k8s/kustomization.yaml`: web (#1), market (#3), the workbench
  (#4). Each was checked live by build: WizeLens `@service.version` is the image
  commit, so it shows which copy answered (Caddy keeps no access log).
  wize-infrastructure #17 then removed the `sparx-prod` fallbacks.
- **This repository's cleanup** removed `sparx/`, its workspace globs, release
  entries, manifests and Dockerfile entries; its next release pruned the
  `sparx-prod` copies. The checks that read sparx's code keep their `sparx/...`
  paths: here they skip that part with a printed note, and in the sparx
  repository's CI, which checks this repository out at `platform/` and sparx at
  `platform/sparx`, they read it in full.
- **Console parity (D4).** Piggles' CI checks out this repository, then
  `wizeworksllc/sparx` at `platform/sparx`. Its three console-comparing checks
  find sparx through `$SPARX_DIR` or a sibling checkout named `sparx`.

What Phase 5 taught:

- A NEW Service name can fail to resolve for up to 30 seconds after it exists.
  Caddy had been asking for `sparx-web.sparx` on every request, so CoreDNS held a
  cached "no such name", and the first smoke test failed while the pod served.
  The sparx release's smoke test now retries.
- The infrastructure release refuses any plan that deletes. Removing the old
  `sparx@1251494871` trust (dead since the rename) deletes three credentials, so
  it waits for a run with `allow_infrastructure_destroy` chosen on purpose. Until
  then the entry stays in `org-move.tf`, marked dead.

### Phase 6. Today's repository becomes the platform

What is left is the platform: services, packages, tenant sites, schema and
migrations, the release pipeline and `k8s/`. Its release builds only platform
images, applies migrations and publishes packages. `check:boundaries`
and the brand-isolation CI job lose their reason to exist:
three repositories are the boundary.

## What this saves

- **Platform push:** no longer checks about 945k lines of frontend code.
- **sparx and Piggles pushes:** check only their own code (about 465k and 480k).
- **sparx and Piggles releases:** a handful of images, no migrations, minutes
  instead of about two hours.
- **Platform release:** no frontend images.

## Risks

- **API changes break a frontend later instead of in the same push.** Today a
  breaking api-rest change fails both consoles' typecheck at once. After the
  split it fails them on their next run. Mitigated by versioned `api-client`
  publishes and by each frontend's CI running when a new version publishes.
- **Feature work crosses repositories.** Most sparx features touch api-rest and
  the workbench together, so they become two pull requests: the API first
  (already the house rule), then the screen.
- **Package version drift.** A frontend can lag the platform's packages.
  Mitigated by publishing on every platform release and testing frontends
  against the newest versions.

## Decided questions

**Q1.** Today's repository becomes the platform and is renamed
`wizeworksllc/platform`. It already holds the release pipeline, the migrations
(whose names are permanent keys in every database) and the vault sync. The
rename changes its OIDC subject (`repo:wizeworksllc@350084568/platform@1251494871`;
the repository id does not change) and its image paths, so it follows
wize-infrastructure `docs/org-move.md`: trust the new subject first, then
rename, then update the image paths. The rename happens at the start of Phase 5, before the
new `wizeworksllc/sparx` repository is created, because that repository needs
the name.
Creating it ends GitHub's redirect from the old name, so every local checkout's
remote is updated first.

**Q2.** The staff auth server runs inside api-rest, beside the shopper OAuth
provider it already hosts (`api-rest/src/lib/customer-oauth.ts`). It picks the
brand by host, as api-mcp already does. No new Deployment, no new cost.
