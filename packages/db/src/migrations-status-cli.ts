import { createDatabase } from "./database.js";
import {
  formatMigrationStatus,
  readMigrationStatus,
  redactDatabaseTarget,
} from "./migration-status.js";

const connectionString = process.argv[2] ?? process.env.OSVA_DATABASE_URL;

if (!connectionString) {
  console.error(
    "Usage: node dist/migrations-status-cli.js <connectionString>\nOr set OSVA_DATABASE_URL.",
  );
  process.exitCode = 1;
} else {
  const database = createDatabase({ connectionString, max: 1 });

  readMigrationStatus(database.sql)
    .then(async (snapshot) => {
      console.log(`database: ${redactDatabaseTarget(connectionString)}`);
      console.log(formatMigrationStatus(snapshot));
      await database.close();
      if (snapshot.status === "unexpected") {
        process.exitCode = 2;
      }
    })
    .catch(async (error: unknown) => {
      await database.close();
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
