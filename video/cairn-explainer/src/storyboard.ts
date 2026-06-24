export const COMPOSITION = {
  id: "CairnReusableApiExplainer",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 2700,
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
    end: 6,
    kicker: "// current state",
    title: "Agents are still doing work through websites.",
    body:
      "Browser agents can do it, but the browser is the wrong production interface for repeated work.",
    labels: ["browser", "forms", "portals", "dashboards"],
    visual: "Terminal title card over a warm halftone wavefield.",
    narration:
      "Agents can use browsers now. But for repeated production work, the browser is still a clunky interface.",
  }),
  scene({
    id: "browser-loop",
    start: 6,
    end: 20,
    kicker: "// the browser loop",
    title: "Every run repeats the same fragile loop.",
    body:
      "Observe the page. Plan the next click. Wait for UI. Read screenshots. Fill forms. Retry when the site changes.",
    labels: ["slow", "token-heavy", "brittle", "hard to audit"],
    visual: "Looping browser frame with task chips stacking into visible operational drag.",
    narration:
      "A browser agent can click through the task, but every run spends tokens observing, planning, clicking, waiting, and recovering. It is slow, token-heavy, brittle, and hard to audit.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/analytics-laptop.mp4",
      credit: "Pexels video 8480289",
    },
  }),
  scene({
    id: "repetition-cost",
    start: 20,
    end: 34,
    kicker: "// hidden cost",
    title: "The workflow is discovered again every time.",
    body:
      "The useful part is not the clicks. It is the hidden request flow behind the task. That should become reusable infrastructure.",
    labels: ["same task", "new trace", "more tokens", "more latency"],
    visual: "Three repeated agent runs collapse into one reusable contract outline.",
    narration:
      "The expensive part is that the same workflow gets rediscovered every time. Cairn treats that repeated browser grind as something that should be compiled once, then reused.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/code-laptop.mp4",
      credit: "Pexels video 13522186 by Raddy",
    },
  }),
  scene({
    id: "record-once",
    start: 34,
    end: 48,
    kicker: "// cairn",
    title: "Record the task once.",
    body:
      "An authorized user performs the workflow. Cairn captures the client-visible backend flow and turns the task into a durable operation.",
    labels: ["authorized session", "request graph", "inputs", "success state"],
    visual: "Browser recording transforms into a structured operation card.",
    narration:
      "With Cairn, an authorized user performs the workflow once. Cairn captures the backend flow visible to that session and builds a durable operation from it.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/private-team.mp4",
      credit: "Pexels video 7989451 by Mikhail Nilov",
    },
  }),
  scene({
    id: "typed-api",
    start: 48,
    end: 62,
    kicker: "// reusable interface",
    title: "The browser workflow becomes a typed API.",
    body:
      "Agents stop clicking. They call a private API with a stable contract: HTTP, OpenAPI, MCP, SDK, and CLI.",
    labels: ["HTTP", "OpenAPI", "MCP", "SDK", "CLI"],
    visual: "Endpoint cards fan out from one workflow operation.",
    narration:
      "The result is not another browser run. It is a typed API your own agents can call directly through HTTP, OpenAPI, MCP, an SDK, or a CLI.",
  }),
  scene({
    id: "showcase",
    start: 62,
    end: 72,
    kicker: "// showcase slot",
    title: "Drop the product showcase here.",
    body:
      "Place the final MP4 at public/assets/showcase/cairn-showcase.mp4 and this segment becomes the live walkthrough.",
    labels: ["reserved", "10 seconds", "drop-in MP4"],
    visual: "Branded placeholder panel until the final product showcase file is supplied.",
    narration:
      "This section is reserved for the actual product walkthrough. Drop in the showcase file and the explainer will use it without changing the story.",
    asset: {
      kind: "showcase-video",
      path: "assets/showcase/cairn-showcase.mp4",
    },
  }),
  scene({
    id: "reliability",
    start: 72,
    end: 82,
    kicker: "// durability",
    title: "Stable contract. Verified execution.",
    body:
      "Cairn verifies the workflow, watches for drift, repairs broken plans, and keeps the API contract stable for callers.",
    labels: ["verify", "health checks", "drift detection", "repair"],
    visual: "Health timeline moves from verified to drift detected to repaired.",
    narration:
      "Cairn verifies before activation, monitors health, detects drift, and repairs the underlying plan while keeping the caller's API contract stable.",
    asset: {
      kind: "stock-video",
      path: "assets/stock/server-room.mp4",
      credit: "Pexels video 1085656",
    },
  }),
  scene({
    id: "conclusion",
    start: 82,
    end: 90,
    kicker: "// conclusion",
    title: "Cairn turns browser work into your reusable API.",
    body:
      "Record once. Reuse forever. Private to your account. Built for agents that need reliable work, not repeated clicks.",
    labels: ["private API", "typed API", "durable", "agent-ready"],
    visual: "Final Cairn mark with one workflow flowing into one stable endpoint.",
    narration:
      "Cairn turns browser work into your reusable API. Record once. Reuse forever.",
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
