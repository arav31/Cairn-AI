const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEnv } = require("../src/cairn/env");

test("env parser supports comments, quotes, exports, and escaped newlines", () => {
  const parsed = parseEnv(`
    # comment
    PORT=3005
    export HOST=0.0.0.0
    CAIRN_PUBLIC_URL="https://api.example.com"
    STRIPE_SECRET_KEY='sk_test_value'
    MULTILINE="hello\\nworld"
    INLINE=value # local note
    BAD KEY=ignored
  `);

  assert.deepEqual(parsed, {
    PORT: "3005",
    HOST: "0.0.0.0",
    CAIRN_PUBLIC_URL: "https://api.example.com",
    STRIPE_SECRET_KEY: "sk_test_value",
    MULTILINE: "hello\nworld",
    INLINE: "value"
  });
});
