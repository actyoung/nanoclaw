import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('voice-transcription skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    expect(content).toContain('skill: voice-transcription');
    expect(content).toContain('version: 1.0.0');
    expect(content).toContain('openai');
    expect(content).toContain('OPENAI_API_KEY');
  });

  it('has all files declared in adds', () => {
    const transcriptionFile = path.join(skillDir, 'add', 'src', 'transcription.ts');
    expect(fs.existsSync(transcriptionFile)).toBe(true);

    const content = fs.readFileSync(transcriptionFile, 'utf-8');
    expect(content).toContain('transcribeFeishuVoiceMessage');
    expect(content).toContain('isVoiceMessage');
    expect(content).toContain('transcribeWithOpenAI');
    expect(content).toContain('downloadFeishuAudio');
    expect(content).toContain('readEnvFile');
  });

  it('has all files declared in modifies', () => {
    const feishuFile = path.join(skillDir, 'modify', 'src', 'channels', 'feishu.ts');
    const feishuTestFile = path.join(skillDir, 'modify', 'src', 'channels', 'feishu.test.ts');

    expect(fs.existsSync(feishuFile)).toBe(true);
    expect(fs.existsSync(feishuTestFile)).toBe(true);
  });

  it('has intent files for modified files', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify', 'src', 'channels', 'feishu.ts.intent.md'))).toBe(true);
  });

  it('modified feishu.ts preserves core structure', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'channels', 'feishu.ts'),
      'utf-8',
    );

    // Core class and methods preserved
    expect(content).toContain('class FeishuChannel');
    expect(content).toContain('implements Channel');
    expect(content).toContain('async connect()');
    expect(content).toContain('async sendMessage(');
    expect(content).toContain('isConnected()');
    expect(content).toContain('ownsJid(');
    expect(content).toContain('async disconnect()');
    expect(content).toContain('async setTyping(');
    expect(content).toContain('async syncGroupMetadata(');
    expect(content).toContain('private async flushOutgoingQueue(');

    // Core imports preserved
    expect(content).toContain('Lark');
    expect(content).toContain('FEISHU_APP_ID');
    expect(content).toContain('FEISHU_APP_SECRET');
    expect(content).toContain('registerChannel');
  });

  it('modified feishu.ts includes transcription integration', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'channels', 'feishu.ts'),
      'utf-8',
    );

    // Transcription imports
    expect(content).toContain("import {");
    expect(content).toContain("isVoiceMessage,");
    expect(content).toContain("transcribeFeishuVoiceMessage,");

    // Voice message handling
    expect(content).toContain('isVoiceMessage(message.message_type, message.content)');
    expect(content).toContain('transcribeFeishuVoiceMessage(');
    expect(content).toContain('[Voice:');
    expect(content).toContain('[Voice Message - transcription unavailable]');
  });

  it('modified feishu.test.ts includes transcription tests', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'channels', 'feishu.test.ts'),
      'utf-8',
    );

    // Transcription mock
    expect(content).toContain("vi.mock('../transcription.js'");
    expect(content).toContain('isVoiceMessage');

    // Voice transcription test cases
    expect(content).toContain('voice message detection');
    expect(content).toContain('detects audio message type');
    expect(content).toContain('returns false for text message type');
  });
});
