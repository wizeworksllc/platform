# Application Deployments

One Deployment + Service + PodDisruptionBudget per app. `kustomization.yaml` is
the list that ships; a manifest not named there is not deployed, and — because
the release prunes on its ownership label — removing a name from that list is
how an app is actually deleted rather than silently left running.

| Manifest           | Serves                                     | Notes                                                                                                                                  |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `api-rest.yaml`    | api.sparx.works                            | Fastify REST API. 2 replicas; `strategy: Recreate` on AKS                                                                              |
| `api-graphql.yaml` | graphql.sparx.works                        | Pothos + Mercurius                                                                                                                     |
| `api-mcp.yaml`     | mcp.sparx.works + mcp.mypiggles.com        | The staff/agent MCP plane. One pod, one host PER BRAND — discovery runs before any token exists, so the host is what carries the brand |
| `mcp-site.yaml`    | mcp.sparx.zone                             | The shopper-facing MCP plane                                                                                                           |
| `workbench.yaml`   | app.sparx.works                            | The operator app. Replaced the removed `dashboard`                                                                                     |
| `web.yaml`         | sparx.works + the module marketing domains | One Next.js app reading the Host header                                                                                                |
| `site.yaml`        | every tenant storefront                    | Multi-tenant; hostname resolved per request                                                                                            |
| `market.yaml`      | sparx.market                               | The marketplace                                                                                                                        |

Replica counts live in the overlay (`k8s/azure/apps/kustomization.yaml`), not
here — the same base runs on a laptop and on a one-node cluster.

## Piggles

Piggles' three apps (meetpiggles.com, getpiggles.com, mypiggles.com) are not
here. They moved to their own repository, `wizeworksllc/piggles`, and their own
namespace, `piggles`, in docs/153 Phase 4. Their manifests, their image builds
and their `piggles-app-env` ConfigMap all ship from that repository's release.

They still use this namespace's api-rest and api-mcp. api-rest runs both
brands' Better Auth instances (docs/154), so Piggles' sign-in origin
(`PIGGLES_BETTER_AUTH_URL`) and its other `PIGGLES_*` values stay on api-rest
here, and its `PIGGLES_*` secrets stay in `sparx-app-secrets`. Do not remove
them: Piggles' sign-in stops working without them.

## Adding a new app

1. Write `<app-name>.yaml` — copy the nearest neighbour rather than
   `api-rest.example.yaml`, which predates the current probe and security
   conventions.
2. Add it to `kustomization.yaml`.
3. Add its image to `k8s/azure/apps/kustomization.yaml` (`images:` + `replicas:`)
   — the release fails if any tag survives the SHA rewrite unpinned.
4. Add its Dockerfile to the build matrix in `.github/workflows/release.yml`.
   `scripts/check-dockerfile-deps.mjs` reads that matrix, so this is also what
   puts the image under dependency checking.
5. Give it a host block in wize-infrastructure's
   [`k8s/ingress/Caddyfile`](https://github.com/wizeworksllc/wize-infrastructure/blob/main/k8s/ingress/Caddyfile),
   as a pull request there, plus any DNS record it needs in that repository's
   Terraform. A running pod with no route is unreachable, and nothing reports a
   fault — the cluster is healthy. The ingress ships through wize-infrastructure's
   own release (minutes, no app images), so merge and release it **before** the
   sparx change that adds the app. Until it does, the new pod simply has no route.

## Shared env & secrets

- **`sparx-app-env`** — non-secret runtime config. Generated per overlay
  (`k8s/azure/infra/app-env-configmap.env`, `k8s/local/app-env-configmap.env`).
- **`sparx-app-secrets`** — every credential, including the `PIGGLES_*` keys api-rest reads.
  Applied by the release from `SPARX_APP_SECRETS_ENV` (or Key Vault);
  `k8s/local/secrets.example.env` is the documented key list. Only the backend
  services load it whole (`envFrom`). The Next.js apps hold no database and no
  auth instance (docs/154), so each takes just its own two keys by name: its
  `NEXT_ACTIONS_KEY_*` and its `WIZELENS_KEY_*`.

## Workload Identity

The base sets `serviceAccountName: sparx-app`, annotated for GCP Workload
Identity. **The AKS overlay patches every Deployment back to `default`** — that
ServiceAccount is never created there and nothing in that cluster needs GCP
credentials, so a pod referencing it would stay Pending forever.
