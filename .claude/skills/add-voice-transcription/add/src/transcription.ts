import { logger } from './logger.js';
import { readEnvFile } from './env.js';

interface TranscriptionConfig {
  model: string;
  enabled: boolean;
  fallbackMessage: string;
}

const DEFAULT_CONFIG: TranscriptionConfig = {
  model: 'whisper-1',
  enabled: true,
  fallbackMessage: '[Voice Message - transcription unavailable]',
};

/**
 * Download audio file from Feishu Message Resource API
 * https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get
 */
async function downloadFeishuAudio(
  messageId: string,
  fileKey: string,
  tenantAccessToken: string,
): Promise<Buffer | null> {
  try {
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=audio`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
      },
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, messageId, fileKey },
        'Failed to download Feishu audio',
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    logger.info(
      { size: buffer.length, messageId },
      'Downloaded Feishu audio message',
    );
    return buffer;
  } catch (err) {
    logger.error({ err, messageId, fileKey }, 'Error downloading Feishu audio');
    return null;
  }
}

/**
 * Get tenant access token for Feishu API
 */
async function getTenantAccessToken(
  appId: string,
  appSecret: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );

    const data = (await response.json()) as {
      code: number;
      tenant_access_token?: string;
    };

    if (data.code !== 0 || !data.tenant_access_token) {
      logger.warn({ code: data.code }, 'Failed to get tenant access token');
      return null;
    }

    return data.tenant_access_token;
  } catch (err) {
    logger.error({ err }, 'Error getting tenant access token');
    return null;
  }
}

async function transcribeWithOpenAI(
  audioBuffer: Buffer,
  config: TranscriptionConfig,
): Promise<string | null> {
  const env = readEnvFile(['OPENAI_API_KEY']);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set in .env');
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({ apiKey });

    const file = await toFile(audioBuffer, 'voice.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: config.model,
      response_format: 'text',
    });

    // When response_format is 'text', the API returns a plain string
    return transcription as unknown as string;
  } catch (err) {
    logger.error({ err }, 'OpenAI transcription failed');
    return null;
  }
}

interface FeishuVoiceContent {
  file_key: string;
  file_name?: string;
  duration?: number;
}

export interface FeishuVoiceMessage {
  message_id: string;
  message_type: string;
  content: string;
}

/**
 * Transcribe a Feishu voice message
 */
export async function transcribeFeishuVoiceMessage(
  message: FeishuVoiceMessage,
  appId: string,
  appSecret: string,
): Promise<string | null> {
  const config = DEFAULT_CONFIG;

  if (!config.enabled) {
    return config.fallbackMessage;
  }

  // Parse voice content
  let voiceContent: FeishuVoiceContent;
  try {
    const parsed = JSON.parse(message.content);
    voiceContent = parsed;
  } catch {
    logger.warn({ content: message.content }, 'Failed to parse voice message content');
    return config.fallbackMessage;
  }

  if (!voiceContent.file_key) {
    logger.warn('Voice message missing file_key');
    return config.fallbackMessage;
  }

  // Get tenant access token
  const token = await getTenantAccessToken(appId, appSecret);
  if (!token) {
    return config.fallbackMessage;
  }

  // Download audio file
  const buffer = await downloadFeishuAudio(
    message.message_id,
    voiceContent.file_key,
    token,
  );

  if (!buffer || buffer.length === 0) {
    return config.fallbackMessage;
  }

  // Transcribe with OpenAI
  const transcript = await transcribeWithOpenAI(buffer, config);

  if (!transcript) {
    return config.fallbackMessage;
  }

  logger.info(
    { messageId: message.message_id, transcriptLength: transcript.length },
    'Transcribed voice message',
  );

  return transcript.trim();
}

/**
 * Check if message is a voice/audio message
 */
export function isVoiceMessage(messageType: string, content: string): boolean {
  if (messageType !== 'audio') {
    return false;
  }

  // Try to parse content to verify it has voice file info
  try {
    const parsed = JSON.parse(content);
    return !!parsed.file_key;
  } catch {
    return false;
  }
}
