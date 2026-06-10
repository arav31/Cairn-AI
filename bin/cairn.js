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
  return `Cairn CLI

Usage:
  cairn catalog [--base-url URL]
  cairn account create --account ACCOUNT_ID [--base-url URL]
  cairn wallet --account ACCOUNT_ID [--base-url URL]
  cairn buy-tokens --pack starter --account ACCOUNT_ID [--base-url URL]
  cairn invoke --tool SLUG --account ACCOUNT_ID --input '{"zipCode":"78701"}' [--base-url URL]
  cairn readme --tool SLUG [--base-url URL]
  cairn guide [--tool SLUG] [--base-url URL]

Defaults:
  --base-url ${DEFAULT_BASE_URL}
  --account demo-user
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

  if (command === "catalog") {
    process.stdout.write(`${compact(await client.catalog())}\n`);
    return;
  }

  if (command === "account" && subcommand === "create") {
    process.stdout.write(`${compact(await client.createAccount(accountId))}\n`);
    return;
  }

  if (command === "wallet") {
    process.stdout.write(`${compact(await client.wallet(accountId))}\n`);
    return;
  }

  if (command === "buy-tokens") {
    const packId = readFlag(args, "pack", "starter");
    process.stdout.write(`${compact(await client.buyTokens(packId, accountId))}\n`);
    return;
  }

  if (command === "invoke") {
    const tool = readFlag(args, "tool");
    if (!tool) throw new Error("Missing --tool");
    const input = parseInput(readFlag(args, "input", "{}"));
    process.stdout.write(`${compact(await client.invoke(tool, {
      input,
      accountId,
      paymentMethod: "tokens"
    }))}\n`);
    return;
  }

  if (command === "readme") {
    const tool = readFlag(args, "tool");
    if (!tool) throw new Error("Missing --tool");
    process.stdout.write(`${await client.toolReadme(tool)}\n`);
    return;
  }

  if (command === "guide") {
    const tool = readFlag(args, "tool");
    process.stdout.write(`${compact(await client.integrationGuide(tool))}\n`);
    return;
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n\n${usage()}`);
  process.exit(1);
});
