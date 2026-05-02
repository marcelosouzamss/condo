import { Pool, type QueryResult } from 'pg';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
});

export async function query(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult> {
  return pool.query(text, params);
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export { pool };
