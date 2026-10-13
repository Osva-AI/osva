import { createDatabase } from "./database.js";
import { redactDatabaseTarget } from "./migration-status.js";
import {
  formatSchemaIntegrity,
  isDatabaseUnavailableError,
  verifySchemaIntegrity,
} from "./schema-integrity.js";

const connectionString = process.argv[2] ?? process.env.OSVA_DATABASE_URL;

if (!connectionString) {
  console.error(
    "Usage: node dist/migrations-integrity-cli.js <connectionString>\nOr set OSVA_DATABASE_URL.",
  );
  process.exitCode = 1;
} else {
  const database = createDatabase({
    connectionString,
    max: 1,
    connectTimeoutSeconds: 3,
  });

  verifySchemaIntegrity(database.sql)
    .then(async (report) => {
      console.log(`database: ${redactDatabaseTarget(connectionString)}`);
      console.log(formatSchemaIntegrity(report));
      await database.close();
      if (report.outcome === "database_inaccessible") {
        process.exitCode = 1;
        return;
      }
      if (
        report.outcome === "schema_mismatch" ||
        report.outcome === "schema_ahead" ||
        report.outcome === "unknown"
      ) {
        process.exitCode = 2;
      }
    })
    .catch(async (error: unknown) => {
      await database.close();
      console.log(`database: ${redactDatabaseTarget(connectionString)}`);
      if (isDatabaseUnavailableError(error)) {
        console.error("schema integrity: database_inaccessible");
        console.error(
          "diagnostic: PostgreSQL is unreachable. Schema integrity was not evaluated.",
        );
        process.exitCode = 1;
        return;
      }
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
