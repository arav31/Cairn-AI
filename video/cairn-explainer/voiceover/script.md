# Cairn Explainer Voiceover Script

Composition: `CairnReusableApiExplainer`
Runtime: 90 seconds at 30fps
Audio status: ElevenLabs narration generated with Eleven v3 expressive tags.
Clean narration is kept here; tagged TTS prompts live in `voiceover/cues.json`.

## 0-6s

Agents can use browsers. But repeated production work deserves better than a clunky browser interface.

## 6-20s

A browser agent can click through the task, but every run spends tokens observing, planning, clicking, waiting, and recovering. It is slow, token-heavy, brittle, and hard to audit.

## 20-34s

The expensive part is that the same workflow gets rediscovered every time. Cairn treats that repeated browser grind as something that should be compiled once, then reused.

## 34-48s

With Cairn, an authorized user performs the workflow once. Cairn captures the backend flow visible to that session and builds a durable operation from it.

## 48-62s

The result is not another browser run. It is a typed API your own agents can call directly through HTTP, OpenAPI, MCP, an SDK, or a CLI.

## 62-72s

This section is reserved for the actual product walkthrough. Drop in the showcase file and the explainer will use it without changing the story.

## 72-82s

Cairn verifies before activation, monitors health, detects drift, and repairs the underlying plan while keeping the caller's API contract stable.

## 82-90s

Cairn turns browser work into your reusable API. Record once. Reuse forever.
