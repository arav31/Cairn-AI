# Cairn Remotion Explainer

Standalone Remotion source for a 90-second silent explainer video:

```text
Record once. Reuse forever.
```

The video explains why raw browser agents are slow, token-heavy, brittle, and hard to audit for repeated production workflows. Cairn records one authorized browser workflow, compiles it into a typed private API, verifies it, and keeps it working when targets drift.

## Commands

Run commands from this directory:

```bash
npm run download-assets
npm run generate-voiceover
npm run test
npm run typecheck
npm run still
npm run render
npm run render:voiceover
```

Root shortcuts are also available:

```bash
npm run video:studio
npm run video:still
npm run video:render
npm run video:voiceover
npm run video:render:voiceover
```

The final silent render writes to:

```text
video/cairn-explainer/out/cairn-reusable-api-explainer-silent.mp4
```

The voiced render writes to:

```text
video/cairn-explainer/out/cairn-reusable-api-explainer-voiceover.mp4
```

## Showcase MP4

The showcase segment runs from `62s` to `72s`. Until the final product capture exists, the composition renders a branded placeholder.

When the showcase is ready, place it here:

```text
video/cairn-explainer/public/assets/showcase/cairn-showcase.mp4
```

On the next `npm run render`, Remotion detects the file and uses it inside the reserved segment.

## Voiceover

The default render script passes Remotion's `--muted` flag so stock/showcase audio
is excluded from the exported MP4. To create a voiced version, add
`ELEVENLABS_API_KEY` to the ignored repo-root `.env`, then run:

```bash
npm run generate-voiceover
npm run render:voiceover
```

The generated voiceover timeline is written to:

```text
public/assets/voiceover/cairn-explainer/cairn-explainer-voiceover.wav
```

The current narration uses ElevenLabs `eleven_v3` with `Bella - Professional,
Bright, Warm`. `voiceover/cues.json` keeps clean narration plus `ttsText`
entries with inline performance tags for pauses, emphasis, and tonal shifts.

The narration source files are:

```text
voiceover/script.md
voiceover/cues.json
voiceover/elevenlabs.json
```

If the generated audio timing differs, adjust `src/storyboard.ts` scene ranges first, then update both voiceover files.

## Assets

Stock videos are downloaded from Pexels into `public/assets/stock/` and referenced with Remotion `staticFile()`. See `public/assets/stock/asset-sources.json` after running `npm run download-assets`.

Pexels license:

```text
https://www.pexels.com/license/
```
