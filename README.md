# Cairn

Cairn is a pilot demo for turning an authorized browser workflow into a verified, permissioned API that agents can call safely.

This repo is intentionally dependency-light so it can run immediately:

```bash
npm start
```

Then open `http://localhost:3000`.

Run tests with:

```bash
npm test
```

## What Is Implemented

- Two sandbox target systems:
  - Meridian CRM, a modern JSON REST app.
  - Civic Records Portal, a legacy server-rendered app with CSRF and ViewState-style hidden state.
- Event-driven Cairn dashboard with live capture, synthesis, verification, repair, invocation, policy, and marketplace panels.
- Workflow synthesis into typed operation definitions with flow graphs, parameter classes, fresh-token extractors, OpenAPI 3.1 output, and skill manifests.
- Deterministic execution and verification for the two target workflows.
- Policy-gated skill invocation with audit logs and blocked-action demo.
- Drift and repair demo for the Civic detail route.
- Internal marketplace scaffold with future Stripe/agentic-commerce metadata fields.

## Adapter Boundaries

The pilot uses built-in instrumentation instead of launching Playwright or mitmproxy directly. The code keeps the boundaries explicit:

- `src/cairn/pipeline.js` is where a real Playwright recorder and mitmproxy capture stream would be attached.
- `src/cairn/repair.js` exposes the repair-agent seam for OpenAI Computer Use or Browser Use.
- `src/cairn/executor.js` is the deterministic operation runner.
- `src/cairn/policy.js` is the OPA/Rego replacement point.

## Deployment Direction

- Browser/proxy/execution workers: AWS ECS Fargate.
- Workflow orchestration: AWS Step Functions.
- Queues/events: SQS/EventBridge.
- Artifacts: S3 with KMS.
- Data plane: RDS Postgres.
- Secrets: AWS Secrets Manager.
- UI and internal marketplace: Vercel.
