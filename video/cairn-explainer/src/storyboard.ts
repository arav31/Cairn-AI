export const COMPOSITION = {
  id: "CairnReusableApiExplainer",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 3240,
} as const;

export const VOICEOVER_AUDIO_PATH =
  "assets/voiceover/cairn-explainer/cairn-explainer-voiceover.wav";

export type SceneAsset =
  | {
      kind: "stock-video";
      path: string;
      credit: string;
    }
  | {
      kind: "showcase-video";
      path: string;
    };

export type Scene = {
  id: string;
  start: number;
  end: number;
  startFrame: number;
  durationInFrames: number;
  kicker: string;
  title: string;
  body: string;
  labels: string[];
  visual: string;
  narration: string;
  asset?: SceneAsset;
};

const scene = (
  input: Omit<Scene, "startFrame" | "durationInFrames">,
): Scene => ({
  ...input,
  startFrame: input.start * COMPOSITION.fps,
  durationInFrames: (input.end - input.start) * COMPOSITION.fps,
});

export const scenes: Scene[] = [
  scene({
    id: "cold-open",
    start: 0,
    end: 4,
    kicker: "// current state",
    title: "Stop making agents click the same site twice.",
    body:
      "Stop making agents click through the same site over and over.",
    labels: ["browser loop", "repeated work", "agent ops"],
    visual: "Terminal title card over a warm halftone wavefield.",
    narration:
      "Stop making agents click through the same site over and over.",
  }),
  scene({
    id: "browser-loop",
    start: 4,
    end: 15,
    kicker: "// the browser loop",
    title: "Browser agents are useful for exploration.",
    body:
      "In production, every run pays again in screenshots, planning, waits, retries, and UI drift.",
    labels: ["screenshots", "planning", "waits", "retries", "UI drift"],
    visual: "Looping browser frame with task chips stacking into visible operational drag.",
    narration:
      "Browser agents are useful for exploration. But in production, every run pays again in screenshots, planning, waits, retries, and UI drift.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/analytics-laptop.mp4",
      credit: "Pexels video 8480289",
    },
  }),
  scene({
    id: "repetition-cost",
    start: 15,
    end: 28,
    kicker: "// cairn shift",
    title: "Cairn changes the interface.",
    body:
      "Record one authorized browser workflow, verify it, and turn it into a private API your agents can call directly.",
    labels: ["record", "verify", "private API", "agent call"],
    visual: "Three repeated agent runs collapse into one reusable contract outline.",
    narration:
      "Cairn changes the interface. Record one authorized browser workflow, verify it, and turn it into a private API your agents can call directly.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/code-laptop.mp4",
      credit: "Pexels video 13522186 by Raddy",
    },
  }),
  scene({
    id: "record-once",
    start: 28,
    end: 42,
    kicker: "// record once",
    title: "A browser task becomes a durable operation.",
    body:
      "Name the workflow, define the result you want, and record it once.",
    labels: ["business renewal", "target site", "success result", "one recording"],
    visual: "Browser recording transforms into a structured operation card.",
    narration:
      "In this demo, a business renewal check starts as a normal browser task. Name the workflow, define the result you want, and record it once.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/private-team.mp4",
      credit: "Pexels video 7989451 by Mikhail Nilov",
    },
  }),
  scene({
    id: "typed-api",
    start: 42,
    end: 55,
    kicker: "// reusable interface",
    title: "Cairn publishes a stable contract.",
    body:
      "Invoke endpoint, OpenAPI, MCP, SDK, and curl are generated from the captured request flow.",
    labels: ["invoke endpoint", "OpenAPI", "MCP", "SDK", "curl"],
    visual: "Endpoint cards fan out from one workflow operation.",
    narration:
      "Cairn captures the request flow behind that session and publishes a stable contract: invoke endpoint, OpenAPI, MCP, SDK, and curl.",
  }),
  scene({
    id: "showcase",
    start: 55,
    end: 77,
    kicker: "// product walkthrough",
    title: "The workflow becomes an API surface.",
    body:
      "My APIs, copyable endpoints, structured input, JSON output, and verification health are all generated from one workflow.",
    labels: ["My APIs", "copy endpoints", "structured input", "JSON result", "health"],
    visual: "Recorded product walkthrough of the Business Renewals API flow.",
    narration:
      "Here is the workflow as a product surface. The new Business Renewals API lands in My APIs, exposes copyable endpoints, accepts structured input, returns JSON, and tracks verification health.",
    asset: {
      kind: "showcase-video",
      path: "assets/showcase/cairn-showcase.mp4",
    },
  }),
  scene({
    id: "reliability",
    start: 77,
    end: 94,
    kicker: "// downstream payoff",
    title: "The benefits compound after the first recording.",
    body:
      "Agents spend fewer tokens, run faster, leave cleaner audit trails, and keep calling the same contract when the site changes.",
    labels: ["fewer tokens", "faster runs", "audit trails", "stable contract", "repair"],
    visual: "Health timeline moves from verified to drift detected to repaired.",
    narration:
      "Downstream, agents spend fewer tokens, run faster, produce cleaner audit trails, and keep calling the same contract even when the website changes underneath.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/server-room.mp4",
      credit: "Pexels video 1085656",
    },
  }),
  scene({
    id: "conclusion",
    start: 94,
    end: 108,
    kicker: "// conclusion",
    title: "No browser loop. No repeated rediscovery.",
    body:
      "Cairn turns website work into reusable infrastructure. Record once. Reuse forever.",
    labels: ["private API", "typed API", "durable", "agent-ready", "reusable"],
    visual: "Final Cairn mark with one workflow flowing into one stable endpoint.",
    narration:
      "No browser loop. No repeated rediscovery. Cairn turns website work into reusable infrastructure. Record once. Reuse forever.",
  }),
];

export type VoiceoverCue = {
  sceneId: string;
  start: number;
  end: number;
  narration: string;
};

export const voiceoverCues: VoiceoverCue[] = scenes.map((item) => ({
  sceneId: item.id,
  start: item.start,
  end: item.end,
  narration: item.narration,
}));

export const BANNED_POSITIONING_PATTERNS = [
  ["market", "place"],
  ["Str", "ipe"],
  ["cred", "its"],
  ["token", " wallet"],
  ["pay", " per"],
].map((parts) => new RegExp(`\\b${parts.join("")}\\b`, "i"));
