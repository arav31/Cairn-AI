# Cairn

**Record once. Reuse forever. Repaired when the target changes.**

> Turn a browser task you already do by hand into a durable, private, typed API —
> verified end-to-end and owned by you. You and your agents call it forever; Cairn keeps
> it working when the site moves underneath it.

---

## Inspiration

Agents are brilliant at reasoning and miserable at the boring part: reliably driving real
websites. Every team we talked to had the same graveyard — a hack for the insurance portal,
a scraper for the county records site — brittle scripts that broke the instant a button moved.
And it's worse than fragile: every agent re-solves the same multi-step flow from scratch,
slowly, on every single run.

One idea kept surfacing: the hard, repeated work of clicking through a site should be done
**once**, captured, and frozen into something you can call like any other API — not a script
you babysit, but an endpoint that *stays working*.

The realization that became the product: **the recording isn't the valuable thing. The durable,
verified contract that survives the site changing is.**

## What it does

Cairn turns a recorded browser workflow into a durable, private, typed API.

You record a task once — title, target URL, goal. Cairn **compiles** that recording into an
*operation*: an input schema, an output schema, an execution plan, selectors, allowed domains,
and success predicates. Then it **verifies** the operation end-to-end by replaying it against
known input and asserting the expected output. Only once it passes do you get:

- an **HTTP invoke endpoint**
- a generated **OpenAPI** spec
- a native **MCP tool** (so Claude, Cursor, or any MCP agent calls it directly)
- an **SDK + CLI**

…all four generated from one operation definition — a single source of truth.

Every API is **private and account-scoped**: gated by a hashed bearer key, owned by you, never
dropped into a public catalog. And it's **durable** — Cairn re-verifies the operation, classifies
*why* it broke when it breaks, proposes a targeted repair, and republishes only after the repair
re-verifies.

Agents call a stable typed contract, not a raw browser session. The contract holds even when the
site doesn't.

## How we built it

**One framework-free Node server.** The entire lifecycle — `record → compile → verify → invoke →
repair` — runs in a single Node HTTP server with hand-rolled routing and exactly one production
dependency (`pg`). No Express, no framework. It keeps the boundaries explicit and makes the demo
a one-liner: `npm start`.

**Two sandbox targets, chosen to hurt.** *Meridian* is a clean JSON REST CRM — the easy case.
*Civic* is a deliberately nasty legacy portal: per-request **CSRF tokens** and **ViewState-style
hidden fields** minted fresh on every page and rejected (`422`) if replayed. Civic is what forced
the real design — a recording can't be replayed verbatim, so the operation lifts fresh tokens per
run and re-derives hidden fields from the live, server-rendered form. That single requirement is
why "operation definition" and "raw replay" are two different things in Cairn.

**One contract, four clients.** OpenAPI is generated from the operation. The same operation drives
the MCP tool (a real JSON-RPC 2.0 `tools/list` + `tools/call`), the SDK, and the CLI. Change the
operation and every surface updates — there is no second source to keep in sync.

**Durability is the engine, not a feature.** When verification fails, Cairn classifies the failure
into a typed cause — `changed_route`, `stale_token`, `selector_failure`, `changed_response_schema`,
`auth_expired`, `extractor_failure` — and only attempts a repair it's confident in. A confident
repair (e.g. a route that moved within an allowed domain) is re-verified against the original
input/output and **auto-published as a new version**; anything risky is held for **human approval**
rather than shipped blind.

**Auth & privacy by construction.** Accounts issue bearer keys that are **SHA-256 hashed before
storage** and shown by prefix only. Every read and invoke is account-scoped, and cross-account
lookups return an **identical `404`** for "doesn't exist" and "not yours" — so one tenant can't
even probe another's API names.

**Persistence — and a production topology it's built to grow into.** The whole thing runs with
**zero external services**: state lives in memory, or in **Postgres** (via `pg`) the moment you set
`DATABASE_URL` — the source of truth for accounts, operations, skill manifests, verification
records, and invocation logs. Every internal boundary is drawn to map cleanly onto a real AWS
topology — RDS for data, S3 for immutable recordings/traces/artifacts, SQS + EventBridge + Step
Functions + Fargate for a worker plane, Secrets Manager + KMS for secrets — and the env and infra
scaffolding is already in place for that next phase.

**Frontend.** A clean monospace/terminal dashboard for schemas, data, and forms, plus a Next.js
landing deployed on Vercel.

## Challenges we ran into

- **Legacy sites fight back.** Civic's CSRF + hidden ViewState made verbatim replay impossible — we
  had to lift fresh tokens per run and re-derive hidden fields from each server-rendered page. This
  one constraint shaped the entire "operation vs. raw replay" split.
- **Drift is the actual product.** Recording a flow once is easy; keeping it alive is the whole
  game. Classifying *why* a workflow broke — route vs. selector vs. token vs. schema — precisely
  enough that a repair could be both targeted and *safe to auto-publish* took the most iteration of
  anything we built.
- **Keeping secrets out of the contract.** Session cookies, CSRF tokens, and credentials can never
  leak into agent-visible schemas or traces. Drawing that line cleanly — hashed keys, prefix-only
  display, secrets never in the operation — took real care.
- **Repositioning mid-build.** We started as a paid marketplace. Partway through we realized the
  durable private API *was* the product and the storefront was noise. We ripped out payments,
  credits, and the public catalog entirely — a migration that drops every wallet/ledger/payment
  table and turns `marketplace_listings` into account-owned `apis` — and re-scoped every route to
  its owner. A genuine kill-your-darlings pass that made everything sharper.

## Accomplishments that we're proud of

- A complete **record → compile → verify → invoke → repair** loop that works against both a modern
  API *and* a hostile legacy portal.
- **One operation definition, four clients** — HTTP, OpenAPI, MCP, SDK/CLI — with no second source
  of truth.
- **Tenant isolation done right**, down to the `404`-not-`403` detail that defeats cross-tenant name
  probing.
- A genuinely **self-healing** API: typed drift classification, targeted repair, and re-verification
  before anything republishes.
- **Runs end-to-end with zero external services**, yet every seam is drawn to lift straight onto a
  real AWS production topology.

## What we learned

- The valuable artifact isn't the recording — it's **the contract that survives change.**
  Verification and repair *are* the product, not a feature bolted on top.
- **Less surface, sharper story.** Cutting payments and the marketplace made the code, the pitch,
  and the demo all better.
- Designing for **agents as first-class callers** — MCP, bearer keys, typed I/O, `404`-not-`403` —
  is a genuinely different discipline than designing for humans clicking buttons.

## What's next for Cairn

- Team/tenant ownership and roles on top of account scoping.
- Scheduled re-verification with health scores and alerting on repeated drift.
- LLM-assisted repair (computer-use / Browser Use) running *behind* deterministic replay, with
  human approval for risky diffs.
- The worker plane wired onto the AWS topology it's already designed for.
- A published SDK with typed clients generated per API from its OpenAPI, plus hosted MCP config for
  Claude, Cursor, ChatGPT, n8n, and Zapier.

## Built With

`node.js` · `javascript` · `postgresql` · `mcp` · `openapi` · `json-rpc` · `next.js` · `react` ·
`typescript` · `vercel` · `aws` *(target topology: rds · s3 · sqs · eventbridge · step-functions ·
ecs-fargate · secrets-manager · kms)*
