import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { GroupQueue } from './group-queue.js';
import { broadcastAgentEvent } from './ipc-server.js';
import { logger } from './logger.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

// --- Error Classification and Retry Configuration ---

const MAX_RETRIES = 10;
const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Error types for task execution failures
 */
type ErrorType = 'retryable' | 'permanent';

/**
 * Patterns that indicate retryable errors (temporary issues that may resolve)
 */
const RETRYABLE_ERROR_PATTERNS = [
  // Docker temporarily unavailable
  /docker.*temporarily unavailable/i,
  /docker.*connection refused/i,
  /docker.*daemon/i,
  /cannot connect to docker/i,
  /docker.*not running/i,
  // Network timeouts
  /timeout/i,
  /etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /socket hang up/i,
  /network error/i,
  /fetch failed/i,
  /request timeout/i,
  // Resource pressure
  /resource temporarily unavailable/i,
  /enomem/i,
  /out of memory/i,
  /no space left on device/i,
  /disk full/i,
  /too many open files/i,
  /emfile/i,
  // Container transient issues
  /container.*not found/i,
  /container.*already in use/i,
  /port.*already in use/i,
  /bind.*address already in use/i,
];

/**
 * Patterns that indicate permanent errors (will not resolve with retry)
 */
const PERMANENT_ERROR_PATTERNS = [
  // Container image issues
  /image not found/i,
  /no such image/i,
  /invalid reference format/i,
  /pull access denied/i,
  /repository.*not found/i,
  // Permission issues
  /permission denied/i,
  /eacces/i,
  /access denied/i,
  /unauthorized/i,
  /forbidden/i,
  // Invalid configuration
  /invalid config/i,
  /config error/i,
  /invalid argument/i,
  /bad request/i,
  /validation failed/i,
  // Code/syntax errors
  /syntax error/i,
  /module not found/i,
  /cannot find module/i,
  /import error/i,
  // Group folder issues (already handled separately but included for completeness)
  /invalid group folder/i,
  /group not found/i,
];

/**
 * Classify an error as retryable or permanent based on error message
 */
function classifyError(error: string): ErrorType {
  const lowerError = error.toLowerCase();

  // Check permanent errors first (more specific)
  for (const pattern of PERMANENT_ERROR_PATTERNS) {
    if (pattern.test(lowerError)) {
      return 'permanent';
    }
  }

  // Check retryable errors
  for (const pattern of RETRYABLE_ERROR_PATTERNS) {
    if (pattern.test(lowerError)) {
      return 'retryable';
    }
  }

  // Default to retryable for unknown errors (safer assumption)
  return 'retryable';
}

/**
 * Calculate next retry time with exponential backoff
 * Base: 1 minute, doubles each time, max 1 hour
 */
function calculateNextRetryTime(retryCount: number): string {
  const baseDelayMs = 60 * 1000; // 1 minute
  const delayMs = Math.min(baseDelayMs * Math.pow(2, retryCount), MAX_BACKOFF_MS);
  return new Date(Date.now() + delayMs).toISOString();
}

/**
 * Check if a JID is a CLI group
 */
function isCliGroupJid(jid: string): boolean {
  return jid.startsWith('cli:');
}

/**
 * Compute the next run time for a recurring task, anchored to the
 * task's scheduled time rather than Date.now() to prevent cumulative
 * drift on interval-based tasks.
 *
 * Co-authored-by: @community-pr-601
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      // Guard against malformed interval that would cause an infinite loop
      logger.warn(
        { taskId: task.id, value: task.schedule_value },
        'Invalid interval value',
      );
      return new Date(now + 60_000).toISOString();
    }
    // Anchor to the scheduled time, not now, to prevent drift.
    // Skip past any missed intervals so we always land in the future.
    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Invalid group folder is a permanent error - mark as failed
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, error },
      'Task has invalid group folder',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
      retry_count: task.retry_count || 0,
    });
    updateTask(task.id, {
      status: 'failed',
      error_message: error,
      last_result: `Error: ${error}`,
    });
    return;
  }
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    const error = `Group not found: ${task.group_folder}`;
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
      retry_count: task.retry_count || 0,
    });
    // Group not found is a permanent error - mark as failed
    updateTask(task.id, {
      status: 'failed',
      error_message: error,
      last_result: `Error: ${error}`,
    });
    return;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const isMain = group.isMain === true;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
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

  let result: string | null = null;
  let error: string | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // After the task produces a result, close the container promptly.
  // Tasks are single-turn — no need to wait IDLE_TIMEOUT (30 min) for the
  // query loop to time out. A short delay handles any final MCP calls.
  const TASK_CLOSE_DELAY_MS = 10000;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleClose = () => {
    if (closeTimer) return; // already scheduled
    closeTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Closing task container after result');
      deps.queue.closeStdin(task.chat_jid);
    }, TASK_CLOSE_DELAY_MS);
  };

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt: task.prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
      },
      (proc, containerName) =>
        deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
      async (streamedOutput: ContainerOutput) => {
        // Handle thinking state for CLI groups
        if (streamedOutput.isThinking && isCliGroupJid(task.chat_jid)) {
          // Strip <internal> tags from thinking content
          const raw = streamedOutput.result || '';
          const thinkingMatches = raw.match(
            /<internal>([\s\S]*?)<\/internal>/g,
          );
          const thinking = thinkingMatches
            ?.map((m) => m.replace(/<\/?internal>/g, '').trim())
            .join('\n');
          if (thinking) {
            broadcastAgentEvent({
              type: 'agent:thinking',
              groupJid: task.chat_jid,
              groupFolder: task.group_folder,
              timestamp: Date.now(),
              data: thinking,
            });
          }
        }
        if (streamedOutput.result) {
          result = streamedOutput.result;
          // Forward result to user (sendMessage handles formatting)
          await deps.sendMessage(task.chat_jid, streamedOutput.result);
          scheduleClose();
        }
        if (streamedOutput.status === 'success') {
          deps.queue.notifyIdle(task.chat_jid);
          scheduleClose(); // Close promptly even when result is null (e.g. IPC-only tasks)
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (closeTimer) clearTimeout(closeTimer);

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      // Result was already forwarded to the user via the streaming callback above
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (closeTimer) clearTimeout(closeTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;
  const currentRetryCount = task.retry_count || 0;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
    retry_count: currentRetryCount,
  });

  // Handle success case
  if (!error) {
    const nextRun = computeNextRun(task);
    const resultSummary = result ? result.slice(0, 200) : 'Completed';
    // Reset retry count on success
    updateTaskAfterRun(task.id, nextRun, resultSummary, true);
    return;
  }

  // Handle error case with classification and retry logic
  const errorType = classifyError(error);
  const resultSummary = `Error: ${error}`;

  // Check if we've exceeded max retries
  if (currentRetryCount >= MAX_RETRIES) {
    logger.error(
      { taskId: task.id, retryCount: currentRetryCount, error },
      `Task failed after ${MAX_RETRIES} retries, marking as failed`,
    );
    updateTask(task.id, {
      status: 'failed',
      error_message: error,
      last_result: resultSummary,
    });
    return;
  }

  if (errorType === 'permanent') {
    // Permanent error - mark as failed immediately, do not retry
    logger.error(
      { taskId: task.id, error },
      `Task ${task.id} failed with permanent error: ${error}`,
    );
    updateTask(task.id, {
      status: 'failed',
      error_message: error,
      last_result: resultSummary,
    });
  } else {
    // Retryable error - schedule retry with exponential backoff
    const nextRetryCount = currentRetryCount + 1;
    const nextRunAt = calculateNextRetryTime(currentRetryCount);
    const delayMinutes = Math.round(
      (new Date(nextRunAt).getTime() - Date.now()) / 60000,
    );

    logger.warn(
      { taskId: task.id, error, nextRunAt, retryCount: nextRetryCount },
      `Task ${task.id} failed with retryable error, will retry in ${delayMinutes} minutes (attempt ${nextRetryCount}/${MAX_RETRIES})`,
    );

    updateTask(task.id, {
      retry_count: nextRetryCount,
      next_run: nextRunAt,
      last_result: resultSummary,
    });
  }
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        deps.queue.enqueueTask(currentTask.chat_jid, currentTask.id, () =>
          runTask(currentTask, deps),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** @internal - for tests only. */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}
