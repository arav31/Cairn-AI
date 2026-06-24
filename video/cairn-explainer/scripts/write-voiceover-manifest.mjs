import {existsSync, writeFileSync} from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const audioPath = "assets/voiceover/cairn-explainer/cairn-explainer-voiceover.wav";
const audioFile = path.join(projectRoot, "public", audioPath);
const manifestPath = path.join(projectRoot, "src", "voiceoverManifest.ts");
const available = existsSync(audioFile);

writeFileSync(
  manifestPath,
  `export const voiceoverAudioAvailable = ${available};\n`,
);

console.log(
  available
    ? "voiceover manifest: using ElevenLabs narration"
    : "voiceover manifest: no narration audio found",
);
