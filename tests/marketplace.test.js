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
  const business = findListing(state, "business/check-business-renewals");

  assert.equal(Object.keys(state.marketplaceListings).length, 3);
  assert.equal(insurance.pricing.enabled, true);
  assert.equal(insurance.pricing.acceptsSharedPaymentToken, true);
  assert.equal(insurance.pricing.tokenCost, 1);
  assert.equal(property.category, "Real estate");
  assert.equal(business.pricing.tokenCost, 2);
  assert.equal(business.operationName, "checkBusinessRenewals");
  assert.match(insurance.readme, /Pay and run/);

  const tool = publicTool(insurance, state.operations[insurance.operationId]);
  assert.equal(tool.endpoints.invoke, "/api/tools/insurance/compare-insurance-prices/invoke");
  assert.equal(tool.tokenCost, 1);
  assert.equal(tool.endpoints.readme, "/api/tools/insurance/compare-insurance-prices/readme.md");
  assert.equal(tool.endpoints.verification, "/api/tools/insurance/compare-insurance-prices/verification");

  const openapi = openApiDocument([insurance], state);
  assert.equal(openapi.openapi, "3.1.0");
  assert.ok(openapi.paths["/api/tools/insurance/compare-insurance-prices/invoke"]);
});

test("marketplace seed APIs use stable operation ids for database upserts", async () => {
  const firstState = createState();
  const secondState = createState();
  await bootstrapMarketplace(firstState);
  await bootstrapMarketplace(secondState);

  const firstInsurance = findListing(firstState, "insurance/compare-insurance-prices");
  const secondInsurance = findListing(secondState, "insurance/compare-insurance-prices");
  const firstProperty = findListing(firstState, "real-estate/search-properties");
  const secondProperty = findListing(secondState, "real-estate/search-properties");

  assert.equal(firstInsurance.operationId, secondInsurance.operationId);
  assert.equal(firstProperty.operationId, secondProperty.operationId);
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

test("stripe token checkout carries selected pack metadata", async (t) => {
  const originalFetch = global.fetch;
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalPublicUrl = process.env.CAIRN_PUBLIC_URL;
  let stripeBody = "";
  t.after(() => {
    global.fetch = originalFetch;
    if (originalSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecretKey;
    }
    if (originalPublicUrl === undefined) {
      delete process.env.CAIRN_PUBLIC_URL;
    } else {
      process.env.CAIRN_PUBLIC_URL = originalPublicUrl;
    }
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_cairn";
  process.env.CAIRN_PUBLIC_URL = "https://cairn.example";
  global.fetch = async (url, init) => {
    stripeBody = String(init.body);
    return new Response(JSON.stringify({
      id: "cs_test_builder",
      status: "open",
      url: "https://checkout.stripe.test/session"
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const state = createState();
  const quote = createTokenQuote("builder", "acct_builder");
  const checkout = await createTokenCheckout(state, quote, {
    accountId: "acct_builder"
  });

  assert.equal(checkout.status, "requires_payment");
  assert.match(stripeBody, /metadata%5Bkind%5D=token_pack/);
  assert.match(stripeBody, /metadata%5Bpack_id%5D=builder/);
  assert.match(stripeBody, /metadata%5Baccount_id%5D=acct_builder/);
});
