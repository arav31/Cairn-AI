#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createDraftSkillFromRecording, inspectRecording, recordWorkflow } from "./recorder.js";
import { loadSkill, loadSkills, runSkill } from "./skill-runner.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "menu":
    case undefined:
      await menu();
      break;
    case "list":
      await listSkills();
      break;
    case "check-url":
      await checkUrl(args[0]);
      break;
    case "chat":
      await chat(args[0]);
      break;
    case "run":
      await run(args);
      break;
    case "record":
      await record(args);
      break;
    case "inspect-recording":
      await inspect(args);
      break;
    case "draft":
      await draft(args);
      break;
    case "promote-draft":
      await promoteDraftCommand(args[0]);
      break;
    default:
      printHelp();
      process.exit(1);
  }
}

async function menu() {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("API Skill Builder");
    console.log("Paste a website link to check whether a skill exists, run it, or start learning a new one.");

    while (true) {
      console.log("");
      console.log("1. Paste website link");
      console.log("2. Run saved skill");
      console.log("3. List saved skills");
      console.log("4. Inspect recording");
      console.log("5. Promote draft skill");
      console.log("6. Exit");
      const choice = (await rl.question("Choose: ")).trim();

      if (choice === "1") {
        await handleUrlFlow(rl);
      } else if (choice === "2") {
        await chooseAndRunSkill(rl);
      } else if (choice === "3") {
        await listSkills();
      } else if (choice === "4") {
        const file = await rl.question("Recording file path: ");
        const candidates = await inspectRecording(file.trim());
        printCandidates(candidates);
      } else if (choice === "5") {
        const file = await rl.question("Draft file path: ");
        await promoteDraftCommand(file.trim());
      } else if (choice === "6" || choice.toLowerCase() === "exit" || choice.toLowerCase() === "q") {
        break;
      } else {
        console.log("Unknown option.");
      }
    }
  } finally {
    rl.close();
  }
}

async function handleUrlFlow(rl) {
  const url = (await rl.question("Website link: ")).trim();
  if (!url) return;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.log("That does not look like a valid URL.");
    return;
  }

  progress(1, "Checking saved skills");
  const skills = await loadSkills();
  const matches = findSkillsForUrl(skills, parsed);

  if (matches.length) {
    progress(2, "Registered skill found");
    matches.forEach((skill, index) => {
      console.log(`${index + 1}. ${skill.id} - ${skill.name}`);
      console.log(`   source: ${skill.sourceUrl}`);
    });
    const answer = await rl.question("Run this skill now? [Y/n]: ");
    if (answer.trim().toLowerCase() === "n") return;
    const chosen = matches.length === 1 ? matches[0] : matches[Number(await rl.question("Skill number: ")) - 1];
    if (!chosen) {
      console.log("No skill selected.");
      return;
    }
    await runSkillChat(rl, chosen);
    return;
  }

  progress(2, "No registered skill found");
  console.log("");
  console.log("Learning flow:");
  console.log("1. Browser automation opens the link and captures network traffic.");
  console.log("2. Complete the obvious workflow until the final result appears.");
  console.log("3. The recorder ranks real endpoint candidates and ignores static/analytics noise.");
  console.log("4. A draft skill is generated from the best reusable endpoint, result URL, or browser replay.");
  console.log("5. Future runs ask the website-like questions and use the fastest saved strategy available.");
  console.log("");
  console.log("For arbitrary sites, the first learning pass may need manual review because some forms use encrypted payloads, captchas, auth, or anti-bot checks.");

  const start = await rl.question("Start browser learning now? [y/N]: ");
  if (start.trim().toLowerCase() !== "y") return;

  const name = (await rl.question(`Skill name [${parsed.hostname}]: `)).trim() || parsed.hostname;
  const goal = (await rl.question("Goal, e.g. get quote/search price [get quote]: ")).trim() || "get quote";

  progress(3, "Launching browser recorder");
  const { file, recording } = await recordWorkflow({
    url,
    name,
    goal,
    headless: false,
    waitForDone: () => rl.question("Press Enter when done..."),
  });
  progress(4, "Ranking endpoint candidates");
  console.log(`Saved recording: ${file}`);
  printCandidates(recording.candidates.slice(0, 10));

  console.log("");
  console.log("Auto-drafting the best usable strategy. Static assets and analytics requests are ignored.");
  progress(5, "Creating draft skill");
  const draftFile = await createDraftSkillFromRecording({ recordingFile: file, candidateIndex: undefined, name });
  console.log(`Draft skill created: ${draftFile}`);
  const promote = await rl.question("Register this draft now? [y/N]: ");
  if (promote.trim().toLowerCase() === "y") {
    await promoteDraftCommand(draftFile);
  } else {
    console.log("It stays as a draft. Use menu option 5 or promote-draft when it is ready.");
  }
}

async function listSkills() {
  const skills = await loadSkills();
  if (!skills.length) {
    console.log("No skills found in skills/.");
    return;
  }
  for (const skill of skills) {
    console.log(`${skill.id} - ${skill.name}`);
  }
}

async function checkUrl(url) {
  if (!url) throw new Error("Usage: node src/cli.js check-url <url>");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL.");
  }
  const skills = await loadSkills();
  const matches = findSkillsForUrl(skills, parsed);
  if (!matches.length) {
    console.log("No registered skill found.");
    return;
  }
  console.log("Registered skill found:");
  matches.forEach((skill, index) => {
    console.log(`${index + 1}. ${skill.id} - ${skill.name}`);
    console.log(`   source: ${skill.sourceUrl}`);
  });
}

async function chat(skillId) {
  const skills = await loadSkills();
  if (!skills.length) throw new Error("No skills found in skills/.");

  const rl = readline.createInterface({ input, output });
  try {
    let skill = skillId ? skills.find((item) => item.id === skillId) : null;
    if (!skill) {
      console.log("Available skills:");
      skills.forEach((item, index) => console.log(`${index + 1}. ${item.id} - ${item.name}`));
      const answer = await rl.question("Choose a skill number or id: ");
      const index = Number(answer) - 1;
      skill = skills[index] || skills.find((item) => item.id === answer.trim());
      if (!skill) throw new Error(`Unknown skill: ${answer}`);
    }

    await runSkillChat(rl, skill);
  } finally {
    rl.close();
  }
}

async function chooseAndRunSkill(rl) {
  const skills = await loadSkills();
  if (!skills.length) {
    console.log("No skills found in skills/.");
    return;
  }
  skills.forEach((skill, index) => console.log(`${index + 1}. ${skill.id} - ${skill.name}`));
  const answer = await rl.question("Choose skill number or id: ");
  const skill = skills[Number(answer) - 1] || skills.find((item) => item.id === answer.trim());
  if (!skill) {
    console.log("Unknown skill.");
    return;
  }
  await runSkillChat(rl, skill);
}

async function runSkillChat(rl, skill) {
  console.log(`\n${skill.name}`);
  if (skill.description) console.log(skill.description);
  console.log("");
  progress(1, "Collecting required inputs");

  const inputs = {};
  for (const spec of skill.inputs || []) {
    inputs[spec.id] = await askInput(rl, spec);
  }

  progress(2, "Calling saved API workflow");
  const result = await runSkill(skill, inputs);
  progress(3, "Done");
  printResult(result);
}

async function run(args) {
  const skillId = args[0];
  if (!skillId) throw new Error("Usage: node src/cli.js run <skill-id> --input '{...}' or --set key=value");
  const rawInputs = await parseRunInputs(args);
  const skill = await loadSkill(skillId);
  const result = await runSkill(skill, rawInputs);
  printResult(result);
}

async function record(args) {
  const url = args[0];
  if (!url) throw new Error("Usage: node src/cli.js record <url> --name <name> --goal <goal>");
  const name = option(args, "--name") || new URL(url).hostname;
  const goal = option(args, "--goal") || "";
  const headless = args.includes("--headless");
  const { file, recording } = await recordWorkflow({ url, name, goal, headless });
  console.log(`\nSaved recording: ${file}`);
  console.log("\nTop endpoint candidates:");
  printCandidates(recording.candidates.slice(0, 10));
  console.log(`\nCreate a draft skill with: node src/cli.js draft ${file} 0 --name ${name}`);
}

async function inspect(args) {
  const file = args[0];
  if (!file) throw new Error("Usage: node src/cli.js inspect-recording <recording-file>");
  const candidates = await inspectRecording(file);
  printCandidates(candidates);
}

async function draft(args) {
  const recordingFile = args[0];
  const candidateIndex = Number(args[1] || 0);
  const name = option(args, "--name");
  if (!recordingFile) throw new Error("Usage: node src/cli.js draft <recording-file> [candidate-index] --name <name>");
  const file = await createDraftSkillFromRecording({ recordingFile, candidateIndex, name });
  console.log(`Created draft skill: ${file}`);
}

async function promoteDraftCommand(file) {
  if (!file) throw new Error("Usage: node src/cli.js promote-draft <skills/name.draft.json>");
  if (!file.endsWith(".draft.json")) {
    throw new Error("Draft file must end with .draft.json");
  }
  const target = file.replace(/\.draft\.json$/, ".json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(file, target);
  console.log(`Registered skill: ${target}`);
}

async function askInput(rl, spec) {
  if (spec.description) console.log(spec.description);
  const normalizedChoices = normalizeChoices(spec.choices || []);
  const printChoices = normalizedChoices.length > 0 && normalizedChoices.length <= 25;
  if (printChoices) {
    normalizedChoices.forEach((choice, index) => {
      console.log(`  ${index + 1}. ${choice.label}`);
    });
  } else if (normalizedChoices.length) {
    const examples = normalizedChoices.slice(0, 5).map((choice) => choice.label).join(", ");
    console.log(`${normalizedChoices.length} choices available. Type names or values; use commas for multiple. Examples: ${examples}.`);
  }
  const choices = !normalizedChoices.length && spec.choices?.length ? ` (${spec.choices.join("/")})` : "";
  const defaultText = formatDefaultText(spec.default, normalizedChoices);
  while (true) {
    const suffix = spec.type === "multi-choice" && normalizedChoices.length
      ? ` (comma-separated ${printChoices ? "numbers/names" : "names or values"})`
      : "";
    const answer = await rl.question(`${spec.question}${choices}${suffix}${defaultText}: `);
    const value = answer === "" ? spec.default : answer;
    if ((value === undefined || value === "") && spec.optional) return undefined;
    if (value === undefined || value === "") {
      console.log("This field is required.");
      continue;
    }
    if (spec.type === "json") {
      try {
        return JSON.parse(value);
      } catch {
        console.log("Enter valid JSON.");
        continue;
      }
    }
    if (spec.type === "file") {
      const resolvedFile = await resolveFileInput(value);
      if (!resolvedFile) {
        console.log("Enter a valid local file path.");
        continue;
      }
      return resolvedFile;
    }
    if (spec.type === "multi-choice") {
      const resolved = resolveMultiChoice(value, normalizedChoices);
      if (!resolved) {
        console.log("Choose one or more valid options.");
        continue;
      }
      return resolved;
    }
    if (normalizedChoices.length) {
      const resolved = resolveChoice(value, normalizedChoices);
      if (resolved === undefined) {
        console.log("Choose a valid option.");
        continue;
      }
      if (spec.type === "number") return Number(resolved);
      return resolved;
    }
    if (spec.choices?.length && value && !spec.choices.includes(value)) {
      console.log(`Choose one of: ${spec.choices.join(", ")}`);
      continue;
    }
    if (spec.type === "number") return Number(value);
    return value;
  }
}

async function resolveFileInput(value) {
  const trimmed = String(value).trim();
  if (/^[{\[]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  const filePath = path.resolve(trimmed.replace(/^["']|["']$/g, ""));
  const stat = await fs.stat(filePath).catch(() => null);
  return stat?.isFile() ? filePath : null;
}

function normalizeChoices(choices) {
  return choices.map((choice) => {
    if (choice && typeof choice === "object") {
      return {
        label: String(choice.label ?? choice.value),
        value: choice.value ?? choice.label,
      };
    }
    return { label: String(choice), value: choice };
  });
}

function resolveChoice(value, choices) {
  const trimmed = String(value).trim();
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1].value;
  }
  const found = choices.find((choice) => {
    const label = choice.label.toLowerCase();
    const choiceValue = String(choice.value).toLowerCase();
    const query = trimmed.toLowerCase();
    return label === query || choiceValue === query;
  });
  return found?.value;
}

function resolveMultiChoice(value, choices) {
  const parts = (Array.isArray(value) ? value : String(value).split(",")).map((part) => String(part).trim()).filter(Boolean);
  if (!parts.length) return null;
  const resolved = [];
  for (const part of parts) {
    const choice = resolveChoice(part, choices);
    if (choice === undefined) return null;
    resolved.push(choice);
  }
  return resolved;
}

function formatDefaultText(defaultValue, choices) {
  if (defaultValue === undefined || defaultValue === "") return "";
  const values = Array.isArray(defaultValue) ? defaultValue : [defaultValue];
  const labels = values.map((value) => {
    const match = choices.find((choice) => String(choice.value) === String(value));
    return match?.label || value;
  });
  return ` [${labels.join(", ")}]`;
}

function printResult(result) {
  console.log("\nEndpoint timings:");
  for (const response of Object.values(result.responses)) {
    const execution = response.request.execution ? `, ${response.request.execution}` : "";
    console.log(`- ${response.id}: ${response.status}, ${response.ms}ms${execution}`);
  }
  console.log("\nSummary:");
  console.log(JSON.stringify(result.summary, null, 2));
}

function findSkillsForUrl(skills, targetUrl) {
  return skills
    .map((skill) => ({ skill, score: urlMatchScore(skill.sourceUrl, targetUrl) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.skill);
}

function urlMatchScore(sourceUrl, targetUrl) {
  if (!sourceUrl) return 0;
  let source;
  try {
    source = new URL(sourceUrl);
  } catch {
    return 0;
  }
  if (source.href === targetUrl.href) return 100;
  if (source.origin !== targetUrl.origin) return 0;
  if (source.pathname === targetUrl.pathname) return 80;
  if (targetUrl.pathname.startsWith(source.pathname) || source.pathname.startsWith(targetUrl.pathname)) return 60;
  return 30;
}

function printCandidates(candidates) {
  if (!candidates.length) {
    console.log("No endpoint candidates found.");
    return;
  }
  candidates.forEach((candidate, index) => {
    const method = candidate.method || "UNKNOWN";
    const status = candidate.status || "";
    const duration = candidate.durationMs === undefined ? "?" : candidate.durationMs;
    const url = candidate.url || "(no url)";
    console.log(`${index}. score=${candidate.score} ${method} ${status} ${duration}ms ${url}`);
    if (candidate.postDataPreview) {
      console.log(`   body: ${candidate.postDataPreview.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  });
}

function progress(step, label) {
  const total = 5;
  const filled = Math.min(total, Math.max(0, step));
  const bar = `${"#".repeat(filled)}${"-".repeat(total - filled)}`;
  console.log(`[${bar}] ${Math.round((filled / total) * 100)}% ${label}`);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function parseRunInputs(args) {
  const inputIndex = args.indexOf("--input");
  if (inputIndex >= 0) return JSON.parse(args[inputIndex + 1] || "{}");

  const inputFileIndex = args.indexOf("--input-file");
  if (inputFileIndex >= 0) {
    return JSON.parse(await fs.readFile(args[inputFileIndex + 1], "utf8"));
  }

  const inputs = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--set") continue;
    const pair = args[index + 1] || "";
    const separator = pair.indexOf("=");
    if (separator === -1) throw new Error(`Expected --set key=value, got: ${pair}`);
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    inputs[key] = parseScalar(value);
  }
  return inputs;
}

function parseScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  node src/cli.js menu
  node src/cli.js list
  node src/cli.js check-url <url>
  node src/cli.js chat [skill-id]
  node src/cli.js run <skill-id> --input '{"key":"value"}'
  node src/cli.js run <skill-id> --set key=value --set other=value
  node src/cli.js record <url> --name <name> --goal <goal>
  node src/cli.js inspect-recording <recording-file>
  node src/cli.js draft <recording-file> [candidate-index] --name <name>
  node src/cli.js promote-draft <skills/name.draft.json>`);
}

main().catch((error) => {
  console.error(error.message);
  if (error.response?.text) console.error(error.response.text.slice(0, 1000));
  process.exit(1);
});
