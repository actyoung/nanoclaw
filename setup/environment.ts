/**
 * Step: environment — Detect OS, Node, container runtimes, existing config.
 * Replaces 01-check-environment.sh
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { logger } from '../src/logger.js';
import { commandExists, getPlatform, isHeadless, isWSL } from './platform.js';
import { emitStatus } from './status.js';

/**
 * Initialize groups directories from templates.
 * Copies CLAUDE.md from templates and replaces assistant name placeholder.
 */
function initializeGroupsFromTemplates(
  projectRoot: string,
  assistantName: string,
): void {
  const templatesDir = path.join(projectRoot, '.templates', 'groups');
  const groupsDir = path.join(projectRoot, 'groups');

  // Ensure groups directory exists
  fs.mkdirSync(groupsDir, { recursive: true });

  // Initialize global group
  const globalTemplateDir = path.join(templatesDir, 'global-template');
  const globalTargetDir = path.join(groupsDir, 'global');
  if (fs.existsSync(globalTemplateDir)) {
    fs.mkdirSync(globalTargetDir, { recursive: true });
    const templateFile = path.join(globalTemplateDir, 'CLAUDE.md');
    const targetFile = path.join(globalTargetDir, 'CLAUDE.md');
    if (fs.existsSync(templateFile) && !fs.existsSync(targetFile)) {
      let content = fs.readFileSync(templateFile, 'utf-8');
      content = content.replace(/\[AI Assistant\]/g, assistantName);
      fs.writeFileSync(targetFile, content);
      logger.info({ file: targetFile }, 'Created global CLAUDE.md from template');
    }
  }

  // Initialize main group
  const mainTemplateDir = path.join(templatesDir, 'main-template');
  const mainTargetDir = path.join(groupsDir, 'main');
  if (fs.existsSync(mainTemplateDir)) {
    fs.mkdirSync(mainTargetDir, { recursive: true });
    fs.mkdirSync(path.join(mainTargetDir, 'logs'), { recursive: true });
    const templateFile = path.join(mainTemplateDir, 'CLAUDE.md');
    const targetFile = path.join(mainTargetDir, 'CLAUDE.md');
    if (fs.existsSync(templateFile) && !fs.existsSync(targetFile)) {
      let content = fs.readFileSync(templateFile, 'utf-8');
      content = content.replace(/\[AI Assistant\]/g, assistantName);
      fs.writeFileSync(targetFile, content);
      logger.info({ file: targetFile }, 'Created main CLAUDE.md from template');
    }
  }
}

export async function run(_args: string[]): Promise<void> {
  const projectRoot = process.cwd();

  logger.info('Starting environment check');

  const platform = getPlatform();
  const wsl = isWSL();
  const headless = isHeadless();

  // Check Apple Container
  let appleContainer: 'installed' | 'not_found' = 'not_found';
  if (commandExists('container')) {
    appleContainer = 'installed';
  }

  // Check Docker
  let docker: 'running' | 'installed_not_running' | 'not_found' = 'not_found';
  if (commandExists('docker')) {
    try {
      const { execSync } = await import('child_process');
      execSync('docker info', { stdio: 'ignore' });
      docker = 'running';
    } catch {
      docker = 'installed_not_running';
    }
  }

  // Check existing config
  const hasEnv = fs.existsSync(path.join(projectRoot, '.env'));

  // Check Feishu config (default built-in channel)
  let hasFeishu = false;
  if (hasEnv) {
    const envContent = fs.readFileSync(path.join(projectRoot, '.env'), 'utf-8');
    const hasAppId = /^FEISHU_APP_ID=/m.test(envContent) && !/^FEISHU_APP_ID=\s*$/m.test(envContent);
    const hasAppSecret = /^FEISHU_APP_SECRET=/m.test(envContent) && !/^FEISHU_APP_SECRET=\s*$/m.test(envContent);
    hasFeishu = hasAppId && hasAppSecret;
  }

  const authDir = path.join(projectRoot, 'store', 'auth');
  const hasAuth = fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0;

  let hasRegisteredGroups = false;
  // Check JSON file first (pre-migration)
  if (fs.existsSync(path.join(projectRoot, 'data', 'registered_groups.json'))) {
    hasRegisteredGroups = true;
  } else {
    // Check SQLite directly using better-sqlite3 (no sqlite3 CLI needed)
    const dbPath = path.join(STORE_DIR, 'messages.db');
    if (fs.existsSync(dbPath)) {
      try {
        const db = new Database(dbPath, { readonly: true });
        const row = db
          .prepare('SELECT COUNT(*) as count FROM registered_groups')
          .get() as { count: number };
        if (row.count > 0) hasRegisteredGroups = true;
        db.close();
      } catch {
        // Table might not exist yet
      }
    }
  }

  // Initialize groups directories from templates
  const assistantName = process.env.ASSISTANT_NAME || 'AI Assistant';
  initializeGroupsFromTemplates(projectRoot, assistantName);

  logger.info(
    {
      platform,
      wsl,
      appleContainer,
      docker,
      hasEnv,
      hasFeishu,
      hasAuth,
      hasRegisteredGroups,
    },
    'Environment check complete',
  );

  emitStatus('CHECK_ENVIRONMENT', {
    PLATFORM: platform,
    IS_WSL: wsl,
    IS_HEADLESS: headless,
    APPLE_CONTAINER: appleContainer,
    DOCKER: docker,
    HAS_ENV: hasEnv,
    HAS_FEISHU: hasFeishu,
    HAS_AUTH: hasAuth,
    HAS_REGISTERED_GROUPS: hasRegisteredGroups,
    STATUS: 'success',
    LOG: 'logs/setup.log',
  });
}
