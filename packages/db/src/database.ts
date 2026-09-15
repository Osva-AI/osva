import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema/index.js";

export type DatabaseSchema = typeof schema;

export interface CreateDatabaseOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly connectTimeoutSeconds?: number;
}

export interface Database {
  readonly sql: Sql;
  readonly db: PostgresJsDatabase<DatabaseSchema>;
  close(): Promise<void>;
}

export function createDatabase(options: CreateDatabaseOptions): Database {
  const sql = postgres(options.connectionString, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 30,
  });

  return {
    sql,
    db: drizzle(sql, { schema }),
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
