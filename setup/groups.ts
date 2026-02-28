/**
 * Step: groups — Fetch group metadata from Feishu, write to DB.
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

function parseArgs(args: string[]): { list: boolean; limit: number } {
  let list = false;
  let limit = 30;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') list = true;
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return { list, limit };
}

export async function run(args: string[]): Promise<void> {
  const { list, limit } = parseArgs(args);

  if (list) {
    await listGroups(limit);
    return;
  }

  await syncGroups();
}

async function listGroups(limit: number): Promise<void> {
  const dbPath = path.join(STORE_DIR, 'messages.db');

  if (!fs.existsSync(dbPath)) {
    console.error('ERROR: database not found');
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT jid, name FROM chats
     WHERE jid LIKE 'feishu:%' AND jid <> '__group_sync__' AND name <> jid
     ORDER BY last_message_time DESC
     LIMIT ?`,
    )
    .all(limit) as Array<{ jid: string; name: string }>;
  db.close();

  for (const row of rows) {
    console.log(`${row.jid}|${row.name}`);
  }
}

async function syncGroups(): Promise<void> {
  emitStatus('SYNC_GROUPS', { STATUS: 'in_progress' });

  const dbPath = path.join(STORE_DIR, 'messages.db');

  if (!fs.existsSync(dbPath)) {
    logger.info('Database not found, initializing...');
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Ensure schema exists
  db.exec(`CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT,
    last_message_time TEXT,
    channel TEXT,
    is_group INTEGER DEFAULT 0
  )`);

  const upsert = db.prepare(
    `INSERT INTO chats (jid, name, last_message_time, channel, is_group)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       name = excluded.name,
       last_message_time = MAX(last_message_time, excluded.last_message_time),
       channel = COALESCE(excluded.channel, channel),
       is_group = COALESCE(excluded.is_group, is_group)`
  );

  // Note: For Feishu, group sync happens at runtime when the bot starts
  // and receives events. This step just ensures the database schema is ready.
  // Groups will be added to the database as messages are received.

  // Count existing Feishu groups
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM chats WHERE jid LIKE 'feishu:%' AND jid <> '__group_sync__'",
    )
    .get() as { count: number };

  const groupsInDb = row.count;
  db.close();

  logger.info(
    { groupsInDb },
    'Groups sync complete (Feishu groups are discovered at runtime)'
  );

  emitStatus('SYNC_GROUPS', {
    STATUS: 'success',
    GROUPS_IN_DB: groupsInDb,
    NOTE: 'Feishu groups are discovered at runtime when messages are received',
  });
}
