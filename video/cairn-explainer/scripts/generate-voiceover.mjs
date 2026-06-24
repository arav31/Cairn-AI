import {execFileSync} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(projectRoot, "../..");
const configPath = path.join(projectRoot, "voiceover", "elevenlabs.json");
const cuesPath = path.join(projectRoot, "voiceover", "cues.json");
const envPath = path.join(repoRoot, ".env");
const publicRoot = path.join(projectRoot, "public");
const workDir = path.join(projectRoot, "out", "voiceover-work");

const force = process.argv.includes("--force");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const cues = JSON.parse(readFileSync(cuesPath, "utf8"));

loadEnv(envPath);

const apiKey = process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is missing. Add it to the ignored root .env file.");
}

const sceneOutputDir = path.join(projectRoot, config.sceneOutputDir);
const timelineOutput = path.join(projectRoot, config.timelineOutput);
const metadataOutput = path.join(path.dirname(timelineOutput), "metadata.json");

mkdirSync(sceneOutputDir, {recursive: true});
mkdirSync(path.dirname(timelineOutput), {recursive: true});
mkdirSync(workDir, {recursive: true});

for (const cue of cues) {
  const sceneAudio = path.join(sceneOutputDir, `${cue.sceneId}.mp3`);
  if (!force && existsSync(sceneAudio)) {
    console.log(`voiceover: keeping ${path.relative(projectRoot, sceneAudio)}`);
    continue;
  }

  console.log(`voiceover: generating ${cue.sceneId}`);
  const text = cue.ttsText ?? cue.narration;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}?output_format=${config.outputFormat}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.modelId,
        voice_settings: config.voiceSettings,
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `ElevenLabs failed for ${cue.sceneId}: ${response.status} ${details}`,
    );
  }

  writeFileSync(sceneAudio, Buffer.from(await response.arrayBuffer()));
}

const preparedScenes = cues.map((cue) => {
  const source = path.join(sceneOutputDir, `${cue.sceneId}.mp3`);
  if (!existsSync(source)) {
    throw new Error(`Missing generated clip: ${source}`);
  }

  const sourceDuration = getDurationSeconds(source);
  const maxDuration = Math.max(0.5, cue.end - cue.start - 0.18);
  const speed = sourceDuration > maxDuration ? sourceDuration / maxDuration : 1;
  const prepared = path.join(workDir, `${cue.sceneId}.wav`);
  const filters = [`aresample=48000`, `atrim=0:${sourceDuration.toFixed(3)}`];

  if (speed > 1.01) {
    filters.push(...atempoFilters(speed));
  }

  filters.push("asetpts=N/SR/TB");

  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-af",
      filters.join(","),
      "-ar",
      "48000",
      "-ac",
      "2",
      prepared,
    ],
    {stdio: "inherit"},
  );

  return {
    ...cue,
    source: path.relative(projectRoot, source),
    prepared,
    sourceDuration,
    preparedDuration: getDurationSeconds(prepared),
    speed,
  };
});

mixTimeline(preparedScenes, timelineOutput, config.timelineSeconds);

writeFileSync(
  metadataOutput,
  JSON.stringify(
    {
      provider: config.provider,
      voiceId: config.voiceId,
      voiceName: config.voiceName,
      modelId: config.modelId,
      outputFormat: config.outputFormat,
      timelineOutput: path.relative(projectRoot, timelineOutput),
      timelineDuration: getDurationSeconds(timelineOutput),
      generatedAt: new Date().toISOString(),
      scenes: preparedScenes.map((scene) => ({
        sceneId: scene.sceneId,
        start: scene.start,
        end: scene.end,
        source: scene.source,
        sourceDuration: round(scene.sourceDuration),
        preparedDuration: round(scene.preparedDuration),
        speed: round(scene.speed),
        usesExpressiveText: Boolean(scene.ttsText),
      })),
    },
    null,
    2,
  ),
);

rmSync(workDir, {recursive: true, force: true});

console.log(`voiceover: wrote ${path.relative(projectRoot, timelineOutput)}`);
console.log(`voiceover: wrote ${path.relative(projectRoot, metadataOutput)}`);

function loadEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getDurationSeconds(filePath) {
  const output = execFileSync(
    "ffprobe",
    [
      "-hide_banner",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    {encoding: "utf8"},
  ).trim();

  const duration = Number(output);
  if (!Number.isFinite(duration)) {
    throw new Error(`Unable to read duration for ${filePath}`);
  }

  return duration;
}

function atempoFilters(speed) {
  const filters = [];
  let remaining = speed;

  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }

  filters.push(`atempo=${remaining.toFixed(5)}`);
  return filters;
}

function mixTimeline(scenes, output, durationSeconds) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  const filterParts = [];
  const streamLabels = [];

  for (const scene of scenes) {
    args.push("-i", scene.prepared);
  }

  scenes.forEach((scene, index) => {
    const delay = Math.round(scene.start * 1000);
    const label = `s${index}`;
    filterParts.push(
      `[${index}:a]adelay=${delay}|${delay},apad,atrim=0:${durationSeconds}[${label}]`,
    );
    streamLabels.push(`[${label}]`);
  });

  filterParts.push(
    `${streamLabels.join("")}amix=inputs=${scenes.length}:duration=longest:dropout_transition=0,loudnorm=I=-16:LRA=11:TP=-1.5,atrim=0:${durationSeconds},asetpts=N/SR/TB[out]`,
  );

  execFileSync(
    "ffmpeg",
    [
      ...args,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[out]",
      "-ar",
      "48000",
      "-ac",
      "2",
      output,
    ],
    {stdio: "inherit"},
  );
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
