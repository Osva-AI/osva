#!/usr/bin/env node
import { checkComposeDistributionConsistency } from "./lib/compose-distribution-consistency.mjs";

const result = checkComposeDistributionConsistency();

if (result.ok) {
  console.log(
    `compose distribution consistency PASS (platform ${result.details.platformVersion}, migration head ${result.details.distributionMigrationHead})`,
  );
  process.exit(0);
}

console.error("compose distribution consistency FAIL:");
for (const failure of result.failures) {
  console.error(`  - ${failure}`);
}
process.exit(1);
