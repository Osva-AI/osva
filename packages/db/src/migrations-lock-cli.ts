import { lockMigrationHistory } from "./migration-history.js";

const result = lockMigrationHistory();

if (!result.ok) {
  console.error(result.message);
  process.exitCode = 1;
} else {
  console.log(result.message);
  if (result.appended !== undefined && result.appended.length > 0) {
    for (const entry of result.appended) {
      console.log(`  + ${entry.tag} (${entry.sha256.slice(0, 12)}…)`);
    }
  }
}
