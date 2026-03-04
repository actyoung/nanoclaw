#!/usr/bin/env tsx
/**
 * Update CLI Groups CLAUDE.md
 *
 * Re-generates CLAUDE.md for all CLI groups using the cli-template.
 *
 * Usage:
 *   npx tsx scripts/update-cli-claude-md.ts
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const STORE_DIR = path.join(process.cwd(), 'store');

/**
 * Read assistant name from environment or .env file
 */
function getAssistantName(): string {
  if (process.env.ASSISTANT_NAME) {
    return process.env.ASSISTANT_NAME.replace(/^["']|["']$/g, '');
  }
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^ASSISTANT_NAME=(.+)$/m);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return 'AI Assistant';
}

function updateCliGroups(): void {
  // Read template
  const templatePath = path.join(process.cwd(), '.templates', 'groups', 'cli-template', 'CLAUDE.md');
  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }
  const template = fs.readFileSync(templatePath, 'utf-8');

  // Get all CLI groups from database
  const dbPath = path.join(STORE_DIR, 'messages.db');
  const db = new Database(dbPath);

  const groups = db.prepare(
    "SELECT jid, name, folder, added_at FROM registered_groups WHERE jid LIKE 'cli:%' ORDER BY jid"
  ).all() as Array<{ jid: string; name: string; folder: string; added_at: string }>;

  db.close();

  if (groups.length === 0) {
    console.log('No CLI groups found.');
    process.exit(0);
  }

  console.log(`Found ${groups.length} CLI group(s) to update:\n`);

  const assistantName = getAssistantName();

  for (const group of groups) {
    const groupDir = path.join(process.cwd(), 'groups', group.folder);
    const claudeMdPath = path.join(groupDir, 'CLAUDE.md');

    // Generate content from template
    const content = template
      .replace(/{{GROUP_NAME}}/g, group.name)
      .replace(/{{GROUP_JID}}/g, group.jid)
      .replace(/{{GROUP_FOLDER}}/g, group.folder)
      .replace(/{{TIMESTAMP}}/g, group.added_at)
      .replace(/{{ASSISTANT_NAME}}/g, assistantName)
      .replace(/{{PURPOSE}}/g, 'CLI-based agent interaction');

    // Backup existing file if it exists
    if (fs.existsSync(claudeMdPath)) {
      const backupPath = `${claudeMdPath}.backup.${Date.now()}`;
      fs.copyFileSync(claudeMdPath, backupPath);
      console.log(`  Backed up: ${claudeMdPath} -> ${backupPath}`);
    }

    // Write new content
    fs.writeFileSync(claudeMdPath, content);
    console.log(`  Updated: ${group.name} (${group.folder})`);
  }

  console.log(`\n✓ All ${groups.length} CLI group(s) updated successfully!`);
  console.log(`\nAssistant name used: ${assistantName}`);
}

updateCliGroups();
