# AWS Storage Setup

## Current S3 Buckets

The AWS account `802314158919` in `us-east-1` has these Cairn buckets:

| Bucket | Purpose |
| --- | --- |
| `cairn-recordings-prod` | Raw and redacted workflow recordings from browser capture jobs. |
| `cairn-api-artifacts-prod` | Compiled operation specs, OpenAPI snapshots, traces, screenshots, and published API artifacts. |
| `cairn-verification-prod` | Verification run outputs, drift reports, repair proposals, and approval artifacts. |

## Prefix Layout

Use prefixes instead of creating many more buckets:

```text
cairn-recordings-prod/
  recordings/
  redacted-recordings/

cairn-api-artifacts-prod/
  traces/
  screenshots/
  operation-specs/
  openapi/

cairn-verification-prod/
  verification-runs/
  repair-jobs/
```

## Security Defaults

Keep all three buckets private:

- Block all public access.
- Use server-side encryption. SSE-S3 is fine for the pilot; move to KMS when tenant separation and audit requirements get stricter.
- Enable versioning for operation specs, OpenAPI snapshots, verification outputs, and repair proposals.
- Do not add broad public bucket policies. Serve public docs through the app or signed URLs.

## Database Split

S3 is not the marketplace database. It stores large immutable artifacts. The searchable marketplace should use Postgres for:

- API listings and owners.
- Skill manifests and versions.
- Verification status and freshness.
- Contribution submissions.
- Token wallets and ledger rows.
- Stripe customer/payment references.
- Invocation logs and audit metadata.

Set `DATABASE_URL` once the Postgres database is created. Until published API rows exist in Postgres, the marketplace catalog intentionally stays empty. Local fixture APIs are available only with `CAIRN_ENABLE_DEMO_LISTINGS=true`.

## App Env Mapping

Local `.env` now points at the production S3 buckets:

```bash
AWS_REGION=us-east-1
S3_RECORDINGS_BUCKET=cairn-recordings-prod
S3_API_ARTIFACTS_BUCKET=cairn-api-artifacts-prod
S3_TRACES_BUCKET=cairn-api-artifacts-prod
S3_SCREENSHOTS_BUCKET=cairn-api-artifacts-prod
S3_VERIFICATION_BUCKET=cairn-verification-prod
S3_REPAIR_BUCKET=cairn-verification-prod
```

When deploying workers on AWS, prefer IAM task roles over access keys in env vars.
