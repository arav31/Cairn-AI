const { loadEnv } = require("../src/cairn/env");
const { migrate } = require("../src/cairn/database");

loadEnv();

migrate()
  .then((applied) => {
    if (!applied) {
      console.log("DATABASE_URL is not set, so no database migration was run.");
      process.exit(1);
      return;
    }
    console.log("Database schema is ready.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
