#!/usr/bin/env tsx
/**
 * Add CLI Group Script
 *
 * Creates a new CLI group for isolated CLI-based agent contexts.
 *
 * Usage:
 *   npx tsx scripts/add-cli-group.ts <name>
 *
 * Example:
 *   npx tsx scripts/add-cli-group.ts dev    # Creates cli:dev group
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const STORE_DIR = path.join(process.cwd(), 'store');

/**
 * Read assistant name from environment or .env file
 */
function getAssistantName(): string {
  // Try environment first
  if (process.env.ASSISTANT_NAME) {
    return process.env.ASSISTANT_NAME.replace(/^["']|["']$/g, '');
  }

  // Try reading from .env file
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^ASSISTANT_NAME=(.+)$/m);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, '');
    }
  }

  // Default fallback
  return 'AI Assistant';
}

function isValidGroupName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function createCliGroup(name: string): void {
  if (!isValidGroupName(name)) {
    console.error(
      `Error: Invalid group name "${name}". Use only alphanumeric characters, hyphens, and underscores.`
    );
    process.exit(1);
  }

  const groupJid = `cli:${name}`;
  const groupFolder = `cli-${name}`;
  const groupName = `CLI ${name.charAt(0).toUpperCase() + name.slice(1)}`;

  console.log(`Creating CLI group: ${groupName}`);
  console.log(`  JID: ${groupJid}`);
  console.log(`  Folder: ${groupFolder}`);

  // Ensure store directory exists
  fs.mkdirSync(STORE_DIR, { recursive: true });

  // Open database
  const dbPath = path.join(STORE_DIR, 'messages.db');
  const db = new Database(dbPath);

  // Ensure tables exist
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

  db.exec(`CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT,
    last_message_time TEXT,
    channel TEXT,
    is_group INTEGER DEFAULT 0
  )`);

  // Check if group already exists
  const existing = db
    .prepare('SELECT jid FROM registered_groups WHERE jid = ?')
    .get(groupJid) as { jid: string } | undefined;

  if (existing) {
    console.log(`Group ${groupJid} already exists.`);
    db.close();
    process.exit(0);
  }

  const timestamp = new Date().toISOString();

  // Register group
  db.prepare(
    `INSERT INTO registered_groups
     (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    groupJid,
    groupName,
    groupFolder,
    null, // no trigger pattern needed
    timestamp,
    0, // requires_trigger: false
    1 // is_main: true (CLI messages always trigger)
  );

  // Add to chats table
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time, channel, is_group)
     VALUES (?, ?, ?, ?, ?)`
  ).run(groupJid, groupName, timestamp, 'cli', 1);

  db.close();
  console.log('Group registered in database');

  // Create group folders
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
  console.log(`Created folder: ${groupDir}`);

  // Create CLAUDE.md from template
  const groupClaudeMd = path.join(groupDir, 'CLAUDE.md');
  if (!fs.existsSync(groupClaudeMd)) {
    // Use cli-template
    const templatePath = path.join(process.cwd(), '.templates', 'groups', 'cli-template', 'CLAUDE.md');
    let claudeMdContent: string;

    if (fs.existsSync(templatePath)) {
      const template = fs.readFileSync(templatePath, 'utf-8');
      // Replace placeholders
      claudeMdContent = template
        .replace(/{{GROUP_NAME}}/g, groupName)
        .replace(/{{GROUP_JID}}/g, groupJid)
        .replace(/{{GROUP_FOLDER}}/g, groupFolder)
        .replace(/{{TIMESTAMP}}/g, timestamp)
        .replace(/{{ASSISTANT_NAME}}/g, getAssistantName())
        .replace(/{{PURPOSE}}/g, 'CLI-based agent interaction');
    } else {
      // Fallback if template doesn't exist
      claudeMdContent = `# ${groupName}

You are ${getAssistantName()}, a personal assistant operating in a CLI environment.

## Group Details

- **JID:** ${groupJid}
- **Folder:** ${groupFolder}
- **Created:** ${timestamp}

## Notes

- No trigger pattern required - all messages are processed
- Messages from this channel do NOT get routed to other channels
- Replies are only shown in the CLI interface
- This group has isolated memory and filesystem from other groups
`;
    }

    fs.writeFileSync(groupClaudeMd, claudeMdContent);
    console.log(`Created ${groupClaudeMd}`);
  }

  console.log(`\n✓ CLI group "${name}" created successfully!`);
  console.log(`\nTo use this group:`);
  console.log(`  1. Restart the CLI: npm run cli`);
  console.log(`  2. Select "${groupName}" from the group selector`);
  console.log(`  3. Or use: /switch ${groupFolder}`);
}

// Handle --test flag (just validate the script runs)
if (process.argv.includes('--test')) {
  console.log('add-cli-group script is valid');
  process.exit(0);
}

// Get group name from arguments
const name = process.argv[2];

if (!name) {
  console.error('Usage: npx tsx scripts/add-cli-group.ts <name>');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx scripts/add-cli-group.ts dev    # Creates cli:dev');
  console.error('  npx tsx scripts/add-cli-group.ts test   # Creates cli:test');
  process.exit(1);
}

createCliGroup(name);
