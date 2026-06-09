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

module.exports = {
  customers,
  civicRecords,
  searchCustomers,
  searchCivicRecords,
  getCustomer,
  getCivicRecord
};
