/**
 * @param {import("./run-step.mjs").StepResult[]} results
 * @param {string} profile
 */
export function printResultsTable(results, profile) {
  console.log("");
  console.log(`M15.4 adoption acceptance — profile=${profile}`);
  console.log("");
  console.log("| Step | Journey | Group | Status | ms | Reused suite |");
  console.log("| --- | --- | --- | --- | ---: | --- |");
  for (const row of results) {
    const note = row.reuseNote.replace(/\|/g, "\\|").slice(0, 72);
    console.log(
      `| ${row.id} | ${row.journey} | ${row.group} | **${row.status}** | ${row.durationMs} | ${note} |`,
    );
    if (row.error && row.status !== "PASS") {
      console.log(`| ↳ | | | ${row.error.replace(/\|/g, "\\|")} | | |`);
    }
  }
}

/**
 * @param {import("./run-step.mjs").StepResult[]} results
 * @returns {"PASS" | "FAIL" | "BLOCKED"}
 */
export function overallVerdict(results) {
  if (results.some((r) => r.status === "FAIL")) {
    return "FAIL";
  }
  if (results.some((r) => r.status === "BLOCKED")) {
    return "BLOCKED";
  }
  return "PASS";
}
