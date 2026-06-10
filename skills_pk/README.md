# API Skill Builder

API Skill Builder is a local Node.js prototype that learns a website workflow once with browser automation, then turns the useful parts into a reusable "skill" that can be run from a simple terminal chatbot.

The main goal is to avoid repeating slow browser automation for every quote/search/form workflow. The first run uses Chrome to observe the website. Later runs ask the same user-facing questions and call the saved API, result URL, or replay strategy directly.

## What It Does

Given a website link, the CLI can:

1. Check if a skill already exists for that site.
2. Run the saved skill in a chatbot-style prompt.
3. If no skill exists, open Chrome and record the user completing the workflow.
4. Capture network requests, page fields, selected options, typed values, clicks, and final URL state.
5. Rank useful endpoint candidates while ignoring static files, analytics, telemetry, fonts, CSS, images, and Cloudflare RUM noise.
6. Optionally run a GPT endpoint-engineering pass over the recording evidence.
7. Generate a draft skill from the best available strategy.
8. Promote the draft into `skills/*.json` for future runs.

The saved strategy can be one of three modes:

| Strategy | When Used | Runtime Path |
| --- | --- | --- |
| Direct API request | The site submits a real reusable JSON/query endpoint | Node `fetch` |
| Browser result URL | The site calculates in the browser but encodes inputs in the URL | Chrome CDP navigation |
| Browser workflow replay | No reusable endpoint or result URL exists, but fields/clicks were recorded | Chrome CDP replay |

## Why This Exists

Browser automation is flexible but slow. Direct API calls are fast but hard to discover by hand.

This project bridges the two:

- Use browser automation once to observe the real workflow.
- Convert the important request/inputs into a structured JSON skill.
- Ask future users clean website-like questions instead of raw payload paths.
- Use the fastest saved execution path that still produces the target result.

## Requirements

- Windows, macOS, or Linux with Node.js 20 or newer.
- Google Chrome or Chromium installed.
- Network access to the target websites.
- Optional: `OPENAI_API_KEY` or `NVIDIA_API_KEY` for contextual LLM analysis during learning.

No npm dependencies are currently required beyond Node built-ins.

## Optional GPT Endpoint Engineering

The project works without an API key. In that mode it uses deterministic evidence:

- network candidate ranking
- visible field labels/options
- final URL query parameters
- recorded input/change/click events

For better skill learning, configure an LLM provider. The learner can use either OpenAI Responses with Structured Outputs or NVIDIA's OpenAI-compatible Chat Completions API with Nemotron JSON mode. In both cases, the model behaves like an endpoint engineer reviewing the browser recording.

The GPT pass receives a compact, redacted evidence packet from the recording:

- visible website text, labels, fields, options, typed interactions, and clicked buttons
- ranked candidate requests from Chrome DevTools Protocol traffic
- request methods, URLs, query parameters, request body shapes, and safe header names
- short response body previews for top candidate requests when Chrome exposes them

It then infers:

- what the website workflow is trying to do
- which fields are true user inputs
- which button/action completes the workflow
- which endpoint or replay strategy best matches the result
- which payload or query paths map to each user-facing website question
- which recorded values are constants that should stay fixed
- which values are volatile, such as UUIDs or session-specific fields, and how to handle them
- whether a CSRF/session/bootstrap preflight appears necessary
- where the quote/result/output should be extracted from the response
- what output the user is likely expecting
- what risks require manual review

This is the part that is meant to approximate the manual Codex workflow of watching browser traffic, narrowing the useful request, inspecting payloads/responses, and turning that into a reusable API call.

The LLM pass is optional and gated by environment variables. The CLI auto-loads `skills_pk/.env` on startup.

```powershell
Copy-Item .env.example .env
notepad .env
node src/cli.js menu
```

For OpenAI, fill `.env` like this:

```env
SKILL_BUILDER_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
```

For NVIDIA Nemotron, fill `.env` like this:

```env
SKILL_BUILDER_LLM_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-...
NVIDIA_MODEL=nvidia/nemotron-3-ultra-550b-a55b
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_ENABLE_THINKING=1
NVIDIA_REASONING_BUDGET=16384
NVIDIA_MAX_TOKENS=16384
NVIDIA_TEMPERATURE=1
NVIDIA_TOP_P=0.95
```

Real terminal environment variables still win over `.env` values when both are set. The real `.env` file is ignored by git; only `.env.example` is committed.

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SKILL_BUILDER_LLM_PROVIDER` | auto | `openai` or `nvidia`; auto uses NVIDIA when `NVIDIA_API_KEY` is set, otherwise OpenAI |
| `OPENAI_API_KEY` | unset | Enables OpenAI Responses analysis when using the OpenAI provider |
| `OPENAI_MODEL` | `gpt-5.4-mini` | OpenAI model used for recording analysis |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for OpenAI-compatible endpoints |
| `NVIDIA_API_KEY` | unset | Enables NVIDIA Nemotron analysis when using the NVIDIA provider |
| `NVIDIA_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b` | NVIDIA model used for recording analysis |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA OpenAI-compatible API base URL |
| `NVIDIA_TEMPERATURE` | `1` | NVIDIA chat completion temperature |
| `NVIDIA_TOP_P` | `0.95` | NVIDIA chat completion top-p |
| `NVIDIA_MAX_TOKENS` | `16384` | NVIDIA maximum output tokens |
| `NVIDIA_ENABLE_THINKING` | `1` | Sends Nemotron thinking controls unless set to `0` or `off` |
| `NVIDIA_REASONING_BUDGET` | `16384` | Reasoning budget sent to NVIDIA when thinking is enabled |
| `SKILL_BUILDER_LLM` | unset | Set to `off` or `0` to force-disable LLM analysis |
| `SKILL_BUILDER_LLM_REQUIRED` | unset | Set to `1` to fail drafting if GPT endpoint engineering fails |
| `SKILL_BUILDER_LLM_TIMEOUT_MS` | `30000` | LLM analysis timeout |

The OpenAI Responses request intentionally does not send `temperature`. Some GPT models reject that parameter on the Responses API, so the learner lets the selected model use its default sampling behavior. The NVIDIA provider uses Chat Completions and does send `temperature`, `top_p`, `max_tokens`, and optional Nemotron thinking controls.

The LLM request uses `store: false` and sends a compact evidence packet, not the full raw recording. The packet includes redacted page text, field metadata, selected options, click/input summaries, ranked request candidates, and JSON request shapes. Raw recordings can still contain sensitive data and should remain local.

## Install

From this folder:

```powershell
npm install
```

There are no third-party packages right now, but running install is harmless and keeps the workflow familiar.

## Run The Chat Menu

```powershell
node src/cli.js menu
```

or:

```powershell
node src/cli.js
```

The menu supports:

1. Paste website link
2. Run saved skill
3. List saved skills
4. Inspect recording
5. Promote draft skill
6. Exit

## Normal Workflow

### 1. Paste A Website Link

```text
Website link: https://example.com/quote
```

The CLI checks `skills/*.json`.

If a matching skill exists, it offers to run it. If not, it starts learning.

### 2. Learn A New Skill

When learning starts, the tool launches Chrome with a temporary profile and Chrome DevTools Protocol enabled.

Complete the website workflow manually in the opened Chrome window. Use realistic placeholder values if you are just testing.

When the final quote/result/search output is visible, return to the terminal and press Enter.

The recorder saves a JSON file under `recordings/`.

### 3. Auto-Draft A Skill

After recording, the learner:

- Filters out static and telemetry traffic.
- Builds a compact evidence packet from page text, fields, options, clicks, final URL, and endpoint candidates.
- Uses optional GPT endpoint engineering when `OPENAI_API_KEY` is set.
- Looks for real form/search/quote endpoints.
- Falls back to final URL query parameters when the site computes client-side.
- Falls back to recorded browser replay when no endpoint exists.
- Extracts visible labels/options from the website where possible.
- Filters hidden/framework/generated fields out of the chatbot prompt layer.
- Improves draft descriptions, strategy metadata, endpoint selection, payload mappings, input questions, conversation groups, volatile fields, and output labels from contextual evidence.
- Generates a draft file under `skills/*.draft.json`.

### 4. Promote The Draft

If the draft looks correct:

```powershell
node src/cli.js promote-draft skills/example.draft.json
```

After promotion, future users can run the skill without relearning the browser workflow.

## Useful Commands

List skills:

```powershell
node src/cli.js list
```

Check whether a URL has a matching skill:

```powershell
node src/cli.js check-url "https://www.fwd.com.sg/travel-insurance/"
```

Run a skill through prompts:

```powershell
node src/cli.js chat fwd-travel-quote
```

Run a skill with command-line inputs:

```powershell
node src/cli.js run ipppptt --set age=25 --set situpreps=33 --set pushupreps=20 --set runmins=12 --set runsecs=30
```

Record a workflow directly:

```powershell
node src/cli.js record "https://example.com/form" --name example-form --goal "get quote"
```

Inspect a recording:

```powershell
node src/cli.js inspect-recording recordings/example-form-2026-06-09T10-00-00-000Z.json
```

Run only the LLM contextual analysis for a recording:

```powershell
node src/cli.js analyze-recording recordings/example-form-2026-06-09T10-00-00-000Z.json
```

Create a draft from a recording:

```powershell
node src/cli.js draft recordings/example-form-2026-06-09T10-00-00-000Z.json --name example-form
```

## How Recording Works

Recording is implemented in `src/recorder.js` and `src/cdp.js`.

### Chrome Launch

`src/cdp.js` launches Chrome with:

- A temporary user data directory.
- `--remote-debugging-port=0`, so Chrome chooses a free debug port.
- `--remote-debugging-address=127.0.0.1`.
- A normal visible browser by default, because the user needs to complete the workflow manually.

The recorder then connects to the active page over Chrome DevTools Protocol.

### CDP Domains Used

The recorder enables:

- `Network.enable`
- `Page.enable`
- `Runtime.enable`

It listens to:

- `Network.requestWillBeSent`
- `Network.responseReceived`
- `Network.loadingFinished`
- `Network.loadingFailed`

For each network request it stores:

- Request method
- URL
- Request headers
- POST body, when Chrome exposes it
- Resource type, such as `XHR`, `Fetch`, `Document`, `Script`, `Image`
- Response status
- Response headers
- MIME type
- Timing information
- Failure reason, if any

### Page Field Capture

At the end of recording, the tool evaluates JavaScript in the page to collect:

- Current URL
- Page title
- Visible body text preview
- All `input`, `select`, and `textarea` elements
- Names, ids, selectors, labels, placeholders, nearby text, group labels, values, checked state, options, and selected options

This is how generated questions become `Age`, `Trip type`, `Destination`, or `Salary Range` instead of raw payload names.

### Interaction Capture

The recorder injects a small script into the page before the workflow begins. That script records:

- `input` events
- `change` events
- `click` events
- CSS selector for the interacted element
- Label, placeholder, id, name, visible text, value, checked state, and URL at the time of the event
- Nearby text, group labels, section text, and sibling button/option choices when available

This gives the learner a fallback when there is no useful API endpoint. For example, a pure client-side calculator may only need a result URL or a browser replay of typed fields and a final button click.

For single-page apps, the final result screen may no longer contain the original form controls. The recorder therefore also turns recorded `input`, `change`, and well-labelled button-group `click` events into synthetic visible fields. Draft generation uses these recorded interactions as the source of prompts.

## How Endpoint Ranking Works

The ranking logic lives in `rankCandidates()` inside `src/recorder.js`.

Requests receive positive score for:

- `POST`, `PUT`, or `PATCH`
- `XHR` or `Fetch`
- JSON responses
- POST body presence
- Successful 2xx status
- Fast response time
- URL/path terms such as quote, price, premium, calculate, submit, search, apply

Requests are filtered or penalized when they look like:

- JavaScript, CSS, image, font, favicon, manifest, or media files
- Google Analytics, DoubleClick, Sentry, PostHog, Segment, TikTok, Facebook, New Relic, Cloudflare RUM, and similar telemetry
- Common telemetry paths such as `/collect`, `/track`, `/events`, `/rum`, `/client_report`
- Failed requests

The CLI no longer asks the user to pick a random candidate during the normal menu flow. It auto-drafts from the best usable strategy.

## How GPT Endpoint Engineering Works

The optional GPT/Nemotron layer lives in `src/llm-analyzer.js`.

It does not drive the browser and does not execute requests. Browser recording is still handled by Chrome/CDP. The model interprets the recording evidence and returns strict structured JSON. The deterministic generator then compiles that JSON into the actual skill.

The evidence packet includes:

- source URL and final URL
- page title and redacted page text
- visible input/select/textarea fields
- selected options and field values after redaction
- recent input/change/click events
- ranked endpoint candidates
- query parameter previews
- request body shapes with keys and value types instead of full raw values
- short response body previews for top candidates, when available
- safe header names, excluding cookies/authorization/token-like headers

The provider paths are:

- OpenAI: `POST /responses` with `text.format.type=json_schema`
- NVIDIA: `POST /chat/completions` with `response_format.type=json_object`

The model returns:

- workflow summary
- inferred goal
- confidence
- preferred strategy: `direct_api`, `query_api`, `browser_result_url`, `browser_replay`, or `manual_review`
- preferred candidate request id when relevant
- `endpointEngineering`, including selected endpoint, method, payload type, endpoint purpose, user input mappings, constants, volatile fields, preflight hints, output extraction, implementation notes, warnings, and confidence
- cleaned website-like input questions
- a short chatbot intro and logical input groups
- important actions/buttons
- expected outputs
- risks and review notes

The generator uses that result to:

- reorder candidate endpoints when the model identifies a better goal request
- prefer result URL or browser replay when the model sees a client-side workflow
- map JSON body fields and query parameters to website-style questions
- require promptable inputs to be backed by visible field/event evidence
- regenerate UUID-like payload fields when the model marks them volatile
- omit volatile fields when the model says they should not be replayed
- keep recorded constants that are part of the product/workflow rather than user input
- use output extraction paths or result-section hints from the model when they are available
- rewrite bad questions like raw JSON paths into human website-style prompts
- ask grouped chatbot questions instead of dumping a flat payload-field list
- attach a `learning` metadata block to the draft skill
- print a learning summary in the CLI, including selected endpoint, payload type, input mappings, volatile fields, preflight hints, and warnings

If the LLM call fails and `SKILL_BUILDER_LLM_REQUIRED` is not set, the tool logs the failure and falls back to deterministic drafting.

If you want new skills to require GPT assistance instead of falling back silently, add this to `.env`:

```env
SKILL_BUILDER_LLM_REQUIRED=1
```

## How Draft Generation Works

The draft generator tries strategies in order. When LLM analysis is available, it can influence the order, but it does not bypass the same safety filters.

### Prompt Hygiene And Conversation Flow

The generator separates two kinds of request data:

- User-facing inputs: visible text fields, selects, textareas, file controls, choices, and values that the website user actually enters or chooses.
- Replay internals: hidden state, framework fields, submit buttons, generated counters, CSRF/XSRF/authenticity/request verification tokens, nonces, UUID/session/correlation ids, CAPTCHA fields, and similar transport details.

Replay internals are kept in the request when they are needed, or marked as volatile/preflight/computed values, but they are not saved as user questions. For example, ASP.NET fields such as `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, and `__EVENTVALIDATION` stay inside the form payload and should never appear as chatbot prompts.

The generator also does not treat arbitrary non-empty API payload keys as questions. A key such as `policyId`, `tmpBasePremium`, `agentNumber`, or `isQuickQuote` stays a recorded constant unless it resolves to visible field/event evidence. This prevents internal request shapes from leaking into the chatbot.

When the LLM provider is enabled, it must also return a `conversation` plan:

- `intro`: one short sentence explaining what the skill will do
- `inputGroups`: ordered groups of related inputs
- `repeatable`: whether the group can be asked multiple times
- `addAnotherQuestion`: the follow-up prompt for repeated entities

This is how a course/CAP calculator can ask for `Module Code`, `Module MCs`, and `Module Grade`, then ask `Do you want to add another module?`, instead of asking raw payload names.

If GPT is unavailable, the deterministic generator still applies the same technical-field filters and infers simple groups from visible fields and recorded interactions.

### 1. Tally Form Strategy

For Tally forms, the generator reads Tally-specific form structure and maps response UUIDs back to visible questions.

It supports:

- Text fields
- Email fields
- URL fields
- Numeric/rating fields
- Dropdowns
- Multiple choice
- Checkboxes
- File upload fields

File uploads are handled by `src/skill-runner.js`. The runner can upload a local file to Tally's response asset endpoint before submitting the final form payload.

### 2. Query Skill Strategy

For GET search/filter pages, the generator maps URL query parameters to visible form fields.

Example:

```json
{
  "query": {
    "age": { "$value": "{{age}}" }
  }
}
```

At runtime, the template engine materializes the final URL.

### 3. Generic Request Strategy

For JSON POST/PUT/PATCH endpoints, the generator:

- Parses the recorded JSON body.
- If GPT endpoint engineering is available, applies the model's payload mapping plan first.
- Replaces only mapped user-controlled fields with template placeholders when possible.
- Regenerates UUID-like volatile fields when the model marks them as generated values.
- Omits volatile fields when the model says they should not be replayed.
- Keeps unmapped constants from the recorded body for review.
- Falls back to templating only non-technical, user-facing scalar fields when GPT is unavailable or no mapping plan exists.

This is the fallback for reusable API endpoints that do not have a custom provider parser.

For `application/x-www-form-urlencoded` POST endpoints, the generator builds `request.form` instead of a raw string body. The runner URL-encodes those form fields at runtime, so user-entered values are submitted correctly.

### 4. Final URL Strategy

Some sites calculate entirely in the browser but store the state in the final URL.

For those, the generator creates a `browserMode: "navigate"` skill. The runner opens Chrome to the materialized result URL and reads the rendered page text.

This is how the IPPT example works.

### 5. Browser Replay Strategy

When no reusable endpoint and no useful final URL exists, the generator uses recorded interaction events.

The generated skill contains:

```json
{
  "browserWorkflow": {
    "startUrl": "https://example.com",
    "actions": [
      { "type": "fill", "selector": "#age", "value": "{{age}}" },
      { "type": "click", "selector": "#calculate" }
    ]
  }
}
```

Runtime is slower than direct API calls because Chrome must open, fill fields, click buttons, and read the rendered page. It is still useful when the website has no stable API surface.

## Skill File Format

Skills live in `skills/*.json`.

Minimal shape:

```json
{
  "id": "example",
  "name": "Example Skill",
  "sourceUrl": "https://example.com",
  "inputs": [
    {
      "id": "destination",
      "question": "Destination",
      "type": "string",
      "optional": false
    }
  ],
  "steps": [
    {
      "id": "goal",
      "request": {
        "method": "GET",
        "url": "https://example.com/search",
        "query": {
          "q": { "$value": "{{destination}}" }
        }
      }
    }
  ],
  "outputs": [
    {
      "label": "Result",
      "from": "goal",
      "path": "$",
      "extractor": "important"
    }
  ]
}
```

Conversation metadata is optional but generated drafts now include it when possible:

```json
{
  "conversation": {
    "intro": "I'll help you run the quote workflow. I'll ask for the details the website needs, then run the saved workflow.",
    "inputGroups": [
      {
        "title": "Traveller details",
        "description": "",
        "inputIds": ["traveller-age", "traveller-region"],
        "repeatable": true,
        "addAnotherQuestion": "Do you want to add another traveller?"
      }
    ]
  }
}
```

Repeatable groups collect arrays at runtime. If the recorded request has a generated matching count field, the draft can add a computed count:

```json
{
  "computed": {
    "traveller-count": { "fn": "count", "input": "traveller-age" }
  }
}
```

Input types supported by the CLI:

- `string`
- `number`
- `email`
- `url`
- `choice`
- `multi-choice`
- `json`
- `file`

## How Runtime Execution Works

Runtime execution is implemented in `src/skill-runner.js`.

The runner:

1. Normalizes raw inputs.
2. Applies computed values such as UUIDs, formatted dates, ages, or repeatable-group counts.
3. Uploads provider-specific files if required.
4. Renders template placeholders like `{{age}}`.
5. Executes each step in order.
6. Saves intermediate response values when configured.
7. Extracts outputs from response JSON or text.
8. Condenses raw endpoint/page responses into the important user-facing result.

The runner should not dump whole endpoint payloads or full HTML pages by default. Generated generic outputs use `extractor: "important"`, which:

- uses explicit JSON paths when a skill provides them
- compacts large JSON responses to result-like keys such as price, premium, quote, score, category, risk, status, duration, distance, or plan
- strips HTML down to readable text and extracts likely result sections
- has a BMI-specific extractor for BMI score, category, risk, and healthy weight range

For custom skills, add `focus` to guide text/HTML extraction:

```json
{
  "label": "Result",
  "from": "goal",
  "path": "$",
  "extractor": "important",
  "focus": "Your Calculated BMI Results"
}
```

### Direct HTTP Runtime

Most API skills use Node's built-in `fetch`.

The runner keeps an in-memory cookie jar for multi-step flows. This is used by flows that first fetch a CSRF token or session cookie, then call a compute/quote endpoint.

### Browser Fallback Runtime

If a GET request hits a browser challenge, such as Cloudflare's "Just a moment" page, the runner can retry inside Chrome.

This path uses CDP to:

- Navigate to the site.
- Let the challenge settle.
- Execute `fetch()` inside the browser context with site cookies.
- Return response status, headers, and body back to Node.

### Browser Navigate Runtime

For client-side result URL skills, the runner:

- Opens Chrome.
- Navigates to the final URL.
- Waits briefly for rendering.
- Reads `document.body.innerText`.

### Browser Workflow Runtime

For replay skills, the runner:

- Opens Chrome.
- Navigates to `startUrl`.
- Runs each recorded action.
- Dispatches `input` and `change` events after fills.
- Clicks recorded buttons/links.
- Reads the rendered result text.

## Important Files

| File | Purpose |
| --- | --- |
| `src/cli.js` | Terminal menu, chat prompts, recording commands, draft promotion |
| `src/recorder.js` | CDP network capture, field extraction, interaction recording, candidate ranking, draft generation |
| `src/llm-analyzer.js` | Optional OpenAI Structured Outputs analysis over compact recording evidence |
| `src/skill-runner.js` | Executes direct HTTP, browser fallback, browser navigation, browser replay, file uploads |
| `src/cdp.js` | Launches Chrome and provides a small CDP WebSocket client |
| `src/templates.js` | Renders `{{input}}` templates and computed fields |
| `src/json-path.js` | Reads and flattens JSON paths for skill generation and output extraction |
| `skills/*.json` | Registered skills |
| `skills/*.draft.json` | Draft skills awaiting review |
| `recordings/*.json` | Local raw recordings from learning runs |

## Example Saved Skills

This package currently includes examples for:

- FWD travel insurance quote
- Singlife simple term quote
- WeWorkRemotely search
- IPPT calculator result URL
- Tally form submission with file upload handling

Some websites apply bot protection or change APIs frequently. Saved skills may need refresh when the upstream website changes.

## Speed Expectations

Approximate runtime categories:

| Mode | Typical Speed | Notes |
| --- | --- | --- |
| Direct API | Hundreds of ms to a few seconds | Fastest path, no browser |
| Direct API with token/cookie bootstrap | 1-5 seconds | Multiple HTTP steps |
| Browser result URL | 2-6 seconds | Opens Chrome and waits for rendering |
| Browser workflow replay | 5-20+ seconds | Slowest, but works for no-API sites |
| Full manual learning | Human-dependent | One-time setup path |

The CLI prints endpoint timings after each run.

## Privacy And Safety

Raw recordings can contain:

- Typed form values
- Emails/names/addresses
- Uploaded file metadata
- Request headers
- Session identifiers
- Analytics identifiers
- Full URLs and query strings

Do not commit raw recordings unless they have been reviewed and sanitized.

Recommended repository policy:

- Commit `src/`, `skills/`, `package.json`, and this README.
- Keep `recordings/` local by default.
- Ignore `*.draft.json` unless intentionally sharing a draft for review.
- Review generated skills before promotion.

## Limitations

This tool cannot guarantee automation for every website.

Common blockers:

- CAPTCHA
- Payment steps
- Login-only workflows
- Strong bot protection
- Request signing tied to device fingerprinting
- Encrypted payloads generated in obfuscated JavaScript
- Server-side sessions that expire immediately
- Websites whose calculations only exist in front-end code

When direct endpoint replay is not viable, the tool falls back to browser navigation or browser replay.

## Troubleshooting

### Chrome does not open

Check that Chrome is installed. `src/cdp.js` searches common Chrome paths on Windows, macOS, and Linux.

### The generated skill asks bad questions

Record again and make sure you actually interact with the visible website form fields before pressing Enter. The recorder uses field labels, placeholders, selected options, and interaction events to infer questions.

If you see prompts such as `VIEWSTATE`, `EVENTVALIDATION`, `csrf`, `sessionUuid`, `respondentUuid`, `Value for $.payload.path`, or generated button/counter names, the skill was probably drafted before prompt hygiene was added or the recording did not expose enough visible-field evidence. Re-draft from the recording or re-learn the skill with the current version. Those fields should be replay internals, not questions.

Enable `OPENAI_API_KEY` or `NVIDIA_API_KEY` for better contextual rewriting. The LLM pass is specifically asked to infer what the website is doing, write a short chatbot intro, group related questions, detect repeated entities, and keep hidden/generated transport fields out of the user prompt layer.

### The skill learned CSS, images, or analytics

That should be filtered in the normal menu flow. If you use the low-level `draft` command manually, review the generated skill before promotion.

### GET request crashes with body errors

GET and HEAD requests are now executed without a body. If you see this again, inspect the generated skill and remove `body` from GET/HEAD steps.

### Cloudflare 403

Some sites block direct local API calls. The runner can use browser fallback for GET requests, but POST endpoints may still be blocked if the site requires browser-only challenge tokens.

### OpenAI says temperature is unsupported

Update to a version that omits `temperature` from the Responses API request. The learner now sends `model`, `store`, `max_output_tokens`, `instructions`, `input`, and structured output settings, but does not send `temperature`.

### OpenAI insufficient quota

If `.env` contains `SKILL_BUILDER_LLM_REQUIRED=1`, quota or billing errors stop draft generation. Add quota/billing for the API project, switch to a key with quota, or temporarily set `SKILL_BUILDER_LLM=off` to use deterministic fallback.

### File upload fields

For Tally file uploads, enter a local file path when prompted. The runner uploads the file first and passes the uploaded asset object to the final response request.

## Development Notes

Syntax check:

```powershell
node --check src/cli.js
node --check src/recorder.js
node --check src/skill-runner.js
```

Run a known browser-navigation skill:

```powershell
node src/cli.js run ipppptt --set age=25 --set situpreps=33 --set pushupreps=20 --set runmins=12 --set runsecs=30
```

Inspect candidate filtering:

```powershell
node src/cli.js inspect-recording recordings/ipppptt-2026-06-09T13-30-10-482Z.json
```

For a pure client-side calculator, "No endpoint candidates found" can be correct. The generator may still create a result URL or browser replay skill.
