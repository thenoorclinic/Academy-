import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

// Reutilizamos la conexión en desarrollo (hot reload) para no agotar el pool.
const client =
  globalForDb.pg ??
  postgres(process.env.DATABASE_URL ?? "postgres://noor:noor@localhost:5432/noor_hub", {
    max: 10,
    prepare: false,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export type DB = typeof db;
export { schema };
