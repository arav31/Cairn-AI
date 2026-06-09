const test = require("node:test");
const assert = require("node:assert/strict");
const { createState } = require("../src/cairn/pipeline");
const {
  bootstrapMarketplace,
  createCheckout,
  createQuote,
  findListing,
  hasPaymentAuthorization,
  openApiDocument,
  publicTool
} = require("../src/cairn/marketplace");
const {
  createTokenCheckout,
  createTokenQuote,
  ensureWallet,
  previewTokenDebit,
  spendTokens
} = require("../src/cairn/tokens");

test("marketplace bootstraps verified workflow API listings", async () => {
  const state = createState();
  await bootstrapMarketplace(state);

  const insurance = findListing(state, "insurance/compare-insurance-prices");
  const property = findListing(state, "searchProperties");

  assert.equal(Object.keys(state.marketplaceListings).length, 2);
  assert.equal(insurance.pricing.enabled, true);
  assert.equal(insurance.pricing.acceptsSharedPaymentToken, true);
  assert.equal(insurance.pricing.tokenCost, 1);
  assert.equal(property.category, "Real estate");
  assert.match(insurance.readme, /Pay and run/);

  const tool = publicTool(insurance, state.operations[insurance.operationId]);
  assert.equal(tool.endpoints.invoke, "/api/tools/insurance/compare-insurance-prices/invoke");
  assert.equal(tool.tokenCost, 1);
  assert.equal(tool.endpoints.readme, "/api/tools/insurance/compare-insurance-prices/readme.md");

  const openapi = openApiDocument([insurance], state);
  assert.equal(openapi.openapi, "3.1.0");
  assert.ok(openapi.paths["/api/tools/insurance/compare-insurance-prices/invoke"]);
});

test("token wallet can buy a pack and spend tokens across marketplace skills", async () => {
  const state = createState();
  await bootstrapMarketplace(state);
  const listing = findListing(state, "insurance/compare-insurance-prices");
  const accountId = "token-test-user";
  const emptyWallet = ensureWallet(state, accountId);

  assert.equal(emptyWallet.balance, 0);
  assert.equal(previewTokenDebit(state, accountId, listing).ok, false);

  const quote = createTokenQuote("starter", accountId);
  const checkout = await createTokenCheckout(state, quote, {
    accountId,
    agent: "test-agent"
  });

  assert.equal(checkout.status, "test_authorized");
  assert.equal(checkout.wallet.balance, 250);

  const debit = spendTokens(state, accountId, listing, {
    invocationId: "inv_test"
  });

  assert.equal(debit.ok, true);
  assert.equal(debit.tokenCost, listing.pricing.tokenCost);
  assert.equal(debit.wallet.balance, 249);
});

test("marketplace payment gate accepts checkout authorization", async () => {
  const state = createState();
  await bootstrapMarketplace(state);
  const listing = findListing(state, "insurance/compare-insurance-prices");

  assert.equal(hasPaymentAuthorization(listing, { input: listing.sampleInput }), false);

  const quote = createQuote(listing, listing.sampleInput);
  const checkout = await createCheckout(listing, quote, {
    agent: "test-agent",
    sharedPaymentToken: "spt_test"
  });

  assert.equal(quote.total, listing.pricing.priceCents);
  assert.equal(checkout.payment.status, "authorized");
  assert.equal(hasPaymentAuthorization(listing, { payment: checkout.payment }), true);
});
