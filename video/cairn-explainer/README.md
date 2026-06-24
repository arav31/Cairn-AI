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
npm run test
npm run typecheck
npm run still
npm run render
```

Root shortcuts are also available:

```bash
npm run video:studio
npm run video:still
npm run video:render
```

The final silent render writes to:

```text
video/cairn-explainer/out/cairn-reusable-api-explainer-silent.mp4
```

## Showcase MP4

The showcase segment runs from `62s` to `72s`. Until the final product capture exists, the composition renders a branded placeholder.

When the showcase is ready, place it here:

```text
video/cairn-explainer/public/assets/showcase/cairn-showcase.mp4
```

On the next `npm run render`, Remotion detects the file and uses it inside the reserved segment.

## Voiceover

The current video is silent. The render script passes Remotion's `--muted` flag so
stock/showcase audio is excluded from the exported MP4. Use these files for
ElevenLabs timing:

```text
voiceover/script.md
voiceover/cues.json
```

If the generated audio timing differs, adjust `src/storyboard.ts` scene ranges first, then update both voiceover files.

## Assets

Stock videos are downloaded from Pexels into `public/assets/stock/` and referenced with Remotion `staticFile()`. See `public/assets/stock/asset-sources.json` after running `npm run download-assets`.

Pexels license:

```text
https://www.pexels.com/license/
```
