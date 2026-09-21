import { verifyMigrationHistory } from "./migration-history.js";

const result = verifyMigrationHistory();

if (!result.ok) {
  for (const issue of result.issues) {
    const migration =
      issue.migration === undefined ? "" : ` migration=${issue.migration}`;
    console.error(`[${issue.code}]${migration} ${issue.detail}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Migration history verified (${result.repositoryHead ?? "empty"}).`,
  );
}
