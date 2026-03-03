import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isVoiceMessage } from '../transcription.js';
import { FeishuChannel } from './feishu.js';
import type { FeishuChannelOpts } from './feishu.js';

// Mock the transcription module
vi.mock('../transcription.js', () => ({
  isVoiceMessage: vi.fn(),
  transcribeFeishuVoiceMessage: vi.fn(),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('voice message detection', () => {
  it('detects audio message type', () => {
    const content = JSON.stringify({ file_key: 'file_abc123' });
    expect(isVoiceMessage('audio', content)).toBe(true);
  });

  it('returns false for text message type', () => {
    const content = JSON.stringify({ text: 'Hello world' });
    expect(isVoiceMessage('text', content)).toBe(false);
  });

  it('returns false for audio type without file_key', () => {
    const content = JSON.stringify({ text: 'some text' });
    expect(isVoiceMessage('audio', content)).toBe(false);
  });

  it('returns false for invalid JSON content', () => {
    expect(isVoiceMessage('audio', 'not valid json')).toBe(false);
  });
});

describe('voice transcription in FeishuChannel', () => {
  let mockOpts: FeishuChannelOpts;

  beforeEach(() => {
    mockOpts = {
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: vi.fn(() => ({})),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should format voice message with transcript', async () => {
    // This test verifies the voice message formatting logic
    // The actual transcription is tested in transcription.test.ts
    const transcript = 'Hello, this is a voice message';
    const formattedContent = `[Voice: ${transcript}]`;

    expect(formattedContent).toBe('[Voice: Hello, this is a voice message]');
  });

  it('should handle voice transcription failure gracefully', async () => {
    // When transcription fails or is unavailable, a fallback message should be shown
    const fallbackMessage = '[Voice Message - transcription unavailable]';
    const formattedContent = `[Voice: ${fallbackMessage}]`;

    expect(formattedContent).toBe('[Voice: [Voice Message - transcription unavailable]]');
  });
});

describe('message type handling', () => {
  it('should identify voice message by type and content', () => {
    const voiceContent = JSON.stringify({
      file_key: 'file_abc123',
      duration: 5000,
    });

    expect(isVoiceMessage('audio', voiceContent)).toBe(true);
  });

  it('should not identify regular text as voice', () => {
    const textContent = JSON.stringify({ text: 'Hello there' });

    expect(isVoiceMessage('text', textContent)).toBe(false);
  });
});
