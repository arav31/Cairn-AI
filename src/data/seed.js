const customers = [
  {
    id: "CUST-1001",
    full_name: "Marjorie Tan",
    status: "Active",
    email: "marjorie.tan@example.test",
    company: "Northstar Textiles",
    plan: "Enterprise",
    last_seen: "2026-05-31"
  },
  {
    id: "CUST-1002",
    full_name: "Rafael Singh",
    status: "Active",
    email: "rafael.singh@example.test",
    company: "Atlas Foundry",
    plan: "Business",
    last_seen: "2026-06-02"
  },
  {
    id: "CUST-1003",
    full_name: "Iris Okafor",
    status: "Trial",
    email: "iris.okafor@example.test",
    company: "Bright Harbor Labs",
    plan: "Trial",
    last_seen: "2026-06-07"
  },
  {
    id: "CUST-1004",
    full_name: "Jonah Reyes",
    status: "Inactive",
    email: "jonah.reyes@example.test",
    company: "Peregrine Systems",
    plan: "Business",
    last_seen: "2026-04-18"
  },
  {
    id: "CUST-1005",
    full_name: "Priya Nair",
    status: "Active",
    email: "priya.nair@example.test",
    company: "Cobalt Works",
    plan: "Enterprise",
    last_seen: "2026-06-06"
  }
];

const civicRecords = [
  {
    record_id: "CVC-10492",
    full_name: "Marjorie Tan",
    status: "Active",
    dob: "1979-03-14",
    case_officer: "A. Fictional",
    last_updated: "2026-02-01",
    notes: "Synthetic demo record. Not a real person."
  },
  {
    record_id: "CVC-10977",
    full_name: "Rafael Singh",
    status: "Active",
    dob: "1985-09-22",
    case_officer: "B. Fictional",
    last_updated: "2026-05-13",
    notes: "Synthetic demo record. Not a real person."
  },
  {
    record_id: "CVC-11206",
    full_name: "Iris Okafor",
    status: "Pending Review",
    dob: "1991-11-08",
    case_officer: "C. Fictional",
    last_updated: "2026-05-29",
    notes: "Synthetic demo record. Not a real person."
  },
  {
    record_id: "CVC-11712",
    full_name: "Jonah Reyes",
    status: "Archived",
    dob: "1973-07-19",
    case_officer: "D. Fictional",
    last_updated: "2026-01-17",
    notes: "Synthetic demo record. Not a real person."
  },
  {
    record_id: "CVC-12044",
    full_name: "Priya Nair",
    status: "Active",
    dob: "1988-04-04",
    case_officer: "E. Fictional",
    last_updated: "2026-06-01",
    notes: "Synthetic demo record. Not a real person."
  }
];

const insuranceQuoteTemplates = [
  {
    provider: "Harbor Mutual",
    coverage: "Full coverage",
    baseMonthlyPremium: 128,
    deductible: 500,
    confidence: "high"
  },
  {
    provider: "Northstar Insurance",
    coverage: "Standard coverage",
    baseMonthlyPremium: 111,
    deductible: 750,
    confidence: "high"
  },
  {
    provider: "Pioneer Direct",
    coverage: "Budget coverage",
    baseMonthlyPremium: 94,
    deductible: 1000,
    confidence: "medium"
  }
];

const properties = [
  {
    id: "PROP-9001",
    address: "18 Willow Lane, Austin, TX",
    city: "Austin",
    state: "TX",
    price: 685000,
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "House",
    agent: "Demo Realty",
    url: "https://example-property.test/PROP-9001"
  },
  {
    id: "PROP-9002",
    address: "44 Market Street, Austin, TX",
    city: "Austin",
    state: "TX",
    price: 520000,
    bedrooms: 2,
    bathrooms: 2,
    propertyType: "Condo",
    agent: "Demo Realty",
    url: "https://example-property.test/PROP-9002"
  },
  {
    id: "PROP-9003",
    address: "7 Palm Court, Miami, FL",
    city: "Miami",
    state: "FL",
    price: 740000,
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "Townhouse",
    agent: "Coastal Demo Homes",
    url: "https://example-property.test/PROP-9003"
  },
  {
    id: "PROP-9004",
    address: "201 Pine Avenue, Denver, CO",
    city: "Denver",
    state: "CO",
    price: 610000,
    bedrooms: 4,
    bathrooms: 3,
    propertyType: "House",
    agent: "Mountain Demo Realty",
    url: "https://example-property.test/PROP-9004"
  }
];

const businessRenewals = [
  {
    id: "LIC-5001",
    businessName: "Northstar Textiles",
    state: "TX",
    licenseType: "general",
    renewalStatus: "Due soon",
    dueDate: "2026-07-31",
    feeCents: 8500,
    requiredDocuments: ["Certificate of good standing", "Updated ownership attestation"],
    sourceUrl: "https://example-business.test/renewals/LIC-5001"
  },
  {
    id: "LIC-5002",
    businessName: "Atlas Foundry",
    state: "CA",
    licenseType: "manufacturing",
    renewalStatus: "Action required",
    dueDate: "2026-06-28",
    feeCents: 12500,
    requiredDocuments: ["Safety compliance form", "Local tax clearance"],
    sourceUrl: "https://example-business.test/renewals/LIC-5002"
  },
  {
    id: "LIC-5003",
    businessName: "Bright Harbor Labs",
    state: "NY",
    licenseType: "professional",
    renewalStatus: "Current",
    dueDate: "2027-02-15",
    feeCents: 6500,
    requiredDocuments: [],
    sourceUrl: "https://example-business.test/renewals/LIC-5003"
  },
  {
    id: "LIC-5004",
    businessName: "Cobalt Works",
    state: "FL",
    licenseType: "contractor",
    renewalStatus: "Due soon",
    dueDate: "2026-08-12",
    feeCents: 9800,
    requiredDocuments: ["Insurance certificate", "Continuing education proof"],
    sourceUrl: "https://example-business.test/renewals/LIC-5004"
  }
];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function searchCustomers(name, status) {
  const needle = normalize(name);
  const wantedStatus = normalize(status);
  return customers.filter((customer) => {
    const nameMatches = normalize(customer.full_name).includes(needle);
    const statusMatches = !wantedStatus || normalize(customer.status) === wantedStatus;
    return nameMatches && statusMatches;
  });
}

function searchCivicRecords(name) {
  const needle = normalize(name);
  return civicRecords.filter((record) => normalize(record.full_name).includes(needle));
}

function getCustomer(id) {
  return customers.find((customer) => customer.id === id);
}

function getCivicRecord(id) {
  return civicRecords.find((record) => record.record_id === id);
}

function compareInsuranceQuotes(input) {
  const age = Number(input.driverAge || input.age || 35);
  const vehicleYear = Number(input.vehicleYear || 2021);
  const zipCode = String(input.zipCode || "78701");
  const ageFactor = age < 25 ? 1.22 : age > 60 ? 0.94 : 1;
  const yearFactor = vehicleYear < 2018 ? 0.91 : vehicleYear > 2023 ? 1.08 : 1;
  const zipFactor = zipCode.startsWith("9") ? 1.12 : zipCode.startsWith("3") ? 1.06 : 1;
  return {
    coverageType: input.coverageType || "auto",
    zipCode,
    quotes: insuranceQuoteTemplates.map((quote, index) => ({
      provider: quote.provider,
      coverage: quote.coverage,
      monthlyPremium: Math.round(quote.baseMonthlyPremium * ageFactor * yearFactor * zipFactor),
      deductible: quote.deductible,
      rank: index + 1,
      confidence: quote.confidence,
      source: "Recorded workflow demo"
    })),
    notes: "Synthetic quote results for the Cairn marketplace demo."
  };
}

function searchProperties(input) {
  const location = normalize(input.location || "Austin");
  const maxPrice = Number(input.maxPrice || 700000);
  const minBedrooms = Number(input.bedrooms || input.minBedrooms || 2);
  const matches = properties
    .filter((property) => (
      property.price <= maxPrice &&
      property.bedrooms >= minBedrooms &&
      (
        normalize(property.city).includes(location) ||
        normalize(property.state).includes(location) ||
        normalize(property.address).includes(location)
      )
    ))
    .map((property, index) => ({
      ...property,
      matchScore: Math.max(94 - index * 6, 72),
      source: "Recorded workflow demo"
    }));
  return {
    location: input.location || "Austin",
    maxPrice,
    bedrooms: minBedrooms,
    results: matches,
    notes: "Synthetic property results for the Cairn marketplace demo."
  };
}

function checkBusinessRenewals(input) {
  const businessName = input.businessName || input.company || "Northstar Textiles";
  const state = String(input.state || "TX").toUpperCase();
  const licenseType = normalize(input.licenseType || "");
  const match = businessRenewals.find((record) => {
    const nameMatches = normalize(record.businessName).includes(normalize(businessName));
    const stateMatches = !state || record.state === state;
    const licenseMatches = !licenseType || normalize(record.licenseType).includes(licenseType);
    return nameMatches && stateMatches && licenseMatches;
  }) || businessRenewals.find((record) => normalize(record.businessName).includes(normalize(businessName))) || businessRenewals[0];

  return {
    businessName,
    state,
    licenseType: input.licenseType || match.licenseType,
    renewalStatus: match.renewalStatus,
    dueDate: match.dueDate,
    feeCents: match.feeCents,
    feeLabel: `$${(match.feeCents / 100).toFixed(2)}`,
    requiredDocuments: match.requiredDocuments,
    sourceUrl: match.sourceUrl,
    nextSteps: match.renewalStatus === "Current"
      ? ["No immediate action required.", "Recheck 60 days before the due date."]
      : ["Collect required documents.", "Submit renewal before the due date.", "Confirm payment receipt."],
    record: {
      id: match.id,
      status: match.renewalStatus,
      source: "Recorded workflow demo"
    },
    notes: "Synthetic business renewal result for the Cairn marketplace demo."
  };
}

module.exports = {
  customers,
  civicRecords,
  insuranceQuoteTemplates,
  properties,
  businessRenewals,
  searchCustomers,
  searchCivicRecords,
  compareInsuranceQuotes,
  searchProperties,
  checkBusinessRenewals,
  getCustomer,
  getCivicRecord
};
