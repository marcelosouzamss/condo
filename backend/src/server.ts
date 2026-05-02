import 'dotenv/config';

import fs from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';

import app from './app';
import { closePool } from './db';
import { ensureSchema } from './migrations/ensureSchema';

const port = Number(process.env.PORT || 3333);
let server: Server | undefined;

async function start(): Promise<void> {
  await ensureSchema();

  fs.mkdirSync(path.join(process.cwd(), 'uploads'), { recursive: true });

  server = app.listen(port, () => {
    console.log(`Condo backend running on port ${port}`);
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  if (!server) {
    await closePool();
    process.exit(0);
  }

  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

void start().catch(async (error: unknown) => {
  console.error('Failed to start backend.', error);
  await closePool();
  process.exit(1);
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
