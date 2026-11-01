# @wizeworks/brand-registry

**Version:** 1.0
**Author:** Brandon Korous
**Last Updated:** 2026-10-31

What the platform knows about each brand it serves, kept where the platform can
read it. One folder per brand under `brands/`.

| File                | Deployed as                               | Read by                                        |
| ------------------- | ----------------------------------------- | ---------------------------------------------- |
| `billing-plan.json` | `BILLING_PLANS` in the prod ConfigMap     | api-rest, through `@wizeworks/billing/plans`   |
| `wordmark.json`     | `<BRAND>_BRAND_WORDMARK` in the ConfigMap | the attribution badge in `wizeworks/apps/site` |

## Why the platform holds a copy

The platform serves every brand from one api-rest and one site renderer, so it
may not import a brand's packages (check-boundaries RULE 1). It used to read the
brand's own files instead (`piggles/config/billing-plan.json`,
`piggles/packages/brand/src/marks.ts`). That stops working when each brand moves
to its own repository (docs/153, Phase 2).

So the platform keeps these files, and two checks hold them true:

- **Platform side.** `scripts/check-billing-plans.mjs` and
  `scripts/check-brand-wordmark.mjs` fail the push when the ConfigMap and this
  package disagree. `--print` and `--update` rewrite the ConfigMap from here.
- **Brand side.** `piggles/packages/config/src/platform-registry.test.ts` fails
  when Piggles' own price or logo disagrees with this package.

## Changing a value

A price change or a re-drawn logo is a change to the brand's own code AND to
this package, in the same pull request while both live in one repository. After
the split it is a platform pull request first, then the brand's.
