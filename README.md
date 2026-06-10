# Cairn

Cairn is a marketplace for workflow APIs that AI agents can discover, pay for, and call.

If a useful task is stuck behind a long browser workflow, someone can record that workflow, Cairn can turn it into an API, and an agent can call that API later without clicking through the website every time.

Current product shape:

- A Smithery-style marketplace for agent-ready workflow APIs, backed by stored published listings.
- A package, SDK, and CLI that agents or developers can install.
- Account wallets with Cairn credits.
- Credit purchase flow for token packs.
- Skill invocation with credits deducted only after a successful completed workflow.
- Per-skill README, OpenAPI, MCP, and integration guide endpoints.
- Stub-mode Stripe locally, with real Stripe Checkout/webhook paths ready for configuration.
- Optional Postgres persistence when `DATABASE_URL` is configured, including accounts, wallets, usage, API definitions, and verification records. Without stored published API rows, the marketplace catalog is intentionally empty.

Production URL currently used by the SDK default:

```text
https://cairn-ai-gamma.vercel.app
```

## What Is Implemented

- Marketplace homepage at `/`.
- Pricing page at `/pricing`.
- Storage-backed API catalog:
  - `/api/catalog` lists only stored, published APIs.
  - Demo fixture APIs are available only when `CAIRN_ENABLE_DEMO_LISTINGS=true`.
- Agent discovery:
  - `/.well-known/cairn.json`
  - `/openapi.json`
  - `/mcp`
  - `/api/catalog`
  - `/api/tools`
- Per-skill docs:
  - `/api/tools/:namespace/:slug/readme.md`
  - `/api/tools/:namespace/:slug/openapi.json`
- Package install surface:
  - `npm install github:arav31/Cairn-AI`
  - `const { CairnClient } = require("cairn")`
  - `npx cairn ...`
- Account and credits:
  - `POST /api/accounts`
  - `GET /api/accounts/:accountId/usage`
  - `GET /api/tokens/wallet?accountId=...`
  - `POST /api/tokens/quote`
  - `POST /api/tokens/checkout`
- Token-paid invocation:
  - `POST /api/tools/:namespace/:slug/invoke`
  - `POST /mcp` with `tools/call`
- Integration guide endpoint:
  - `/api/integrations`
  - `/api/integrations/:namespace/:slug`
- Stripe payment scaffolding:
  - Checkout Sessions for direct API payment.
  - Checkout Sessions for token packs.
  - Webhook handling for `checkout.session.completed`.
  - Stripe signature verification when `STRIPE_WEBHOOK_SECRET` is set.
  - Billing meter event helper for usage billing.
- Postgres schema and migration:
  - Accounts.
  - Published APIs.
  - Skill manifests.
  - Marketplace listings.
  - Verification records.
  - Workflow submissions.
  - Token wallets.
  - Token ledger.
  - Usage events.
  - Payments.
  - Invocation logs.
- AWS setup helper:
  - `infra/aws/cloudshell-setup.sh`
  - Creates/verifies RDS, SQS queues, EventBridge bus, and Secrets Manager secret.
- Vercel deployment adapter:
  - `api/cairn.js`
  - `vercel.json`

## Quickstart

Install dependencies:

```bash
npm install
```

Create a local env file:

```bash
cp .env.example .env
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
http://localhost:3000/pricing
```

If port `3000` is busy:

```bash
PORT=3005 npm start
```

Run tests:

```bash
npm test
```

## Install The Package

The package is not published to npm yet. Install it from GitHub for now:

```bash
npm install github:arav31/Cairn-AI
```

Use the SDK:

```js
const { CairnClient } = require("cairn");

const cairn = new CairnClient({
  baseUrl: "https://cairn-ai-gamma.vercel.app",
  accountId: "demo-user",
  agentKey: process.env.CAIRN_AGENT_KEY
});

const account = await cairn.createAccount();
process.env.CAIRN_AGENT_KEY ||= account.agentAuth.agentKey;
await cairn.buyTokens("starter");

const result = await cairn.invoke("insurance/compare-insurance-prices", {
  input: {
    coverageType: "auto",
    zipCode: "78701",
    driverAge: 35,
    vehicleYear: 2021
  },
  paymentMethod: "tokens"
});
```

Use the CLI:

```bash
npx cairn account create --account demo-user --base-url https://cairn-ai-gamma.vercel.app
npx cairn buy-tokens --pack starter --account demo-user --base-url https://cairn-ai-gamma.vercel.app
npx cairn invoke \
  --tool insurance/compare-insurance-prices \
  --account demo-user \
  --base-url https://cairn-ai-gamma.vercel.app \
  --input '{"coverageType":"auto","zipCode":"78701","driverAge":35,"vehicleYear":2021}'
```

Useful CLI commands:

```bash
npx cairn catalog
npx cairn guide
npx cairn guide --tool insurance/compare-insurance-prices
npx cairn wallet --account demo-user
npx cairn readme --tool real-estate/search-properties
```

## Account And Credit Flow

Cairn uses account-scoped credit wallets. In the current demo, an account is identified by an `accountId`. When `DATABASE_URL` is configured, that account is a durable row in Postgres and all wallet, ledger, payment, usage, invocation, and workflow-submission records attach to it.

Agent auth is now account-scoped. `POST /api/accounts` returns an `agentAuth.agentKey` once for a new account. Store it as `CAIRN_AGENT_KEY` and send it as `Authorization: Bearer <agentKey>` for wallet, checkout, MCP `tools/call`, workflow submission, and invoke calls. Cairn stores only a SHA-256 hash of the key.

Create or load an account:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"accountId":"demo-user"}'
```

Check wallet and recent ledger entries:

```bash
curl "http://localhost:3000/api/tokens/wallet?accountId=demo-user" \
  -H "Authorization: Bearer $CAIRN_AGENT_KEY"
```

Check account usage:

```bash
curl "http://localhost:3000/api/accounts/demo-user/usage" \
  -H "Authorization: Bearer $CAIRN_AGENT_KEY"
```

Buy credits:

```bash
curl -X POST http://localhost:3000/api/tokens/checkout \
  -H "Authorization: Bearer $CAIRN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "packId": "starter",
    "accountId": "demo-user"
  }'
```

Local behavior:

- If `STRIPE_SECRET_KEY` is blank, token checkout runs in stub mode and credits the wallet immediately.
- If `STRIPE_SECRET_KEY` is set, token checkout creates a Stripe Checkout Session.
- The Stripe webhook credits the wallet after a paid `checkout.session.completed` token-pack event.

## Invoke A Skill With Credits

Call an API with `paymentMethod: "tokens"`:

```bash
curl -X POST http://localhost:3000/api/tools/insurance/compare-insurance-prices/invoke \
  -H "Authorization: Bearer $CAIRN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethod": "tokens",
    "tokenAccountId": "demo-user",
    "input": {
      "coverageType": "auto",
      "zipCode": "78701",
      "driverAge": 35,
      "vehicleYear": 2021
    }
  }'
```

Credit behavior:

- Cairn checks the wallet before running the workflow.
- If the wallet has too few credits, the workflow does not run.
- If the workflow is blocked by policy, credits are not deducted.
- If the workflow fails, credits are not deducted.
- If the workflow completes successfully, Cairn deducts the skill token cost.
- The debit is idempotent when a database is configured, using the invocation id.

The successful response includes:

```json
{
  "paymentMode": "tokens",
  "tokenDebit": {
    "ok": true,
    "tokenCost": 1,
    "wallet": {
      "accountId": "demo-user",
      "balance": 249
    }
  },
  "result": {
    "allowed": true,
    "output": {}
  }
}
```

## Demo Fixture APIs

| API | Endpoint | Cash price | Credit price |
| --- | --- | ---: | ---: |
| Compare Insurance Prices | `/api/tools/insurance/compare-insurance-prices/invoke` | `$0.03` | `1 token` |
| Search Properties | `/api/tools/real-estate/search-properties/invoke` | `$0.04` | `1 token` |

These are synthetic fixture workflows, not real hosted marketplace supply. They are hidden by default so the deployed marketplace does not pretend to have APIs before anything is published.

Enable them only for local demos or tests:

```bash
CAIRN_ENABLE_DEMO_LISTINGS=true npm start
```

Real marketplace rows must come from storage: an operation definition, skill manifest, listing, and verification record in Postgres. S3 stores the larger immutable artifacts behind those rows.

## Pricing

Current token packs:

| Pack | Tokens | Price | Approx. cost |
| --- | ---: | ---: | ---: |
| Starter | `250` | `$0.99` | `0.40 cents/token` |
| Builder | `1,500` | `$4.99` | `0.33 cents/token` |
| Team | `7,500` | `$19.99` | `0.27 cents/token` |

Direct per-call payment is also supported through `/quote`, `/checkout`, and `/invoke`, but tokens are the smoother path for agents because a buyer can fund once and spend across all marketplace APIs.

## Agent Endpoints

Discovery:

```http
GET /.well-known/cairn.json
GET /api/catalog
GET /api/tools
GET /openapi.json
GET /api/integrations
POST /mcp
```

Tool details:

```http
GET /api/tools/:namespace/:slug
GET /api/tools/:namespace/:slug/readme.md
GET /api/tools/:namespace/:slug/openapi.json
GET /api/tools/:namespace/:slug/verification
GET /api/integrations/:namespace/:slug
```

Tool payment and invocation:

```http
POST /api/tools/:namespace/:slug/quote
POST /api/tools/:namespace/:slug/checkout   # requires agent bearer key
POST /api/tools/:namespace/:slug/invoke     # requires agent bearer key
```

Accounts and credits:

```http
POST /api/accounts
GET /api/accounts/:accountId/usage          # requires matching agent bearer key
GET /api/tokens/config
GET /api/tokens/wallet?accountId=demo-user  # requires matching agent bearer key
POST /api/tokens/quote
POST /api/tokens/checkout                   # requires matching agent bearer key
```

Stripe helpers:

```http
GET /api/payments/stripe-config
POST /api/payments/quote
POST /api/payments/checkout                 # requires agent bearer key
POST /api/payments/usage                    # requires agent bearer key
POST /api/stripe/webhook
```

Contribution:

```http
POST /api/workflows/recordings
```

## MCP Usage

List tools:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "tools",
    "method": "tools/list"
  }'
```

Call a tool with credits:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "call-1",
    "method": "tools/call",
    "params": {
      "name": "compareInsurancePrices",
      "paymentMethod": "tokens",
      "tokenAccountId": "demo-user",
      "arguments": {
        "coverageType": "auto",
        "zipCode": "78701",
        "driverAge": 35,
        "vehicleYear": 2021
      }
    }
  }'
```

## Submit A Workflow

The homepage has a contribution form for workflow ideas. It posts to:

```http
POST /api/workflows/recordings
```

Example payload:

```json
{
  "title": "Compare flight refund options",
  "targetUrl": "https://example.com/account/trips",
  "goal": "Return refund eligibility, policy notes, and next available action.",
  "artifacts": []
}
```

This is currently an accepted upload stub. The marketplace side is ready to accept submissions; the recorder/compiler tooling still needs to attach real artifacts, verification, and listing publication.

## Stripe Configuration

The app loads `.env` from the repo root when `npm start` runs. Real `.env` files are ignored by Git; `.env.example` is the committed template.

Core payment variables:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CAIRN_PUBLIC_URL=https://your-domain.example
```

Optional per-listing Stripe Price IDs:

```bash
STRIPE_PRICE_INSURANCE_COMPARE=price_...
STRIPE_PRICE_PROPERTY_SEARCH=price_...
```

Optional token pack Price IDs:

```bash
STRIPE_PRICE_TOKENS_STARTER=price_...
STRIPE_PRICE_TOKENS_BUILDER=price_...
STRIPE_PRICE_TOKENS_TEAM=price_...
```

Optional usage billing:

```bash
STRIPE_METER_EVENT_NAME=cairn_api_call
```

Stub mode:

- Blank `STRIPE_SECRET_KEY` means no real Stripe calls are made.
- API checkout returns a test authorization.
- Token checkout grants a test token pack immediately.
- Usage billing returns a stub response.

Real mode:

- Set `STRIPE_SECRET_KEY`.
- Set `CAIRN_PUBLIC_URL`.
- Configure `STRIPE_WEBHOOK_SECRET`.
- Point Stripe webhooks at `POST /api/stripe/webhook`.
- Listen for `checkout.session.completed`.
- Token pack Checkout Sessions include `metadata.kind=token_pack`, `metadata.account_id`, `metadata.pack_id`, and `metadata.tokens`.

## Environment Variables

Server:

| Name | Required | Used for |
| --- | --- | --- |
| `PORT` | no | Local HTTP port. Defaults to `3000`. |
| `HOST` | no | Bind host. Defaults to `127.0.0.1`; use `0.0.0.0` in containers. |
| `CAIRN_PUBLIC_URL` | production | Public app URL used for Stripe Checkout return URLs and Vercel base URL fallback. |

SDK/CLI:

| Name | Required | Used for |
| --- | --- | --- |
| `CAIRN_BASE_URL` | optional | Marketplace URL for the SDK/CLI. Defaults to production. |
| `CAIRN_ACCOUNT_ID` | optional | Default account ID for the SDK/CLI. Defaults to `demo-user`. |
| `CAIRN_AGENT_KEY` | protected API calls | Bearer key returned once by `POST /api/accounts`. Required for wallet, checkout, invoke, usage, workflow submission, and MCP `tools/call`. |

Stripe:

| Name | Required | Used for |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | production payments | Creates Stripe Checkout Sessions and meter events. Blank means stub mode. |
| `STRIPE_WEBHOOK_SECRET` | production payments | Verifies Stripe webhook signatures. |
| `STRIPE_PRICE_INSURANCE_COMPARE` | optional | Prebuilt Stripe Price for the insurance API. |
| `STRIPE_PRICE_PROPERTY_SEARCH` | optional | Prebuilt Stripe Price for the property API. |
| `STRIPE_METER_EVENT_NAME` | optional | Shared Stripe meter event name for usage billing. |
| `STRIPE_PRICE_TOKENS_STARTER` | optional | Prebuilt Stripe Price for the Starter token pack. |
| `STRIPE_PRICE_TOKENS_BUILDER` | optional | Prebuilt Stripe Price for the Builder token pack. |
| `STRIPE_PRICE_TOKENS_TEAM` | optional | Prebuilt Stripe Price for the Team token pack. |

Database:

| Name | Required | Used for |
| --- | --- | --- |
| `DATABASE_URL` | production database | RDS/Postgres connection string. Enables persistent marketplace and token state. |
| `DATABASE_SSL` | production database | Set to `true` for RDS. Set to `false` only for trusted local Postgres. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | optional | Set to `true` only when a trusted CA chain is configured. |
| `DATABASE_POOL_MAX` | optional | Postgres connection pool size. Defaults to `3`. |

AWS:

| Name | Used for |
| --- | --- |
| `AWS_REGION` | AWS SDK region. |
| `AWS_ACCOUNT_ID` | AWS account ID. |
| `RDS_DB_INSTANCE_IDENTIFIER` | RDS instance name for setup scripts. |
| `RDS_DB_NAME` | Postgres database name. |
| `RDS_MASTER_USERNAME` | Postgres admin username. |
| `S3_RECORDINGS_BUCKET` | Raw workflow recordings. |
| `S3_API_ARTIFACTS_BUCKET` | Operation specs, OpenAPI files, traces, and generated artifacts. |
| `S3_TRACES_BUCKET` | Browser/proxy traces. |
| `S3_SCREENSHOTS_BUCKET` | Screenshots and visual artifacts. |
| `S3_VERIFICATION_BUCKET` | Verification run artifacts. |
| `S3_REPAIR_BUCKET` | Repair job artifacts. |
| `KMS_KEY_ARN` | KMS key for encrypted artifacts and secrets. |
| `SQS_RECORDING_QUEUE_URL` | Recording job queue. |
| `SQS_SYNTHESIS_QUEUE_URL` | Compiler job queue. |
| `SQS_VERIFICATION_QUEUE_URL` | Verification job queue. |
| `SQS_INVOCATION_QUEUE_URL` | Runtime invocation queue. |
| `SQS_REPAIR_QUEUE_URL` | Drift repair queue. |
| `EVENTBRIDGE_BUS_NAME` | Run/listing/repair event bus. |
| `SECRETS_PREFIX` | AWS Secrets Manager path prefix. |

Repair adapters:

| Name | Used for |
| --- | --- |
| `OPENAI_API_KEY` | Future computer-use repair assistant. |
| `BROWSER_USE_API_KEY` | Future Browser Use repair adapter. |

## Database Setup

Local demos run without a database. In that mode, wallets, ledgers, and logs live in process memory, and the marketplace catalog starts empty unless `CAIRN_ENABLE_DEMO_LISTINGS=true`.

Production should set `DATABASE_URL` and run:

```bash
npm run db:migrate
```

The migration file is:

```text
migrations/001_initial_schema.sql
```

When `DATABASE_URL` is set:

- Accounts persist in the `accounts` table.
- Marketplace listings are loaded from Postgres during bootstrap.
- Demo fixture APIs are not upserted unless explicitly enabled with `CAIRN_ENABLE_DEMO_LISTINGS=true`.
- Published APIs are stored as operation definitions, skill manifests, marketplace listings, and verification records.
- On boot, Cairn reloads published APIs from Postgres so hosted APIs can be listed, inspected, and checked again after a restart.
- Token wallets persist by account ID.
- Token ledger entries persist as credits and debits.
- Stub token purchases and Stripe token purchases are idempotent.
- Successful token-paid invocations debit exactly once.
- Token-paid usage events are persisted with `payment_method=tokens`.
- Direct-payment usage events are persisted with the caller account when an `accountId`, `caller.id`, or payment account is supplied.
- Invocation logs are persisted with caller/account and listing context.
- Payments are recorded for completed Stripe token checkouts.
- Workflow submissions persist with the submitting account.

Core API persistence model:

| Table | What it stores |
| --- | --- |
| `accounts` | Buyer, agent, or contributor account identity. |
| `api_operations` | Full operation definition: schemas, execution plan, OpenAPI, selectors, success predicates, and target metadata. |
| `skill_manifests` | Permissioned skill wrapper: owner, scopes, risk tier, approval state, and version pointers. |
| `marketplace_listings` | Public marketplace card: slug, pricing, README, sample input, stats, supported clients, and listing metadata. |
| `verification_records` | Verification history for checking whether an API version still works. |
| `token_wallets` | Current credit balance per account. |
| `token_ledger` | Immutable credit/debit ledger entries per account. |
| `usage_events` | Account-scoped API usage events for token and direct-payment runs. |
| `payments` | Stripe/token-pack payment records. |
| `workflow_submissions` | Contributor workflow requests by account. |
| `invocation_logs` | Policy decision, input/output hashes, status, caller account, and listing context. |

## AWS Setup

The helper script is:

```bash
infra/aws/cloudshell-setup.sh
```

Run it from AWS CloudShell after cloning the repo:

```bash
rm -rf Cairn-AI
git clone https://github.com/arav31/Cairn-AI.git
cd Cairn-AI
bash infra/aws/cloudshell-setup.sh
set -a
. ./cairn-prod.env
set +a
npm install
npm run db:migrate
```

The script writes `cairn-prod.env` with:

- `DATABASE_URL`
- RDS settings
- SQS queue URLs
- `EVENTBRIDGE_BUS_NAME`
- `SECRETS_PREFIX`

Current S3 bucket naming used in production env:

```text
cairn-recordings-prod
cairn-api-artifacts-prod
cairn-verification-prod
```

After AWS creates `cairn-prod.env`, sync those non-empty values to Vercel and redeploy.

## Vercel Deployment

The app runs locally as a plain Node HTTP server. On Vercel, `api/cairn.js` adapts the same server to a Vercel Function, and `vercel.json` rewrites routes into that function.

Deploy:

```bash
npx vercel@latest deploy --prod --force --scope trend-pact
```

Current production project:

```text
trend-pact/cairn-ai
https://cairn-ai-gamma.vercel.app
```

Production env vars already uploaded during the last setup pass:

- `CAIRN_PUBLIC_URL`
- `AWS_REGION`
- `AWS_ACCOUNT_ID`
- DB SSL/pool defaults
- RDS naming defaults
- S3 bucket/prefix config
- `SECRETS_PREFIX`
- `STRIPE_METER_EVENT_NAME`

Still missing until AWS/Stripe setup is completed:

- `DATABASE_URL`
- `SQS_RECORDING_QUEUE_URL`
- `SQS_SYNTHESIS_QUEUE_URL`
- `SQS_VERIFICATION_QUEUE_URL`
- `SQS_INVOCATION_QUEUE_URL`
- `SQS_REPAIR_QUEUE_URL`
- `EVENTBRIDGE_BUS_NAME`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Stripe token pack Price IDs
- Per-listing Stripe Price IDs

## Project Map

```text
bin/cairn.js               CLI for catalog, accounts, wallets, credits, and skill calls
src/sdk/client.js          Installable Node SDK

public/index.html          Marketplace UI
public/app.js              Marketplace UI behavior
public/pricing.html        Pricing page
public/pricing.js          Pricing page behavior
public/styles.css          Shared marketplace styling

api/cairn.js               Vercel Function adapter
vercel.json                Vercel rewrites and function config
src/server.js              HTTP server, routes, static pages, MCP surface
src/cairn/accounts.js      Account normalization and durable account creation
src/cairn/marketplace.js   Seed listings, OpenAPI, integration guides, checkout, usage billing
src/cairn/tokens.js        Token packs, wallets, ledger, token checkout
src/cairn/database.js      Postgres pool, migration, marketplace/token persistence helpers
src/cairn/pipeline.js      Recording/synthesis/verification state and invocation
src/cairn/executor.js      Deterministic workflow execution
src/cairn/policy.js        Skill permissions and invocation logs
src/cairn/synthesizer.js   Recording-to-operation compiler demo
src/cairn/repair.js        Drift classification and repair proposal demo
src/data/seed.js           Synthetic CRM, civic, insurance, and property data

tests/*.test.js            Node test runner coverage
```

## Sandbox Targets

These remain for recorder/compiler testing, but they are not marketplace seed listings.

- `/meridian` - modern JSON REST CRM sandbox.
- `/civic` - legacy server-rendered records portal with CSRF and ViewState-style hidden state.

Demo recorder/repair endpoints:

```http
POST /api/demo/record
POST /api/demo/reverify
POST /api/demo/repair
POST /api/demo/drift-civic
POST /api/demo/reset-drift
```

## Tests

```bash
npm test
```

Current tests cover:

- Account creation, credit purchase, skill invocation, and post-success debit.
- Account-scoped usage summaries and workflow submissions.
- SDK defaults and SDK request payloads.
- Marketplace bootstrap and OpenAPI generation.
- Stable operation IDs for database upserts.
- Token wallet purchase and spend flow.
- Stripe token checkout metadata.
- Payment authorization gates.
- Policy allow/block decisions.
- Civic fresh-token lifting and repair.
- Meridian dependency graph synthesis.
- Vercel route adapter behavior.

Latest local result:

```text
22 tests passing
```

## What Needs To Be Done Next

Immediate product work:

- Publish the SDK under a real npm package name such as `@cairn/ai`.
- Add OAuth/OIDC for enterprise agent runtimes.
- Add user/team ownership for wallets, listings, and workflow submissions.
- Add a dashboard view for account usage, ledger history, and invoices.
- Add a hosted MCP configuration page for ChatGPT, Claude, Cursor, Zapier, and n8n.

Payments:

- Create Stripe products/prices for token packs.
- Create Stripe products/prices for direct per-call APIs if direct micro-payments remain useful.
- Configure Stripe webhook endpoint in Stripe Dashboard.
- Set `STRIPE_WEBHOOK_SECRET` in Vercel.
- Decide whether tiny per-call costs should stay direct payments or move entirely to token packs and usage meters.
- Add refunds/adjustments to the token ledger.
- Add spend limits and approval thresholds.

Database and AWS:

- Finish AWS CloudShell setup so `DATABASE_URL`, SQS URLs, and EventBridge bus name exist.
- Run `npm run db:migrate` against RDS.
- Sync the generated AWS env values to Vercel.
- Redeploy Vercel after env sync.
- Add RDS backups, retention, monitoring, and least-privilege security groups.
- Add IAM roles for Vercel OIDC or another short-lived AWS credential flow.

Marketplace:

- Add contributor profiles and listing ownership.
- Add listing review, approval, verification freshness, and rollback controls.
- Add listing quality badges and verification history.
- Add search/filter facets for categories, risk tier, price, verification status, and supported agent clients.

Workflow automation:

- Connect teammate recorder/compiler output to `workflow_submissions`.
- Store recording bundles and generated artifacts in S3.
- Add automated verification jobs before publishing a listing.
- Add scheduled re-verification.
- Add repair jobs using OpenAI computer-use or Browser Use only after deterministic replay fails.
- Require human approval for risky repair diffs, new domains, destructive actions, or permission expansion.

Security:

- Encrypt session artifacts and sensitive traces before storage.
- Redact traces before sending anything to an LLM repair assistant.
- Add domain allowlists for workflow execution and repair.
- Add rate limits per account, skill, and tenant.
- Add audit exports for compliance reviewers.
- Add tenant isolation before onboarding real companies.

Developer experience:

- Generate typed clients from per-skill OpenAPI schemas.
- Add `cairn init` to create a local config file.
- Add `cairn login` once auth exists.
- Add webhook helpers for workflow completion callbacks.
- Add examples for ChatGPT Actions, MCP clients, Cursor, n8n, Zapier, and direct REST.
- Split the SDK from the marketplace server package once the package stabilizes.
