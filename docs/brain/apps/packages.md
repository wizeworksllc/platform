---
title: Packages
node: apps
type: reference
status: active
sources:
  - packages/
---

~60 workspace packages, grouped by domain (one line each):

**UI / design:** `@wizeworksllc/ui` (dashboard components) · `@sparx/site-ui` (site components, `--st-*`) · `@wizeworksllc/site-themes` (tenant theme presets + compiler) · `@wizeworksllc/surface-compile` (per-tenant CSS compile). → [[design]], [[components]].

**Builder / CMS:** `@wizeworksllc/builder-schemas` (BuilderNode schemas + the [[builder-catalog]]) · `@wizeworksllc/builder-render` (node→element map) · `@wizeworksllc/builder` · `@wizeworksllc/sitebuilder(-schemas)` · `@wizeworksllc/section-template-react` · `@wizeworksllc/cms-editor(-schemas)` · `@wizeworksllc/blueprints`.

**Commerce / inventory:** `@wizeworksllc/commerce(-schemas)` · `@wizeworksllc/inventory` · `@wizeworksllc/dropship` · `@wizeworksllc/channels`.

**Payments / billing / providers:** `@wizeworksllc/payments` (multi-gateway) · `@wizeworksllc/billing` (platform subscription) · `@wizeworksllc/integration-framework` · `provider-{avalara,taxjar,shippo,easypost,paypal(stub)}`. → [[stripe]].

**CRM / automation / scheduling:** `@wizeworksllc/crm(-schemas)` · `@wizeworksllc/automation(-schemas,-actions)` · `@wizeworksllc/scheduling(-schemas)` · `@wizeworksllc/attribution` · `@wizeworksllc/seo-audit`.

**Email / SMS:** `@wizeworksllc/email` (React Email + provider) · `@wizeworksllc/email-platform` · `@wizeworksllc/email-sends` (worker-safe enqueue) · `@wizeworksllc/sms`. → [[email-pipeline]].

**Auth / data / infra:** `@wizeworksllc/auth` (staff) · `@wizeworksllc/customer-auth` (shopper) · `@wizeworksllc/db` · `@wizeworksllc/events` · `@wizeworksllc/modules` · `@wizeworksllc/query` (TanStack) · `@wizeworksllc/api-core` · `@wizeworksllc/api-client`.

**Domains / legal / search:** `@wizeworksllc/godaddy` + `@wizeworksllc/registrar` ([[godaddy]]) · `@wizeworksllc/legal(-templates,-seed)` · `@wizeworksllc/search` (Typesense) · `@wizeworksllc/chat-widget` · `@wizeworksllc/marketplace-schemas` · `@wizeworksllc/partner-schemas` · `@wizeworksllc/site-mcp`.

Related: [[services]], [[architecture]]
