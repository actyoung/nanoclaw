// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.

import { logger } from '../logger.js';
import { Channel } from '../types.js';
import { ChannelOpts, getChannelFactory, getRegisteredChannelNames } from './registry.js';

// feishu
import './feishu.js';

// gmail

// slack

// telegram

// whatsapp

// Channel connection status types
export type ChannelStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

// Channel status tracking
interface ChannelState {
  name: string;
  channel: Channel;
  status: ChannelStatus;
  lastError?: Error;
  retryCount: number;
  nextRetryAt: number;
}

const channelStates = new Map<string, ChannelState>();

// Reconnection configuration
const RECONFIG = {
  initialDelayMs: 30_000,    // 30 seconds
  maxDelayMs: 5 * 60_000,    // 5 minutes
  backoffMultiplier: 2,
};

let reconnectionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize and connect all registered channels.
 * Wraps each channel's connect() in try-catch for fault tolerance.
 */
export async function initializeChannels(
  createChannelOpts: (name: string) => ChannelOpts
): Promise<Channel[]> {
  const connectedChannels: Channel[] = [];

  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName);
    if (!factory) {
      logger.warn({ channel: channelName }, 'Channel factory not found');
      continue;
    }

    const channel = factory(createChannelOpts(channelName));
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.'
      );
      continue;
    }

    // Initialize state as connecting
    const state: ChannelState = {
      name: channelName,
      channel,
      status: 'connecting',
      retryCount: 0,
      nextRetryAt: Date.now(),
    };
    channelStates.set(channelName, state);

    // Attempt connection with error handling
    try {
      await channel.connect();
      state.status = 'connected';
      connectedChannels.push(channel);
      logger.info({ channel: channelName }, 'Channel connected successfully');
    } catch (err) {
      state.status = 'failed';
      state.lastError = err instanceof Error ? err : new Error(String(err));
      state.nextRetryAt = Date.now() + RECONFIG.initialDelayMs;
      logger.warn(
        { channel: channelName, err: state.lastError },
        'Channel connection failed, will retry in background'
      );
    }
  }

  return connectedChannels;
}

/**
 * Get the current status of all channels.
 */
export function getChannelStatus(): Array<{
  name: string;
  status: ChannelStatus;
  retryCount: number;
  nextRetryAt?: number;
  lastError?: string;
}> {
  return Array.from(channelStates.values()).map((state) => ({
    name: state.name,
    status: state.status,
    retryCount: state.retryCount,
    nextRetryAt: state.nextRetryAt,
    lastError: state.lastError?.message,
  }));
}

/**
 * Get a specific channel's state.
 */
export function getChannelState(name: string): ChannelState | undefined {
  return channelStates.get(name);
}

/**
 * Update a channel's status.
 */
export function updateChannelStatus(
  name: string,
  status: ChannelStatus,
  error?: Error
): void {
  const state = channelStates.get(name);
  if (state) {
    state.status = status;
    if (error) {
      state.lastError = error;
    }
  }
}

/**
 * Calculate the next retry delay using exponential backoff.
 */
function calculateRetryDelay(retryCount: number): number {
  const delay = RECONFIG.initialDelayMs * Math.pow(RECONFIG.backoffMultiplier, retryCount);
  return Math.min(delay, RECONFIG.maxDelayMs);
}

/**
 * Attempt to reconnect a single channel.
 */
async function reconnectChannel(state: ChannelState): Promise<void> {
  logger.info(
    { channel: state.name, attempt: state.retryCount + 1 },
    'Attempting to reconnect channel'
  );

  try {
    state.status = 'connecting';
    await state.channel.connect();
    state.status = 'connected';
    state.retryCount = 0;
    state.lastError = undefined;
    logger.info({ channel: state.name }, 'Channel reconnected successfully');
  } catch (err) {
    state.status = 'failed';
    state.lastError = err instanceof Error ? err : new Error(String(err));
    state.retryCount++;
    const delay = calculateRetryDelay(state.retryCount);
    state.nextRetryAt = Date.now() + delay;
    logger.warn(
      { channel: state.name, err: state.lastError, nextRetryInMs: delay },
      'Channel reconnection failed, will retry later'
    );
  }
}

/**
 * Start the background reconnection process.
 * Runs periodically to retry failed channels with exponential backoff.
 */
export function startChannelReconnection(): void {
  if (reconnectionInterval) {
    return; // Already running
  }

  logger.info('Starting channel reconnection background process');

  reconnectionInterval = setInterval(() => {
    const now = Date.now();

    for (const state of channelStates.values()) {
      // Only retry channels that failed and are due for retry
      if (state.status === 'failed' && now >= state.nextRetryAt) {
        reconnectChannel(state).catch((err) => {
          logger.error(
            { channel: state.name, err },
            'Unexpected error during channel reconnection'
          );
        });
      }
    }
  }, 10_000); // Check every 10 seconds
}

/**
 * Stop the background reconnection process.
 */
export function stopChannelReconnection(): void {
  if (reconnectionInterval) {
    clearInterval(reconnectionInterval);
    reconnectionInterval = null;
    logger.info('Stopped channel reconnection background process');
  }
}

/**
 * Get all channels that are currently connected.
 */
export function getConnectedChannels(): Channel[] {
  return Array.from(channelStates.values())
    .filter((state) => state.status === 'connected')
    .map((state) => state.channel);
}

/**
 * Check if any channels are connected or connecting.
 */
export function hasActiveChannels(): boolean {
  return Array.from(channelStates.values()).some(
    (state) => state.status === 'connected' || state.status === 'connecting'
  );
}
