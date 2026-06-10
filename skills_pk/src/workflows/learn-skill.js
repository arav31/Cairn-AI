#!/usr/bin/env node
import { createAgent, observe } from "@flue/runtime";
import { pathToFileURL } from "node:url";
import { createDraftSkillWithLearningWorkflow } from "../learning-workflow.js";

export const learnerAgent = createAgent(() => ({
  model: false,
  instructions: [
    "API Skill Builder learning workflow.",
    "The browser/CDP recorder captures traffic and interactions.",
    "Playwright evidence captures visible controls and accessibility metadata.",
    "The configured LLM provider interprets the evidence before a draft skill is promoted.",
  ].join(" "),
}));

export const workflow = {
  name: "learn-skill",
  description: "Create a draft API skill from a recorded browser workflow.",
  inputs: {
    recordingFile: "Path to a recordings/*.json file",
    candidateIndex: "Optional endpoint candidate index",
    name: "Optional skill name override",
  },
};

observe((event) => {
  if (process.env.SKILL_BUILDER_FLUE_DEBUG !== "1") return;
  const type = event?.type || "event";
  const runId = event?.runId || event?.instanceId || "";
  console.error(`[flue] ${type}${runId ? ` ${runId}` : ""}`);
});

export async function run(ctx = {}) {
  const payload = ctx.payload || ctx;
  if (ctx.init) await ctx.init(learnerAgent);

  return createDraftSkillWithLearningWorkflow({
    recordingFile: payload.recordingFile,
    candidateIndex: Number.isInteger(payload.candidateIndex) ? payload.candidateIndex : undefined,
    name: payload.name,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const recordingFile = args[0];
  const candidateIndexRaw = args.slice(1).find((arg, index, all) => {
    if (arg.startsWith("--")) return false;
    return all[index - 1] !== "--name";
  });
  const name = option(args, "--name");
  const candidateIndex = candidateIndexRaw === undefined ? undefined : Number(candidateIndexRaw);
  run({
    recordingFile,
    candidateIndex: Number.isInteger(candidateIndex) ? candidateIndex : undefined,
    name,
  })
    .then((result) => {
      console.log(JSON.stringify({
        draftFile: result.draftFile,
        stageCount: result.stages.length,
        topCandidate: result.candidates?.[0] || null,
      }, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
