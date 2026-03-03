/**
 * Step: register — Write channel registration config, create group folders.
 *
 * Accepts --channel to specify the messaging platform (whatsapp, telegram, slack, discord).
 * Uses parameterized SQL queries to prevent injection.
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { isValidGroupFolder } from '../src/group-folder.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

interface RegisterArgs {
  jid: string;
  name: string;
  folder: string;
  channel: string;
  requiresTrigger: boolean;
  isMain: boolean;
  assistantName: string;
  trigger?: string;
}

function parseArgs(args: string[]): RegisterArgs {
  const result: RegisterArgs = {
    jid: '',
    name: '',
    folder: '',
    channel: 'whatsapp', // backward-compat: pre-refactor installs omit --channel
    requiresTrigger: true,
    isMain: false,
    assistantName: 'AI Assistant',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--jid':
        result.jid = args[++i] || '';
        break;
      case '--name':
        result.name = args[++i] || '';
        break;
      case '--folder':
        result.folder = args[++i] || '';
        break;
      case '--channel':
        result.channel = (args[++i] || '').toLowerCase();
        break;
      case '--no-trigger-required':
        result.requiresTrigger = false;
        break;
      case '--is-main':
        result.isMain = true;
        break;
      case '--assistant-name':
        result.assistantName = args[++i] || 'AI Assistant';
        break;
      case '--trigger':
        result.trigger = args[++i] || '';
        break;
    }
  }

  return result;
}

export async function run(args: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const parsed = parseArgs(args);

  if (!parsed.jid || !parsed.name || !parsed.folder) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'missing_required_args',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  if (!isValidGroupFolder(parsed.folder)) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'invalid_folder',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  logger.info(parsed, 'Registering channel');

  // Ensure data and store directories exist (store/ may not exist on
  // fresh installs that skip WhatsApp auth, which normally creates it)
  fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });

  // Write to SQLite using parameterized queries (no SQL injection)
  const dbPath = path.join(STORE_DIR, 'messages.db');
  const timestamp = new Date().toISOString();
  const requiresTriggerInt = parsed.requiresTrigger ? 1 : 0;

  const db = new Database(dbPath);
  // Ensure schema exists (matches src/db.ts definition)
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

  const isMainInt = parsed.isMain ? 1 : 0;

  db.prepare(
    `INSERT OR REPLACE INTO registered_groups
     (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    parsed.jid,
    parsed.name,
    parsed.folder,
    parsed.trigger ?? null,
    timestamp,
    requiresTriggerInt,
    isMainInt,
  );

  db.close();
  logger.info('Wrote registration to SQLite');

  // Create group folders
  const groupDir = path.join(projectRoot, 'groups', parsed.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), {
    recursive: true,
  });

  // Create CLAUDE.md for new group from template
  // Main group uses main-template, others use global-template
  const groupClaudeMd = path.join(groupDir, 'CLAUDE.md');
  const templateDir = path.join(projectRoot, '.templates', 'groups');
  const templateSubdir = parsed.isMain ? 'main-template' : 'global-template';
  const templatePath = path.join(templateDir, templateSubdir, 'CLAUDE.md');

  if (!fs.existsSync(groupClaudeMd)) {
    if (fs.existsSync(templatePath)) {
      let content = fs.readFileSync(templatePath, 'utf-8');
      content = content.replace(/\[AI Assistant\]/g, parsed.assistantName);
      fs.writeFileSync(groupClaudeMd, content);
      logger.info({ file: groupClaudeMd, template: templateSubdir }, 'Created CLAUDE.md from template');
    } else {
      // Fallback to empty CLAUDE.md if template doesn't exist
      fs.writeFileSync(groupClaudeMd, `# ${parsed.assistantName}\n\nYou are ${parsed.assistantName}, a personal assistant.\n`);
      logger.warn({ file: groupClaudeMd }, 'Template not found, created minimal CLAUDE.md');
    }
  }

  // Update .env with assistant name if different from default
  let nameUpdated = false;
  if (parsed.assistantName !== 'AI Assistant') {
    const envFile = path.join(projectRoot, '.env');
    if (fs.existsSync(envFile)) {
      let envContent = fs.readFileSync(envFile, 'utf-8');
      if (envContent.includes('ASSISTANT_NAME=')) {
        envContent = envContent.replace(
          /^ASSISTANT_NAME=.*$/m,
          `ASSISTANT_NAME="${parsed.assistantName}"`,
        );
      } else {
        envContent += `\nASSISTANT_NAME="${parsed.assistantName}"`;
      }
      fs.writeFileSync(envFile, envContent);
    } else {
      fs.writeFileSync(envFile, `ASSISTANT_NAME="${parsed.assistantName}"\n`);
    }
    logger.info('Set ASSISTANT_NAME in .env');
    nameUpdated = true;
  }

  const statusPayload: Record<string, string | number | boolean> = {
    JID: parsed.jid,
    NAME: parsed.name,
    FOLDER: parsed.folder,
    CHANNEL: parsed.channel,
    REQUIRES_TRIGGER: parsed.requiresTrigger,
    ASSISTANT_NAME: parsed.assistantName,
    NAME_UPDATED: nameUpdated,
    STATUS: 'success',
    LOG: 'logs/setup.log',
  };
  if (parsed.trigger) {
    statusPayload.TRIGGER = parsed.trigger;
  }
  emitStatus('REGISTER_CHANNEL', statusPayload);
}
