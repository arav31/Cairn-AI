# Cairn AWS Database Setup

This setup gives Cairn a persistent marketplace database and durable token accounting.

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

- Token wallet balances live in `token_wallets`.
- Every credit/debit is recorded in `token_ledger`.
- Stripe token-pack checkout completion credits the buyer wallet once.
- Successful token-paid API invocations debit the wallet once.
- `usage_events` records which API consumed credits.
- `payments` records Stripe token-pack payments.
- `invocation_logs` records tool calls and policy decisions.

## Security Notes

The pilot script opens Postgres on port `5432` to `0.0.0.0/0` because Vercel serverless functions do not provide fixed outbound IPs by default. Keep the generated password private and require TLS through `?sslmode=require`.

For production, replace this with one of:

- Move the runtime API into AWS ECS/Fargate in the same VPC as RDS.
- Use fixed egress/VPN/private networking before narrowing the security group.
- Use a managed serverless Postgres provider designed for public serverless access.
