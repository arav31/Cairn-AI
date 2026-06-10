# Cairn AWS Database Setup

This setup gives Cairn a persistent marketplace database, first-class accounts, durable token accounting, account-scoped usage, and reloadable API definitions.

## Resources

The CloudShell script creates or verifies:

- RDS Postgres instance: `cairn-postgres-prod`
- Secrets Manager secret: `/cairn/prod/database-url`
- SQS queues:
  - `cairn-recording-prod`
  - `cairn-synthesis-prod`
  - `cairn-verification-prod`
  - `cairn-invocation-prod`
  - `cairn-repair-prod`
- EventBridge bus: `cairn-prod`

The S3 artifact buckets are separate and should remain:

- `cairn-recordings-prod`
- `cairn-api-artifacts-prod`
- `cairn-verification-prod`

## Run From AWS CloudShell

```bash
git clone https://github.com/arav31/Cairn-AI.git
cd Cairn-AI
bash infra/aws/cloudshell-setup.sh
```

The script writes `cairn-prod.env` in CloudShell. Do not commit that file. Copy its values into local `.env` and Vercel production environment variables.

## Run The Schema Migration

After `DATABASE_URL` is set:

```bash
npm install
npm run db:migrate
```

The migration is idempotent and safe to run again.

## Token Accounting

Production token behavior is database backed when `DATABASE_URL` is present:

- Accounts live in `accounts`.
- Token wallet balances live in `token_wallets`.
- Every credit/debit is recorded in `token_ledger`.
- Stripe token-pack checkout completion credits the buyer wallet once.
- Successful token-paid API invocations debit the wallet once.
- `usage_events` records which account used which API and how it was paid for.
- `payments` records Stripe token-pack payments.
- `invocation_logs` records tool calls, listing context, caller account, and policy decisions.

## API Persistence

Published APIs are also database backed:

- `api_operations` stores schemas, execution plans, OpenAPI definitions, success predicates, and target metadata.
- `skill_manifests` stores scopes, approval state, owner, risk tier, and version pointers.
- `marketplace_listings` stores listing cards, README content, pricing, sample input, stats, and supported clients.
- `verification_records` stores verification history so an API can be checked again later.
- `workflow_submissions` stores contributor requests by account.

Cairn reloads published APIs from Postgres during bootstrap. Demo fixture APIs are hidden by default and are only seeded when `CAIRN_ENABLE_DEMO_LISTINGS=true`, so Vercel/AWS restarts recover the marketplace from stored API rows instead of hardcoded inventory.

## Security Notes

The pilot script creates a public RDS endpoint by default, but it does not open Postgres to the whole internet. It grants port `5432` only to `RDS_ALLOWED_CIDR`; if that variable is blank, the script tries to detect the current CloudShell public IP and uses that single `/32` address.

Vercel serverless functions do not provide fixed outbound IPs by default, so Vercel will not be able to connect until you choose one of the production networking options below or explicitly widen the CIDR. Keep the generated password private and require TLS through `?sslmode=require`.

Only for a throwaway pilot, you can opt into internet-wide database ingress by setting:

```bash
RDS_OPEN_TO_INTERNET=true bash infra/aws/cloudshell-setup.sh
```

For production, replace this with one of:

- Move the runtime API into AWS ECS/Fargate in the same VPC as RDS.
- Use fixed egress/VPN/private networking before narrowing the security group.
- Use a managed serverless Postgres provider designed for public serverless access.
