# Cairn Brand Guide

Use this guide for landing pages, product UI, pitch decks, demo slides, and submission screenshots.

## Brand Position

Cairn is a marketplace for workflow APIs that AI agents can discover, pay for, and call.

Core line:

```text
Marketplace APIs for agent workflows.
```

Supporting line:

```text
Record a useful browser workflow once. Expose it as an endpoint. Let agents call the API instead of clicking through the site every time.
```

## Visual Direction

- Warm technical, not corporate SaaS.
- Beige light mode with moss-green accents.
- Monospace typography, terminal-adjacent but readable.
- Abstract wavefield / halftone texture for motion and identity.
- Thin rails, low-radius cards, restrained shadows.
- No generic blue SaaS gradients, no purple AI blobs, no stock illustrations.

## Color Tokens

| Token | Hex | Use |
| --- | --- | --- |
| Background | `#efe5d1` | Page and slide background |
| Surface | `#fff8ea` | Code blocks, panels, light cards |
| Primary text | `#182015` | Headings and strong body copy |
| Hero ink | `#152016` | Hero title over wavefield |
| Body text | `#253024` | Hero body copy |
| Muted text | `#596150` | Captions, labels, footer |
| Accent moss | `#3f6c24` | Emphasis words, buttons, active states |
| Deep teal | `#235f63` | Secondary accent and focus |
| Line | `rgba(53, 73, 34, 0.2)` | Card borders and section rules |

## Typography

Primary font style:

```text
monospace
```

Fallback:

```text
ui-monospace, monospace
```

Rules:

- Use monospace everywhere.
- Headlines are bold, tight, and lowercase where natural.
- Do not use negative letter spacing beyond the website style.
- Body copy should stay small but readable.
- Use green emphasis on one important word, not entire paragraphs.

## Landing Page Structure

Recommended order:

1. Hero: `Cairn`
2. Marketplace value: discover, pay for, and call workflow APIs.
3. Platform cards: Browse, Connect, Pay, Call, Submit, Test.
4. Agent proof: discovery, OpenAPI, MCP, token wallet, README, contribution flow.
5. Marketplace section: API catalog, token wallet, Stripe-ready.
6. Security/authorization section.
7. Prototype/run section.

Avoid a public design-guide section on the landing page.

## Slide Style

Use the website as the master style.

Slide background:

- `#efe5d1`
- Optional subtle halftone/wave texture in one corner.

Slide title:

- Monospace bold.
- `#182015`.
- Accent one word in `#3f6c24`.

Slide body:

- Monospace regular.
- `#253024` for important body.
- `#596150` for captions.

Cards:

- Low radius or square corners.
- 1px `rgba(53, 73, 34, 0.2)` border.
- Background `rgba(255, 248, 234, 0.66)`.
- Avoid nested cards.

Good slide section labels:

```text
// marketplace
// agent endpoints
// token wallet
// workflow intake
// verification
// security
```

## Deck Template

Suggested pitch deck flow:

1. Title: Cairn
2. Problem: agents are stuck clicking through browser workflows.
3. Product: marketplace APIs for agent workflows.
4. Demo: browse API, inspect README, pay with token, call endpoint.
5. Architecture: recorded workflow -> API definition -> marketplace listing -> agent call.
6. Marketplace: catalog, pricing, tokens, Stripe-ready.
7. Agent surface: discovery, OpenAPI, MCP.
8. Workflow intake: submit new workflow ideas.
9. Safety: authorized systems, demo mode, token checks, clean contracts.
10. Roadmap: private pilot, governance, paid marketplace, agentic payments.

## Copy Rules

Use:

- `workflow APIs`
- `agent-ready endpoints`
- `marketplace`
- `Cairn tokens`
- `discover, pay for, and call`
- `OpenAPI`
- `MCP`
- `agent-facing README`
- `workflow submission`

Avoid:

- vague AI automation claims
- saying Cairn bypasses access controls
- claiming production payments are live without Stripe keys
- generic `AI agent platform` language
- internal-only design notes on public pages

## Screenshots

For submissions and slides:

- Use full-width website screenshots.
- Prefer the hero and marketplace sections.
- Crop with enough beige margin.
- Keep the animated texture visible but do not let it obscure text.
- Use desktop screenshots for pitch decks and mobile screenshots only for responsive proof.
