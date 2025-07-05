// src/utils/database.ts
import { Client } from '@neondatabase/serverless';
import { env } from '../config/env';

// Database connection helper
export async function getDbConnection(): Promise<Client> {
  const sql = new Client(env.NEON_DATABASE_URL);
  await sql.connect();
  return sql;
}
