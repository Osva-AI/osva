import { createDatabase } from "./database.js";
import { migrateDatabase } from "./migrate.js";

const connectionString = process.argv[2] ?? process.env.OSVA_DATABASE_URL;

if (!connectionString) {
  console.error(
    "Usage: node dist/migrate-cli.js <connectionString>\nOr set OSVA_DATABASE_URL.",
  );
  process.exitCode = 1;
} else {
  const database = createDatabase({ connectionString });

  migrateDatabase(database)
    .then(async () => {
      await database.close();
    })
    .catch(async (error: unknown) => {
      await database.close();
      console.error(error);
      process.exitCode = 1;
    });
}
