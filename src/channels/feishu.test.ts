import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

// Mock config
vi.mock('../config.js', () => ({
  FEISHU_APP_ID: 'test-app-id',
  FEISHU_APP_SECRET: 'test-app-secret',
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Lark SDK
const mockStart = vi.fn();
const mockRegister = vi.fn();

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class MockClient {
    im = {
      v1: {
        chat: {
          list: vi.fn(),
        },
      },
    };
  },
  WSClient: class MockWSClient {
    start = mockStart;
  },
  EventDispatcher: class MockEventDispatcher {
    register = mockRegister;
  },
  LoggerLevel: {
    info: 'info',
    error: 'error',
  },
}));

import { FeishuChannel, FeishuChannelOpts } from './feishu.js';
import { logger } from '../logger.js';

// --- Test helpers ---

function createTestOpts(
  overrides?: Partial<FeishuChannelOpts>,
): FeishuChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'feishu:oc_test123': {
        name: 'Test Group',
        folder: 'test-group',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
    ...overrides,
  };
}

function mockBotInfoResponse() {
  mockFetch.mockResolvedValueOnce({
    json: vi.fn().mockResolvedValueOnce({
      code: 0,
      tenant_access_token: 'test-token',
    }),
  });
  mockFetch.mockResolvedValueOnce({
    json: vi.fn().mockResolvedValueOnce({
      code: 0,
      bot: {
        open_id: 'ou_bot123',
        app_name: 'TestBot',
      },
    }),
  });
}

// --- Tests ---

describe('FeishuChannel Heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('heartbeat monitoring', () => {
    it('should start heartbeat monitoring when WebSocket starts', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();

      // Fast-forward past the 5s initial delay
      vi.advanceTimersByTime(5000);

      // Heartbeat should be started
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          intervalMs: 30000,
          timeoutMs: 300000,
        }),
        'WebSocket heartbeat monitoring started',
      );
    });

    it('should not trigger reconnect while receiving messages regularly', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();
      vi.advanceTimersByTime(5000);

      // Get message handler
      const messageHandler = mockRegister.mock.calls.find(
        (call: any) => call[0]['im.message.receive_v1'],
      )?.[0]['im.message.receive_v1'];

      // Clear initial logs
      vi.clearAllMocks();

      // Simulate messages every minute for 4 minutes
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(60 * 1000);
        await messageHandler({
          message: {
            message_id: `msg${i}`,
            chat_id: 'oc_test123',
            chat_type: 'group',
            message_type: 'text',
            content: JSON.stringify({ text: `Hello ${i}` }),
            create_time: Date.now().toString(),
            mentions: [{ id: { open_id: 'ou_bot123' }, name: 'TestBot' }],
          },
          sender: {
            sender_id: { open_id: 'ou_user123' },
            sender_type: 'user',
            tenant_key: 'test',
          },
        });
      }

      // Should NOT have triggered reconnect
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        'WebSocket heartbeat timeout - no message received for too long, reconnecting...',
      );
    });

    it('should trigger reconnect after 5 minutes of inactivity', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();
      vi.advanceTimersByTime(5000);

      // Clear initial logs
      vi.clearAllMocks();

      // Advance past 5 minute timeout
      vi.advanceTimersByTime(5 * 60 * 1000 + 30000);

      // Should log timeout warning
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          timeSinceLastMessageMs: expect.any(Number),
          timeoutMs: 300000,
        }),
        'WebSocket heartbeat timeout - no message received for too long, reconnecting...',
      );

      // Should initiate reconnect
      expect(logger.info).toHaveBeenCalledWith(
        'Attempting to reconnect WebSocket...',
      );
    });

    it('should update last message time on message receive', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();
      vi.advanceTimersByTime(5000);

      // Get the message handler
      const messageHandler = mockRegister.mock.calls.find(
        (call: any) => call[0]['im.message.receive_v1'],
      )?.[0]['im.message.receive_v1'];

      expect(messageHandler).toBeDefined();

      // Simulate a message
      const mockMessage = {
        message: {
          message_id: 'msg123',
          chat_id: 'oc_test123',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: 'Hello' }),
          create_time: Date.now().toString(),
          mentions: [{ id: { open_id: 'ou_bot123' }, name: 'TestBot' }],
        },
        sender: {
          sender_id: { open_id: 'ou_user123' },
          sender_type: 'user',
          tenant_key: 'test',
        },
      };

      await messageHandler(mockMessage);

      // Should have processed the message
      expect(opts.onMessage).toHaveBeenCalled();
    });

    it('should stop heartbeat on disconnect', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();
      vi.advanceTimersByTime(5000);

      // Clear initial logs
      vi.clearAllMocks();

      await channel.disconnect();

      expect(logger.info).toHaveBeenCalledWith(
        'WebSocket heartbeat monitoring stopped',
      );
    });

    it('should avoid duplicate heartbeat intervals', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();
      vi.advanceTimersByTime(5000);

      // Clear initial logs
      vi.clearAllMocks();

      // Trigger reconnect which starts WebSocket again
      vi.advanceTimersByTime(5 * 60 * 1000 + 30000);

      // Should only have one heartbeat log per interval
      const heartbeatLogs = (logger.info as any).mock.calls.filter(
        (call: any) => call[1] === 'WebSocket heartbeat monitoring started',
      );

      // Should only start once (not duplicate)
      expect(heartbeatLogs.length).toBeLessThanOrEqual(2); // Initial + 1 reconnect
    });
  });

  describe('connection state', () => {
    it('should mark connected on system callback connect event', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();

      // Get the system callback handler
      const systemHandler = mockRegister.mock.calls.find(
        (call: any) => call[0]['system.call_back_v2'],
      )?.[0]['system.call_back_v2'];

      expect(systemHandler).toBeDefined();

      // Simulate connect event
      await systemHandler({
        event: { type: 'connect' },
      });

      expect(channel.isConnected()).toBe(true);
    });

    it('should mark disconnected on disconnect()', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();
      vi.advanceTimersByTime(5000);

      expect(channel.isConnected()).toBe(true);

      await channel.disconnect();

      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('isBotMentioned', () => {
    it('should detect bot mention by open_id', async () => {
      mockBotInfoResponse();
      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();

      // Get the message handler to trigger message processing
      const messageHandler = mockRegister.mock.calls.find(
        (call: any) => call[0]['im.message.receive_v1'],
      )?.[0]['im.message.receive_v1'];

      const mockMessage = {
        message: {
          message_id: 'msg123',
          chat_id: 'oc_test123',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: 'Hello @Bot' }),
          create_time: Date.now().toString(),
          mentions: [{ id: { open_id: 'ou_bot123' }, name: 'TestBot' }],
        },
        sender: {
          sender_id: { open_id: 'ou_user123' },
          sender_type: 'user',
          tenant_key: 'test',
        },
      };

      await messageHandler(mockMessage);

      // Should mark message as mentioned
      expect(opts.onMessage).toHaveBeenCalledWith(
        'feishu:oc_test123',
        expect.objectContaining({
          is_mentioned: true,
        }),
      );
    });

    it('should fallback to true when botOpenId is unknown', async () => {
      // Mock failed bot info fetch
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const opts = createTestOpts();
      const channel = new FeishuChannel(opts);

      await channel.connect();

      const messageHandler = mockRegister.mock.calls.find(
        (call: any) => call[0]['im.message.receive_v1'],
      )?.[0]['im.message.receive_v1'];

      const mockMessage = {
        message: {
          message_id: 'msg123',
          chat_id: 'oc_test123',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: 'Hello' }),
          create_time: Date.now().toString(),
          mentions: [{ id: { open_id: 'ou_unknown' }, name: 'SomeBot' }],
        },
        sender: {
          sender_id: { open_id: 'ou_user123' },
          sender_type: 'user',
          tenant_key: 'test',
        },
      };

      await messageHandler(mockMessage);

      // Should mark as mentioned (fallback behavior)
      expect(opts.onMessage).toHaveBeenCalledWith(
        'feishu:oc_test123',
        expect.objectContaining({
          is_mentioned: true,
        }),
      );
    });
  });
});
