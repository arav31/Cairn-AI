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

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

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
  it("runs exactly 90 seconds at 30fps", () => {
    assert.equal(COMPOSITION.fps, 30);
    assert.equal(COMPOSITION.width, 1920);
    assert.equal(COMPOSITION.height, 1080);
    assert.equal(COMPOSITION.durationInFrames, 2700);
    assert.equal(scenes[0]?.start, 0);
    assert.equal(scenes.at(-1)?.end, 90);
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

  it("centers the problem on clunky, token-heavy browser agents", () => {
    assert.match(textFromScenes, /browser agents/i);
    assert.match(textFromScenes, /token-heavy/i);
    assert.match(textFromScenes, /slow/i);
    assert.match(textFromScenes, /brittle/i);
    assert.match(textFromScenes, /hard to audit/i);
    assert.match(textFromScenes, /wrong production interface/i);
  });

  it("reserves a future showcase mp4 drop-in segment", () => {
    const showcase = scenes.find((scene) => scene.id === "showcase");
    assert.ok(showcase, "showcase scene exists");
    assert.equal(showcase.start, 62);
    assert.equal(showcase.end, 72);
    assert.equal(showcase.asset?.kind, "showcase-video");
    assert.equal(showcase.asset?.path, "assets/showcase/cairn-showcase.mp4");
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
    for (const cue of voiceoverCues) {
      const scene = scenes.find((item) => item.id === cue.sceneId);
      assert.ok(scene, `cue ${cue.sceneId} has a scene`);
      assert.equal(cue.start, scene.start);
      assert.equal(cue.end, scene.end);
      assert.ok(cue.narration.length > 24, `${cue.sceneId} narration is usable`);
    }
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
