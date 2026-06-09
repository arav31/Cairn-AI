# Cairn PRD

## One Line

Cairn watches an authorized user complete a browser task once, compiles the frontend's hidden backend workflow into a typed API, verifies it end to end, repairs it when the target changes, and exposes it as a permissioned skill agents can safely call.

## Problem

Enterprise tasks still live inside internal tools, vendor dashboards, and legacy portals that lack usable APIs. Browser agents can click through these systems, but doing that on every run is slow, brittle, hard to audit, and risky. Cairn converts a demonstrated workflow into a durable interface: one typed operation backed by a verified execution plan.

## Product Goals

- Capture the full client-visible backend workflow behind a browser task.
- Correlate multi-request flows into a dependency graph.
- Produce one typed API with input/output schemas and an internal execution plan.
- Verify before publishing and periodically re-verify after publishing.
- Repair broken APIs by generating a new candidate version from fresh authorized automation.
- Gate every API behind skill permissions, input constraints, rate limits, and audit logs.
- Support a company-private marketplace of verified automation APIs, with paid public or partner marketplace support later.

## Non-Goals

- No bot-protection evasion, credential challenge bypassing, or unauthorized automation.
- No direct database or service introspection; Cairn compiles only the interface exposed to an authenticated client.
- No general-purpose scraping or bulk extraction.
- No AI runtime backup for production writes in v1; failed APIs degrade and trigger repair.

## Architecture

### Capture

The production capture layer should launch an isolated Chromium profile per integration. Playwright should own session orchestration, human-in-loop recording, interaction traces, screenshots, auth-state capture, and success-state detection. mitmproxy or CDP-level capture should be the source of truth for traffic fidelity.

The pilot implementation uses built-in instrumentation to produce the same normalized artifacts without external dependencies.

### Synthesis

Cairn converts the trace into a flow graph, classifies parameters, detects fresh tokens, reconstructs row selection rules, and emits an operation definition with schemas, execution plan, success predicates, and required scopes.

### Verification

An operation is publishable only after deterministic replay succeeds against a known test input and expected output. Published operations become skills.

### Repair

When deterministic replay fails because of drift, Cairn creates a repair job. A future OpenAI Computer Use or Browser Use adapter can re-perform the authorized task in an isolated browser and produce a fresh trace. Cairn verifies any repaired candidate before publishing a new version.

### Marketplace

Marketplace starts as a company-private skill catalogue. Public paid marketplace support comes later with quality gates, Stripe Connect/Billing, and Stripe Agentic Commerce Protocol support.

## Roadmap

1. Pilot-ready demo: sandbox apps, capture, synthesis, verification, dashboard, skill approval, drift repair.
2. Private pilot: AWS-hosted runs, encrypted artifacts, tenant isolation, scheduled re-verification, repair approval queue, internal marketplace.
3. Enterprise governance: SSO, policy templates, approval chains, retention controls, audit exports, egress controls.
4. Paid internal marketplace: seller ownership, pricing, metering, invoices, quotas.
5. Agentic payments marketplace: Stripe Agentic Commerce Protocol, Shared Payment Tokens, buyer spend policies.
