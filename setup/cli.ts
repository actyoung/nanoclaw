/**
 * Step: cli — Initialize CLI group for standalone CLI channel.
 *
 * Creates the cli-main group with fixed JID (cli:internal:main)
 * so CLI operates as an independent channel without conflicting
 * with messaging channels like Feishu, Telegram, etc.
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

const CLI_GROUP_JID = 'cli:internal:main';
const CLI_GROUP_FOLDER = 'cli-main';
const CLI_GROUP_NAME = 'CLI Main';

export async function run(_args: string[]): Promise<void> {
  const projectRoot = process.cwd();

  logger.info('Initializing CLI group');

  // Ensure store directory exists
  fs.mkdirSync(STORE_DIR, { recursive: true });

  // Ensure data directory exists
  fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });

  // Write to SQLite
  const dbPath = path.join(STORE_DIR, 'messages.db');
  const timestamp = new Date().toISOString();

  const db = new Database(dbPath);

  // Ensure schema exists
  db.exec(`CREATE TABLE IF NOT EXISTS registered_groups (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL UNIQUE,
    trigger_pattern TEXT,
    added_at TEXT NOT NULL,
    container_config TEXT,
    requires_trigger INTEGER DEFAULT 1,
    is_main INTEGER DEFAULT 0
  )`);

  // Ensure chats table exists (required for messages FK constraint)
  db.exec(`CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT,
    last_message_time TEXT,
    channel TEXT,
    is_group INTEGER DEFAULT 0
  )`);

  // Ensure messages table exists
  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT,
    chat_jid TEXT,
    sender TEXT,
    sender_name TEXT,
    content TEXT,
    timestamp TEXT,
    is_from_me INTEGER,
    is_bot_message INTEGER DEFAULT 0,
    is_mentioned INTEGER DEFAULT 0,
    source_channel TEXT,
    PRIMARY KEY (id, chat_jid),
    FOREIGN KEY (chat_jid) REFERENCES chats(jid)
  )`);

  // Check if CLI group already exists
  const existing = db
    .prepare('SELECT jid FROM registered_groups WHERE jid = ?')
    .get(CLI_GROUP_JID) as { jid: string } | undefined;

  if (existing) {
    logger.info('CLI group already exists, ensuring chats table entry');
    // Ensure chats table entry exists even for existing CLI group
    db.prepare(
      `INSERT OR IGNORE INTO chats (jid, name, last_message_time, channel, is_group)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      CLI_GROUP_JID,
      CLI_GROUP_NAME,
      timestamp,
      'cli',
      1,
    );
    db.close();
    emitStatus('CLI_INIT', {
      STATUS: 'success',
      JID: CLI_GROUP_JID,
      FOLDER: CLI_GROUP_FOLDER,
      CREATED: false,
      NOTE: 'CLI group already exists',
    });
    return;
  }

  // Create CLI group
  db.prepare(
    `INSERT INTO registered_groups
     (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    CLI_GROUP_JID,
    CLI_GROUP_NAME,
    CLI_GROUP_FOLDER,
    null, // no trigger pattern needed
    timestamp,
    0, // requires_trigger: false
    1, // is_main: true (CLI messages always trigger)
  );

  // Also insert into chats table (required for messages FK constraint)
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time, channel, is_group)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    CLI_GROUP_JID,
    CLI_GROUP_NAME,
    timestamp,
    'cli',
    1, // is_group: true
  );

  db.close();
  logger.info('CLI group registered in database');

  // Create group folders
  const groupDir = path.join(projectRoot, 'groups', CLI_GROUP_FOLDER);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Create CLAUDE.md for CLI group
  const groupClaudeMd = path.join(groupDir, 'CLAUDE.md');
  if (!fs.existsSync(groupClaudeMd)) {
    fs.writeFileSync(
      groupClaudeMd,
      `# ${CLI_GROUP_NAME}

This is the dedicated group for the CLI channel. You can interact with the Agent directly here,
and all messages will trigger an Agent response without requiring any trigger pattern.

## Purpose

- Direct access to the Agent without going through messaging channels
- Testing and debugging channel
- Administrative tasks

## Notes

- No trigger pattern required - all messages are processed
- Messages from this channel do NOT get routed to other channels
- Replies are only shown in the CLI interface
`,
    );
    logger.info('Created CLI group CLAUDE.md');
  }

  emitStatus('CLI_INIT', {
    STATUS: 'success',
    JID: CLI_GROUP_JID,
    FOLDER: CLI_GROUP_FOLDER,
    CREATED: true,
  });
}
