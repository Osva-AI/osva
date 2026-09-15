import { sql, type SQL } from "drizzle-orm";

export function sqlTextInList(values: readonly string[]): SQL {
  return sql.raw(
    values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "),
  );
}
