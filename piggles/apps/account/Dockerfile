# syntax=docker/dockerfile:1.7
#
# @piggles/account — getpiggles.com. Sign-up, sign-in, onboarding, provisioning,
# and the money a customer pays WizeWorks. Standalone Next.js on Node 24 alpine,
# built from the repo ROOT context:
#
#   docker build -f piggles/apps/account/Dockerfile -t piggles/account:tag .
#
# Sign-in, sign-up and onboarding run through api-rest (docs/154): this app
# proxies /api/auth to it and mounts no auth server of its own. So it installs no
# database layer — only the database-free halves of the platform packages it
# reads (docs/153, Phase 3): the browser auth client, the module roster and the
# capacity meters. Every member of the closure is here because a package DECLARES
# it, not because a file imports it — the filtered install resolves declarations,
# so a transitive member left out leaves a dangling symlink the build cannot resolve.
#
# Verified against the closure by scripts/check-dockerfile-deps.mjs, which now
# reads piggles/* as well. Do not hand-edit this list without re-running it.

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ----- Install + build -----
FROM base AS builder

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json .npmrc ./
COPY piggles/apps/account/package.json piggles/apps/account/

# Piggles' own: the handoff (both halves), the tokens, the app registry, the art.
COPY piggles/packages/auth-handoff/package.json piggles/packages/auth-handoff/
COPY piggles/packages/brand/package.json piggles/packages/brand/
COPY piggles/packages/config/package.json piggles/packages/config/
COPY piggles/packages/mascot/package.json piggles/packages/mascot/
COPY piggles/packages/ui/package.json piggles/packages/ui/

# The platform packages, all database-free.
COPY wizeworks/packages/app-kit/package.json wizeworks/packages/app-kit/
COPY wizeworks/packages/attribution/package.json wizeworks/packages/attribution/
COPY wizeworks/packages/auth-client-server/package.json wizeworks/packages/auth-client-server/
COPY wizeworks/packages/auth-client/package.json wizeworks/packages/auth-client/
COPY wizeworks/packages/module-roster/package.json wizeworks/packages/module-roster/
# Capacity metering vocabulary. The account page renders it during the SERVER
# render — this is the surface that owns the full picture of what a business uses.
COPY wizeworks/packages/usage-meters/package.json wizeworks/packages/usage-meters/
COPY wizeworks/packages/brand-core/package.json wizeworks/packages/brand-core/
COPY wizeworks/packages/brand-registry/package.json wizeworks/packages/brand-registry/
# The address table. The invite + consent pages build absolute links
# through it (accountOrigin/appOrigin), during the SERVER render.
COPY wizeworks/packages/links/package.json wizeworks/packages/links/

# The Font Awesome Pro token reaches pnpm as an env var for one command, read
# from a BuildKit secret mount. It is never COPYed and never lands in a layer.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    --mount=type=secret,id=fontawesome_npm_token \
    FONTAWESOME_NPM_TOKEN="$(cat /run/secrets/fontawesome_npm_token 2>/dev/null || true)" \
    pnpm install --frozen-lockfile --filter @piggles/account...

# Source for every workspace dep + the app itself.
COPY piggles/packages/auth-handoff piggles/packages/auth-handoff
COPY piggles/packages/brand piggles/packages/brand
COPY piggles/packages/config piggles/packages/config
COPY piggles/packages/mascot piggles/packages/mascot
COPY piggles/packages/ui piggles/packages/ui
COPY wizeworks/packages/app-kit wizeworks/packages/app-kit
COPY wizeworks/packages/attribution wizeworks/packages/attribution
COPY wizeworks/packages/auth-client-server wizeworks/packages/auth-client-server
COPY wizeworks/packages/auth-client wizeworks/packages/auth-client
COPY wizeworks/packages/module-roster wizeworks/packages/module-roster
COPY wizeworks/packages/usage-meters wizeworks/packages/usage-meters
COPY wizeworks/packages/brand-core wizeworks/packages/brand-core
COPY wizeworks/packages/brand-registry wizeworks/packages/brand-registry
COPY wizeworks/packages/links wizeworks/packages/links
COPY piggles/apps/account piggles/apps/account

ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST

# Sized when the type program spanned @wizeworksllc/auth and the whole schema family.
# It no longer does (docs/153, Phase 3), so this is a candidate to lower once a
# release shows the build's real peak.
# Stable server-action ids across builds (SI-2). No secret = Next picks a random key, as before.
RUN --mount=type=secret,id=next_actions_key \
    key="$(cat /run/secrets/next_actions_key 2>/dev/null || true)"; \
    if [ -n "$key" ]; then export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$key"; fi; \
    NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @piggles/account build

# ----- Production runner -----
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/piggles/apps/account/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/piggles/apps/account/.next/static ./piggles/apps/account/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/piggles/apps/account/public ./piggles/apps/account/public

USER nextjs

EXPOSE 3000

# The commit this image was built from; WizeLens reports it as the release (SI-2).
ARG WIZELENS_RELEASE=local
ENV WIZELENS_RELEASE=$WIZELENS_RELEASE

CMD ["node", "piggles/apps/account/server.js"]
