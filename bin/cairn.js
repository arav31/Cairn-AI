#!/usr/bin/env node

const { CairnClient, DEFAULT_BASE_URL } = require("../src/sdk/client");

function readFlag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

function compact(value) {
  return JSON.stringify(value, null, 2);
}

function parseInput(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`--input must be valid JSON: ${error.message}`);
  }
}

function usage() {
  return `Cairn CLI — your private, reusable workflow APIs

Usage:
  cairn account create --account ACCOUNT_ID [--base-url URL]
  cairn login --account ACCOUNT_ID [--base-url URL]
  cairn apis [--base-url URL]
  cairn record --title "..." --url https://... --goal "..." [--base-url URL]
  cairn call --api SLUG --input '{"zipCode":"78701"}' [--base-url URL]
  cairn readme --api SLUG [--base-url URL]
  cairn openapi --api SLUG [--base-url URL]
  cairn mcp list [--base-url URL]
  cairn mcp call --api OPERATION_NAME --input '{...}' [--base-url URL]

Defaults:
  --base-url ${DEFAULT_BASE_URL}
  --account demo-user
  CAIRN_AGENT_KEY is sent as the bearer key. Every API is private to your account.
`;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];
  const baseUrl = readFlag(args, "base-url", process.env.CAIRN_BASE_URL || DEFAULT_BASE_URL);
  const accountId = readFlag(args, "account", process.env.CAIRN_ACCOUNT_ID || "demo-user");
  const client = new CairnClient({ baseUrl, accountId });

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }

  if ((command === "account" && subcommand === "create") || command === "login") {
    process.stdout.write(`${compact(await client.createAccount(accountId))}\n`);
    return;
  }

  if (command === "apis") {
    process.stdout.write(`${compact(await client.listApis())}\n`);
    return;
  }

  if (command === "record") {
    const result = await client.recordWorkflow({
      title: readFlag(args, "title") || "Untitled workflow",
      targetUrl: readFlag(args, "url"),
      goal: readFlag(args, "goal") || ""
    });
    process.stdout.write(`${compact(result)}\n`);
    return;
  }

  if (command === "call") {
    const api = readFlag(args, "api");
    if (!api) throw new Error("Missing --api");
    const input = parseInput(readFlag(args, "input", "{}"));
    process.stdout.write(`${compact(await client.invoke(api, { input, accountId }))}\n`);
    return;
  }

  if (command === "readme") {
    const api = readFlag(args, "api");
    if (!api) throw new Error("Missing --api");
    process.stdout.write(`${await client.apiReadme(api)}\n`);
    return;
  }

  if (command === "openapi") {
    const api = readFlag(args, "api");
    if (!api) throw new Error("Missing --api");
    process.stdout.write(`${compact(await client.apiOpenApi(api))}\n`);
    return;
  }

  if (command === "mcp" && subcommand === "list") {
    process.stdout.write(`${compact(await client.mcpToolList())}\n`);
    return;
  }

  if (command === "mcp" && subcommand === "call") {
    const api = readFlag(args, "api");
    if (!api) throw new Error("Missing --api (the MCP tool / operation name)");
    const input = parseInput(readFlag(args, "input", "{}"));
    process.stdout.write(`${compact(await client.mcpCall(api, input, { accountId }))}\n`);
    return;
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n\n${usage()}`);
  process.exit(1);
});
