import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, it} from "node:test";

import {
  BANNED_POSITIONING_PATTERNS,
  COMPOSITION,
  VOICEOVER_AUDIO_PATH,
  scenes,
  voiceoverCues,
} from "../src/storyboard";

type VoiceoverMetadataScene = {
  sceneId: string;
  start: number;
  end: number;
  preparedDuration: number;
  speed: number;
};

type VoiceoverMetadata = {
  timelineDuration: number;
  scenes: VoiceoverMetadataScene[];
};

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const generationCues = JSON.parse(
  readFileSync(new URL("../voiceover/cues.json", import.meta.url), "utf8"),
);
const elevenLabsConfig = JSON.parse(
  readFileSync(new URL("../voiceover/elevenlabs.json", import.meta.url), "utf8"),
);
const voiceoverMetadata = JSON.parse(
  readFileSync(
    new URL("../public/assets/voiceover/cairn-explainer/metadata.json", import.meta.url),
    "utf8",
  ),
) as VoiceoverMetadata;

const textFromScenes = scenes
  .flatMap((scene) => [
    scene.id,
    scene.title,
    scene.kicker,
    scene.body,
    ...scene.labels,
    scene.visual,
  ])
  .join("\n");

describe("Cairn explainer storyboard", () => {
  it("runs exactly 108 seconds at 30fps", () => {
    assert.equal(COMPOSITION.fps, 30);
    assert.equal(COMPOSITION.width, 1920);
    assert.equal(COMPOSITION.height, 1080);
    assert.equal(COMPOSITION.durationInFrames, 3240);
    assert.equal(scenes[0]?.start, 0);
    assert.equal(scenes.at(-1)?.end, 108);
  });

  it("keeps scenes contiguous and ordered", () => {
    scenes.forEach((scene, index) => {
      assert.ok(scene.end > scene.start, `${scene.id} has positive duration`);
      assert.equal(
        scene.startFrame,
        scene.start * COMPOSITION.fps,
        `${scene.id} startFrame matches seconds`,
      );
      assert.equal(
        scene.durationInFrames,
        (scene.end - scene.start) * COMPOSITION.fps,
        `${scene.id} duration matches seconds`,
      );
      if (index > 0) {
        assert.equal(scene.start, scenes[index - 1].end, `${scene.id} is contiguous`);
      }
    });
  });

  it("centers the problem on repeated browser-agent overhead", () => {
    assert.match(textFromScenes, /browser agents/i);
    assert.match(textFromScenes, /screenshots/i);
    assert.match(textFromScenes, /planning/i);
    assert.match(textFromScenes, /waits/i);
    assert.match(textFromScenes, /retries/i);
    assert.match(textFromScenes, /UI drift/i);
  });

  it("uses the real product walkthrough as the showcase segment", () => {
    const showcase = scenes.find((scene) => scene.id === "showcase");
    assert.ok(showcase, "showcase scene exists");
    assert.equal(showcase.start, 55);
    assert.equal(showcase.end, 77);
    assert.equal(showcase.asset?.kind, "showcase-video");
    assert.equal(showcase.asset?.path, "assets/showcase/cairn-showcase.mp4");
    assert.match(showcase.title, /API surface/i);
    assert.match(showcase.body, /structured input/i);
  });

  it("uses stock videos instead of stock still images", () => {
    const stockAssets = scenes
      .map((scene) => scene.asset)
      .filter((asset) => asset?.kind === "stock-video");

    assert.ok(stockAssets.length >= 4, "at least four stock video textures");
    for (const asset of stockAssets) {
      assert.equal(asset?.kind, "stock-video");
      assert.match(asset.path, /\.mp4$/);
    }

    assert.equal(
      scenes.some((scene) => String(scene.asset?.kind) === ["stock", "image"].join("-")),
      false,
      "no stock still image assets",
    );
  });

  it("keeps the new private reusable API positioning", () => {
    assert.match(textFromScenes, /private API/i);
    assert.match(textFromScenes, /typed API/i);
    assert.match(textFromScenes, /Record once\. Reuse forever\./i);
    for (const pattern of BANNED_POSITIONING_PATTERNS) {
      assert.doesNotMatch(textFromScenes, pattern);
    }
  });

  it("ships voiceover cues aligned to scene timing", () => {
    assert.equal(voiceoverCues.length, scenes.length);
    assert.equal(generationCues.length, scenes.length);
    for (const cue of voiceoverCues) {
      const scene = scenes.find((item) => item.id === cue.sceneId);
      assert.ok(scene, `cue ${cue.sceneId} has a scene`);
      assert.equal(cue.start, scene.start);
      assert.equal(cue.end, scene.end);
      assert.ok(cue.narration.length > 24, `${cue.sceneId} narration is usable`);
    }

    for (const cue of generationCues) {
      const scene = scenes.find((item) => item.id === cue.sceneId);
      assert.ok(scene, `generation cue ${cue.sceneId} has a scene`);
      assert.equal(cue.start, scene.start);
      assert.equal(cue.end, scene.end);
      assert.equal(cue.narration, scene.narration);
    }
  });

  it("uses expressive ElevenLabs cues without polluting the clean script", () => {
    assert.equal(elevenLabsConfig.modelId, "eleven_v3");
    assert.equal(elevenLabsConfig.timelineSeconds, 108);
    assert.match(elevenLabsConfig.voiceName, /Bright, Warm/);
    assert.ok(elevenLabsConfig.voiceSettings.style >= 0.7);
    assert.ok(elevenLabsConfig.voiceSettings.stability < 0.5);

    for (const cue of generationCues) {
      assert.doesNotMatch(cue.narration, /\[[^\]]+\]/);
      assert.match(cue.ttsText, /\[[^\]]+\]/);
      assert.ok(cue.ttsText.includes(cue.narration.slice(0, 24)));
    }
  });

  it("keeps generated voiceover pacing tight without harsh compression", () => {
    assert.equal(voiceoverMetadata.timelineDuration, 108);
    for (const scene of voiceoverMetadata.scenes) {
      assert.ok(scene.speed <= 1.1, `${scene.sceneId} speed is ${scene.speed}`);
    }

    const firstMinuteScenes = voiceoverMetadata.scenes.filter((scene) => scene.end <= 55);
    const spokenSeconds = firstMinuteScenes.reduce(
      (total, scene) => total + scene.preparedDuration,
      0,
    );

    assert.ok(spokenSeconds / 55 > 0.65, "first minute avoids long empty gaps");
  });

  it("keeps separate silent and voiced render commands", () => {
    assert.equal(
      VOICEOVER_AUDIO_PATH,
      "assets/voiceover/cairn-explainer/cairn-explainer-voiceover.wav",
    );
    assert.match(packageJson.scripts["generate-voiceover"], /generate-voiceover/);
    assert.match(packageJson.scripts.render, /--muted/);
    assert.doesNotMatch(packageJson.scripts["render:voiceover"], /--muted/);
    assert.match(
      packageJson.scripts["render:voiceover"],
      /cairn-reusable-api-explainer-voiceover\.mp4/,
    );
  });
});
