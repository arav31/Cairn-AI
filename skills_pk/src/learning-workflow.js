import { inspectRecording, createDraftSkillFromRecording } from "./recorder.js";

export function createLearningRun({ mode, sourceUrl = "", recordingFile = "" } = {}) {
  const startedAt = new Date().toISOString();
  const stages = [];

  return {
    mode,
    sourceUrl,
    recordingFile,
    startedAt,
    stages,
    stage(id, label, details = {}) {
      const entry = {
        id,
        label,
        at: new Date().toISOString(),
        details,
      };
      stages.push(entry);
      return entry;
    },
    finish(details = {}) {
      return {
        mode,
        sourceUrl,
        recordingFile,
        startedAt,
        finishedAt: new Date().toISOString(),
        stages,
        ...details,
      };
    },
  };
}

export async function createDraftSkillWithLearningWorkflow({
  recordingFile,
  candidateIndex,
  name,
  onStage,
} = {}) {
  if (!recordingFile) throw new Error("recordingFile is required");

  const run = createLearningRun({
    mode: "draft-from-recording",
    recordingFile,
  });
  const emit = (id, label, details = {}) => {
    const stage = run.stage(id, label, details);
    onStage?.(stage);
    return stage;
  };

  emit("rank_candidates", "Ranking captured endpoint candidates");
  const candidates = await inspectRecording(recordingFile);

  emit("draft_strategy", "Selecting API, result URL, or browser replay strategy", {
    candidateCount: candidates.length,
    candidateIndex: Number.isInteger(candidateIndex) ? candidateIndex : null,
  });
  const draftFile = await createDraftSkillFromRecording({
    recordingFile,
    candidateIndex,
    name,
  });

  emit("draft_written", "Draft skill written", {
    draftFile,
  });

  return run.finish({
    draftFile,
    candidates,
  });
}
