# Cairn — Record once. Reuse forever.

> Turn a browser task you already do into a durable, private API — typed, verified, and
> yours. You and your agents call it forever; Cairn keeps it working when the site changes.

**Tagline:** Record once. Reuse forever. Repaired when targets change.

---

## Inspiration

Agents are great at reasoning and bad at the boring part: reliably driving real websites.
Every team we talked to had the same graveyard of brittle scripts — a hack for the insurance
portal, a scraper for the county records site — that broke the moment a button moved. Worse,
every agent re-solves the same multi-step browser flow from scratch, slowly, on every single run.

We kept coming back to one idea: the hard, repeated work of clicking through a site should be
done **once**, captured, and turned into something stable you can call like any other API — not
a script you babysit, but an endpoint that stays working.

## What it does

Cairn turns a recorded browser workflow into a durable, private, typed API.

You record a task once (title, target URL, goal). Cairn compiles the recording into an
**operation** — input schema, output schema, execution plan, selectors, allowed domains, and
success predicates — then verifies it end-to-end by replaying it against known input and
expected output. Once it passes, you get:

- an **HTTP invoke endpoint**
- an **OpenAPI** spec
- an **MCP tool** (so Claude, Cursor, or any MCP agent can call it natively)
- an **SDK + CLI**

Every API is **private and account-scoped** — gated by a hashed bearer agent key, owned by you
and your team, never dropped into a public catalog. And it's **durable**: Cairn re-verifies on a
schedule, detects drift (route change, stale token, selector failure, changed response schema),
and proposes a repaired version — only republishing after the repair re-verifies.

Agents call a typed contract, not a raw browser session. The contract stays stable even when the
underlying site doesn't.

## How we built it

- **Core engine (Node, no framework):** one Node HTTP server hosts the whole lifecycle —
  `record → compile → verify → invoke → repair`. Staying framework-free kept the boundaries
  explicit and made the demo trivial to run with `npm start`.
- **Two sandbox targets, on purpose:** *Meridian*, a modern JSON REST CRM, and *Civic*, a
  deliberately nasty legacy portal with CSRF tokens and ViewState-style hidden state. Civic
  forced us to handle fresh-token lifting and server-rendered forms — the stuff that breaks naive
  automation.
- **Typed surfaces, single-sourced:** OpenAPI is generated from the operation definition, and the
  same contract drives the MCP tool, SDK, and CLI — one source of truth for every client.
- **Auth & privacy:** accounts issue bearer keys that are SHA-256 hashed before storage
  (prefix-only display); every read and invoke is scoped to the owning account, returning an
  identical 404 for "not found" and "not yours" so one tenant can't probe another's API names.
- **Persistence & infra:** Postgres (via `pg`) as the source of truth for accounts, operations,
  skill manifests, verification records, and invocation logs; AWS for the production data and
  worker planes — RDS, S3 for immutable recordings/traces/artifacts, SQS + EventBridge for job
  orchestration, and Secrets Manager + KMS for secrets.
- **Execution:** deterministic replay first, with a worker plane (SQS / Step Functions / ECS
  Fargate) designed for a browser-based fallback when replay can't cover a case.
- **Frontend:** a clean Inter-based dashboard for schemas, data, and forms, plus a Next.js
  landing deployed on Vercel.

## Challenges we ran into

- **Legacy sites fight back.** Civic's CSRF + hidden ViewState meant a recording couldn't be
  replayed verbatim — we had to lift fresh tokens per run and re-derive hidden fields. This shaped
  the whole "operation definition vs. raw replay" split.
- **Drift is the real product.** Anyone can record a flow once; keeping it alive is the hard part.
  Classifying *why* a workflow broke (route vs. selector vs. token vs. schema) so repair could be
  targeted — and safe to auto-publish — took the most iteration.
- **Keeping secrets out of the contract.** Session cookies, CSRF tokens, and credentials can never
  leak into agent-visible schemas or traces. Drawing that boundary cleanly took real care.
- **Repositioning mid-build.** We started as a paid marketplace and realized the durable, private
  API *was* the product. We stripped payments, credits, and the public catalog entirely and
  re-scoped every route to the owning account — a genuine "kill your darlings" pass.

## Accomplishments that we're proud of

- A full **record → compile → verify → invoke → repair** loop that works against both a modern API
  and a gnarly legacy portal.
- **One contract, four clients** — HTTP, OpenAPI, MCP, and SDK/CLI all generated from a single
  operation definition.
- **Tenant isolation done right**, including the 404-not-403 detail that stops cross-tenant name
  probing.
- A genuinely **durable** API: drift detection plus repair proposals that only ship after
  re-verification.
- Runs end-to-end locally with effectively **zero external dependencies**, yet maps cleanly onto a
  real AWS production topology.

## What we learned

- The valuable thing isn't the recording — it's the **stable contract that survives change**.
  Verification and repair are the product, not a feature.
- **Less surface, sharper story.** Cutting payments and the marketplace made everything — the code,
  the pitch, the demo — better.
- Designing for **agents as first-class callers** (MCP, bearer keys, typed I/O) is a different
  discipline than designing for humans clicking buttons.

## What's next for Cairn

- Team/tenant ownership and roles on top of account scoping.
- Scheduled re-verification with health scores and alerting on repeated drift.
- LLM-assisted repair (computer-use / Browser Use) behind deterministic replay, with human
  approval for risky diffs.
- Hosted MCP config for Claude, Cursor, ChatGPT, n8n, and Zapier.
- A published SDK with typed clients generated from each API's OpenAPI.

## Built With

`node.js` · `javascript` · `postgresql` · `mcp` · `openapi` · `aws` (rds, s3, sqs, eventbridge,
step-functions, ecs-fargate, secrets-manager, kms) · `next.js` · `react` · `typescript` ·
`vercel` · `pnpm`
