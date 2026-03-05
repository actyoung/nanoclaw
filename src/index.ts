import fs from 'fs';
import path from 'path';

import { IDLE_TIMEOUT, POLL_INTERVAL, TRIGGER_PATTERN } from './config.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  clearSession,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
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

const channels: Channel[] = [];
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
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp);

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

  const prompt = formatMessages(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

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
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
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
            data: text,
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
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp);

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
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

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
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp);
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
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  ensureCliGroup();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
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

  // Create and connect all registered channels.
  // Each channel self-registers via the barrel import above.
  // Factories return null when credentials are missing, so unconfigured channels are skipped.
  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(createChannelOpts(channelName));
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.',
      );
      continue;
    }
    channels.push(channel);
    await channel.connect();
  }
  if (channels.length === 0) {
    logger.fatal('No channels connected');
    process.exit(1);
  }

  // Start subsystems (independently of connection handler)
  // Start IPC server for CLI channel communication
  const ipcServer = getIpcServer();
  ipcServer.start();
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
      // Trigger processing
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

  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText);
      if (text) {
        await channel.sendMessage(jid, text);
        const group = registeredGroups[jid];
        if (group && isCliGroupJid(jid)) {
          broadcastAgentEvent({
            type: 'message:sent',
            groupJid: jid,
            groupFolder: group.folder,
            timestamp: Date.now(),
            data: text,
          });
        }
      }
    },
  });
  startIpcWatcher({
    sendMessage: async (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      await channel.sendMessage(jid, text);
      const group = registeredGroups[jid];
      if (group) {
        broadcastAgentEvent({
          type: 'message:sent',
          groupJid: jid,
          groupFolder: group.folder,
          timestamp: Date.now(),
          data: text,
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
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
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
