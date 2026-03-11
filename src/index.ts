import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  ASSISTANT_NAME,
  CREDENTIAL_PROXY_PORT,
  DATA_DIR,
  IDLE_TIMEOUT,
  POLL_INTERVAL,
  STORE_DIR,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
import { startCredentialProxy } from './credential-proxy.js';
import {
  initializeChannels,
  startChannelReconnection,
  getChannelStatus,
} from './channels/index.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
  PROXY_BIND_HOST,
} from './container-runtime.js';
import {
  clearSession,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRegisteredGroup,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { broadcastAgentEvent, getIpcServer } from './ipc-server.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

/**
 * Check if a directory is writable by attempting to create a test file.
 */
function isDirectoryWritable(dirPath: string): boolean {
  try {
    const testFile = path.join(dirPath, '.write_test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check available disk space (in bytes).
 * Returns -1 if unable to determine.
 */
function getAvailableDiskSpace(): number {
  try {
    const stats = fs.statfsSync(DATA_DIR);
    return stats.bavail * stats.bsize;
  } catch {
    return -1;
  }
}

/**
 * Critical dependency checks that must pass before the application starts.
 * These are unrecoverable errors - if any check fails, the process exits immediately.
 */
async function checkCriticalDependencies(): Promise<void> {
  const errors: Array<{ message: string; fix: string }> = [];

  // Check 1: Database accessible
  try {
    const dbPath = path.join(STORE_DIR, 'messages.db');
    // Ensure store directory exists first
    fs.mkdirSync(STORE_DIR, { recursive: true });
    // Try to initialize database (this will create it if it doesn't exist)
    initDatabase();
    // Try a simple query to verify it's working
    const testResult = getRouterState('__test__');
    // Clean up test key if it was created
    if (testResult !== undefined) {
      // No cleanup needed, just verifying read works
    }
  } catch (err) {
    errors.push({
      message: `Database is not accessible: ${err instanceof Error ? err.message : String(err)}`,
      fix: `Check that ${STORE_DIR} exists and is writable. Run: mkdir -p ${STORE_DIR} && chmod 755 ${STORE_DIR}`,
    });
  }

  // Check 2: Directories writable
  const dirsToCheck = [
    { path: DATA_DIR, name: 'DATA_DIR' },
    { path: STORE_DIR, name: 'STORE_DIR' },
  ];

  for (const { path: dirPath, name } of dirsToCheck) {
    // Ensure directory exists
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (err) {
      errors.push({
        message: `Cannot create ${name} directory at ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
        fix: `Check parent directory permissions. Run: mkdir -p ${dirPath}`,
      });
      continue;
    }

    // Check writability
    if (!isDirectoryWritable(dirPath)) {
      errors.push({
        message: `${name} directory is not writable: ${dirPath}`,
        fix: `Fix permissions. Run: chmod 755 ${dirPath} && chown $(whoami) ${dirPath}`,
      });
    }
  }

  // Check 3: Disk space (> 100MB required)
  const availableSpace = getAvailableDiskSpace();
  const MIN_FREE_SPACE = 100 * 1024 * 1024; // 100MB

  if (availableSpace === -1) {
    logger.warn('Unable to determine available disk space, continuing anyway');
  } else if (availableSpace < MIN_FREE_SPACE) {
    const availableMB = Math.round(availableSpace / (1024 * 1024));
    errors.push({
      message: `Insufficient disk space: ${availableMB}MB available, ${Math.round(MIN_FREE_SPACE / (1024 * 1024))}MB required`,
      fix: `Free up disk space. Run: df -h ${DATA_DIR} to see usage`,
    });
  }

  // If any checks failed, log errors and exit
  if (errors.length > 0) {
    logger.fatal(
      '╔══════════════════════════════════════════════════════════════╗',
    );
    logger.fatal(
      '║  CRITICAL DEPENDENCY CHECK FAILED - Cannot start NanoClaw   ║',
    );
    logger.fatal(
      '╚══════════════════════════════════════════════════════════════╝',
    );
    for (const error of errors) {
      logger.fatal(`\n❌ ERROR: ${error.message}`);
      logger.fatal(`   FIX:   ${error.fix}`);
    }
    logger.fatal(
      '\nPlease resolve the above issues and restart the application.',
    );
    process.exit(1);
  }

  logger.info('All critical dependency checks passed');
}

/**
 * Check if a message has a trigger (dual-mode detection).
 * 1. First check is_mentioned field (if channel provides it, e.g., Feishu)
 * 2. Fall back to TRIGGER_PATTERN regex matching on message content
 */
function checkMessageTrigger(m: NewMessage): boolean {
  // If is_mentioned is explicitly true/1, use it (channel-native @mention detection)
  if (m.is_mentioned === true || m.is_mentioned === 1) {
    return true;
  }
  // Fall back to TRIGGER_PATTERN detection for channels without native @mention support
  return TRIGGER_PATTERN.test(m.content.trim());
}

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;
let messageLoopResolver: (() => void) | null = null;

// CLI group constants
// Using cli: prefix to identify CLI groups (cli:main, cli:dev, cli:test, etc.)
const CLI_MAIN_JID = 'cli:main';
const CLI_MAIN_FOLDER = 'cli-main';

// Legacy CLI group JID for migration
const LEGACY_CLI_JID = 'cli:internal:main';

/**
 * Check if a JID is a CLI group
 */
function isCliGroupJid(jid: string): boolean {
  return jid.startsWith('cli:');
}

/**
 * Get all CLI groups from registered groups
 */
function getCliGroups(): Array<{ jid: string; folder: string; name: string }> {
  return Object.entries(registeredGroups)
    .filter(([jid]) => isCliGroupJid(jid))
    .map(([jid, group]) => ({
      jid,
      folder: group.folder,
      name: group.name,
    }));
}

let channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

/**
 * Migrate legacy CLI group from cli:internal:main to cli:main
 */
function migrateCliGroup(): void {
  if (registeredGroups[LEGACY_CLI_JID]) {
    const legacyGroup = registeredGroups[LEGACY_CLI_JID];
    logger.info(
      { oldJid: LEGACY_CLI_JID, newJid: CLI_MAIN_JID },
      'Migrating legacy CLI group',
    );

    // Create new CLI group with updated JID
    const newGroup: RegisteredGroup = {
      name: legacyGroup.name || 'CLI Main',
      folder: CLI_MAIN_FOLDER,
      isMain: true,
      requiresTrigger: false,
      added_at: legacyGroup.added_at || new Date().toISOString(),
    };
    registerGroup(CLI_MAIN_JID, newGroup);

    // Remove old group registration
    delete registeredGroups[LEGACY_CLI_JID];
    // Note: The database record for the old JID will remain but be ignored
    // The messages table uses chat_jid which will show old messages under the new JID
    // after we update the chats table entry

    logger.info('CLI group migration complete');
  }
}

/**
 * Ensure CLI group is auto-registered on startup.
 * CLI uses a dedicated group to prevent routing conflicts with other channels.
 */
function ensureCliGroup(): void {
  // First, migrate legacy format if needed
  migrateCliGroup();

  // Ensure main CLI group exists
  if (!registeredGroups[CLI_MAIN_JID]) {
    const cliGroup: RegisteredGroup = {
      name: 'CLI Main',
      folder: CLI_MAIN_FOLDER,
      isMain: true, // CLI doesn't require trigger
      requiresTrigger: false,
      added_at: new Date().toISOString(),
    };
    registerGroup(CLI_MAIN_JID, cliGroup);
    logger.info('CLI main group auto-registered');
  }
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  // Check if this is a CLI group (special handling)
  const isCliGroup = isCliGroupJid(chatJid);

  const channel = findChannel(channels, chatJid);
  if (!channel && !isCliGroup) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.isMain === true;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  // Dual-mode: use is_mentioned if available, fall back to TRIGGER_PATTERN
  if (!isMainGroup && group.requiresTrigger !== false) {
    const allowlistCfg = loadSenderAllowlist();
    const anyMessageHasTrigger = missedMessages.some(
      (m) =>
        checkMessageTrigger(m) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!anyMessageHasTrigger) return true;
  }

  // Determine the source channel for reply routing
  // Use the source_channel from the last message, or fall back to the channel that owns this JID
  const lastMessage = missedMessages[missedMessages.length - 1];
  const replyChannel = lastMessage.source_channel || channel?.name || 'cli';
  const isCliSource = replyChannel === 'cli';

  logger.info(
    {
      group: group.name,
      messageCount: missedMessages.length,
      lastMessageSource: lastMessage.source_channel,
      replyChannel,
      isCliSource,
    },
    'Processing messages',
  );

  const prompt = formatMessages(missedMessages, TIMEZONE);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  // Send "starting container" notification to let users know the agent is starting up
  // during initial container creation (first conversation or after idle timeout)
  await channel?.sendMessage(chatJid, '🚀 正在启动容器...').catch((err) => {
    logger.warn({ chatJid, err }, 'Failed to send starting notification');
  });

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel?.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      // Extract thinking content from <internal> tags
      const thinkingMatches = raw.match(/<internal>([\s\S]*?)<\/internal>/g);
      const thinking = thinkingMatches
        ?.map((m) => m.replace(/<\/?internal>/g, '').trim())
        .join('\n');
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();

      // Broadcast thinking content for CLI groups (before stripping)
      if (thinking && isCliGroup) {
        broadcastAgentEvent({
          type: 'agent:thinking',
          groupJid: chatJid,
          groupFolder: group.folder,
          timestamp: Date.now(),
          data: thinking,
        });
      }

      if (text) {
        // Route reply based on source channel:
        // - CLI source: only broadcast to CLI (do not send to messaging channels)
        // - Other sources: send to the original channel AND broadcast to CLI
        if (isCliSource) {
          // CLI-initiated conversation: reply only to CLI
          logger.info(
            { group: group.name, text: text.slice(0, 50) },
            'CLI source - NOT sending to channel',
          );
        } else {
          // Channel-initiated conversation: reply to the original channel
          logger.info(
            { group: group.name, text: text.slice(0, 50), replyChannel },
            'Channel source - sending to channel',
          );
          await channel?.sendMessage(chatJid, text);
        }
        outputSentToUser = true;
        // Only broadcast to CLI if this is a CLI group
        if (isCliGroup) {
          broadcastAgentEvent({
            type: 'message:sent',
            groupJid: chatJid,
            groupFolder: group.folder,
            timestamp: Date.now(),
            data: {
              text,
              senderName: group.name,
            },
          });
        }
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
      if (isCliGroup) {
        broadcastAgentEvent({
          type: 'container:idle',
          groupJid: chatJid,
          groupFolder: group.folder,
          timestamp: Date.now(),
        });
      }
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  await channel?.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const sessionId = sessions[group.folder];

  // Get the channel for this chat to retrieve bot name
  const channel = findChannel(channels, chatJid);
  const assistantName = channel?.getBotName?.() ?? 'AI Assistant';

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.sessionReset) {
          // Session was reset (e.g., skill installation), clear saved session
          delete sessions[group.folder];
          clearSession(group.folder);
          logger.info(
            { group: group.name },
            'Session reset by agent (skill reload)',
          );
        } else if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.sessionReset) {
      // Session was reset (e.g., skill installation), clear saved session
      delete sessions[group.folder];
      clearSession(group.folder);
      logger.info(
        { group: group.name },
        'Session reset by agent (skill reload)',
      );
    } else if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

/**
 * Trigger immediate message loop iteration when new messages arrive.
 * Call this after storing a message to reduce latency.
 */
function notifyNewMessage(): void {
  if (messageLoopResolver) {
    messageLoopResolver();
    messageLoopResolver = null;
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @mention)`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          // Check if this is a CLI group (special handling)
          const isCliGroup = isCliGroupJid(chatJid);

          const channel = findChannel(channels, chatJid);
          if (!channel && !isCliGroup) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          const isMainGroup = group.isMain === true;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Dual-mode: use is_mentioned if available, fall back to TRIGGER_PATTERN.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const allowlistCfg = loadSenderAllowlist();
            const anyMessageHasTrigger = groupMessages.some(
              (m) =>
                checkMessageTrigger(m) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!anyMessageHasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              ?.setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    // Wait for POLL_INTERVAL or until notified of new messages
    const waitPromise = new Promise<void>((resolve) => {
      messageLoopResolver = resolve;
      setTimeout(() => {
        if (messageLoopResolver === resolve) {
          messageLoopResolver = null;
          resolve();
        }
      }, POLL_INTERVAL);
    });
    await waitPromise;
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  // Run critical dependency checks first - fail fast if unrecoverable errors exist
  await checkCriticalDependencies();

  ensureContainerSystemRunning();
  // Note: Database is already initialized in checkCriticalDependencies()
  logger.info('Database initialized');
  loadState();
  ensureCliGroup();

  // Start credential proxy (containers route API calls through this)
  const proxyServer = await startCredentialProxy(
    CREDENTIAL_PROXY_PORT,
    PROXY_BIND_HOST,
  );

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    proxyServer.close();
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Helper to create channel-specific callbacks
  const createChannelOpts = (channelName: string) => ({
    onMessage: (chatJid: string, msg: NewMessage) => {
      // Sender allowlist drop mode: discard messages from denied senders before storing
      if (!msg.is_from_me && !msg.is_bot_message && registeredGroups[chatJid]) {
        const cfg = loadSenderAllowlist();
        if (
          shouldDropMessage(chatJid, cfg) &&
          !isSenderAllowed(chatJid, msg.sender, cfg)
        ) {
          if (cfg.logDenied) {
            logger.debug(
              { chatJid, sender: msg.sender },
              'sender-allowlist: dropping message (drop mode)',
            );
          }
          return;
        }
      }
      // Mark message source for reply routing
      msg.source_channel = channelName;
      storeMessage(msg);
      // Notify message loop to process immediately (reduces latency)
      notifyNewMessage();
      // Emit message received event only for CLI groups
      const group = registeredGroups[chatJid];
      if (group && isCliGroupJid(chatJid)) {
        broadcastAgentEvent({
          type: 'message:received',
          groupJid: chatJid,
          groupFolder: group.folder,
          timestamp: Date.now(),
          data: msg,
        });
      }
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  });

  // 3. Start IPC Server (but don't fail if it errors)
  const ipcServer = getIpcServer();
  try {
    ipcServer.start();
  } catch (err) {
    logger.warn({ err }, 'IPC server failed to start, continuing without IPC');
  }

  // 4. Start task scheduler (EVEN if no channels connected)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const text = formatOutbound(rawText);
      if (!text) return;

      const group = registeredGroups[jid];

      // CLI groups don't have a channel - broadcast via IPC
      if (group && isCliGroupJid(jid)) {
        broadcastAgentEvent({
          type: 'message:sent',
          groupJid: jid,
          groupFolder: group.folder,
          timestamp: Date.now(),
          data: {
            text,
            senderName: group.name,
          },
        });
        return;
      }

      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }

      await channel.sendMessage(jid, text);
    },
  });

  // 5. Start IPC Watcher
  startIpcWatcher({
    sendMessage: async (jid, text) => {
      const group = registeredGroups[jid];

      // CLI groups don't have a channel - broadcast via IPC
      if (group && isCliGroupJid(jid)) {
        broadcastAgentEvent({
          type: 'message:sent',
          groupJid: jid,
          groupFolder: group.folder,
          timestamp: Date.now(),
          data: {
            text,
            senderName: group.name,
          },
        });
        return;
      }

      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      await channel.sendMessage(jid, text);
      if (group) {
        broadcastAgentEvent({
          type: 'message:sent',
          groupJid: jid,
          groupFolder: group.folder,
          timestamp: Date.now(),
          data: {
            text,
            senderName: group.name,
          },
        });
      }
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroups: async (force: boolean) => {
      await Promise.all(
        channels
          .filter((ch) => ch.syncGroups)
          .map((ch) => ch.syncGroups!(force)),
      );
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
  });

  // Setup IPC server message handlers
  ipcServer.onMessage((msg) => {
    // Handle incoming messages from CLI clients
    // CLI uses a fixed group JID to prevent routing conflicts
    if (msg.type === 'message' && msg.text) {
      // Determine which CLI group to use
      const targetFolder = msg.groupFolder || CLI_MAIN_FOLDER;
      const targetJid = `cli:${targetFolder.replace('cli-', '')}`;

      const group = registeredGroups[targetJid];
      if (!group) {
        logger.warn(
          { folder: targetFolder, jid: targetJid },
          'CLI group not found',
        );
        return;
      }

      logger.info(
        { text: msg.text?.slice(0, 50), folder: targetFolder },
        'CLI message received, storing with source_channel=cli',
      );
      // Ensure chat metadata exists (required for foreign key constraint)
      storeChatMetadata(
        targetJid,
        new Date().toISOString(),
        group.name,
        'cli',
        true,
      );
      // Store message as if it came from a channel
      storeMessage({
        id: `cli-${Date.now()}`,
        chat_jid: targetJid,
        sender: 'cli',
        sender_name: 'CLI User',
        content: msg.text,
        timestamp: new Date().toISOString(),
        is_from_me: false,
        is_mentioned: true, // Always trigger for CLI messages
        source_channel: 'cli',
      });
      // Trigger processing immediately
      notifyNewMessage();
      queue.enqueueMessageCheck(targetJid);
    } else if (msg.type === 'list_groups') {
      // Return list of CLI groups
      logger.debug('CLI list_groups request received');
    }
  });

  // Register CLI groups list provider
  ipcServer.onGroupsList(() => {
    return getCliGroups().map((g) => ({
      jid: g.jid,
      name: g.name,
      folder: g.folder,
    }));
  });

  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });

  // 6. Connect channels (async, non-blocking, with retry)
  // Start channel connections without blocking the main startup
  const connectChannelsAsync = async () => {
    // Create and connect all registered channels.
    // Each channel self-registers via the barrel import above.
    // Factories return null when credentials are missing, so unconfigured channels are skipped.
    // Connection failures are caught and retried in the background.
    channels = await initializeChannels(createChannelOpts);

    if (channels.length === 0) {
      logger.warn(
        "No channels connected. Tasks will execute but messages won't be sent.",
      );
    } else {
      const status = getChannelStatus();
      logger.info(
        { connected: channels.length, total: status.length },
        'Channels initialized',
      );
    }

    // Start background reconnection for any failed channels
    startChannelReconnection();
  };

  // Start channel connections without blocking
  connectChannelsAsync().catch((err) => {
    logger.error({ err }, 'Channel connection error');
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
