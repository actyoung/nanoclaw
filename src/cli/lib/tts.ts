/**
 * Text-to-Speech module using macOS `say` command or OpenAI TTS API
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';

export interface TTSConfig {
  engine: 'say' | 'openai';
  voiceName?: string;
  openaiApiKey?: string;
  speed?: number; // for 'say' command (0.5 - 2.0)
}

// Default voices for different languages
const DEFAULT_VOICES = {
  zh: 'TingTing', // Chinese
  en: 'Samantha', // English
  ja: 'Kyoko', // Japanese
  default: 'Samantha',
};

/**
 * Detect language from text (simple heuristic)
 */
function detectLanguage(text: string): string {
  // Chinese characters
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
  // Japanese hiragana/katakana
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
  // Default to English
  return 'en';
}

/**
 * Get appropriate voice for text
 */
function getVoiceForText(text: string, preferredVoice?: string): string {
  if (preferredVoice) return preferredVoice;

  const lang = detectLanguage(text);
  return (
    DEFAULT_VOICES[lang as keyof typeof DEFAULT_VOICES] ||
    DEFAULT_VOICES.default
  );
}

/**
 * Check if macOS say command is available
 */
export async function isSayAvailable(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const say = spawn('say', ['--version']);
      say.on('close', (code) => (code === 0 ? resolve() : reject()));
      say.on('error', reject);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of available voices for say command
 */
export async function getAvailableVoices(): Promise<
  Array<{ name: string; language: string; quality: string }>
> {
  return new Promise((resolve, reject) => {
    const say = spawn('say', ['-v', '?']);
    let output = '';

    say.stdout.on('data', (data) => {
      output += data.toString();
    });

    say.on('close', (code) => {
      if (code === 0) {
        const voices = output
          .split('\n')
          .map((line) => {
            // Parse format: "VoiceName    lang    # description"
            const match = line.match(/^(\S+)\s+(\S+)\s+#\s*(.+)$/);
            if (match) {
              return {
                name: match[1],
                language: match[2],
                quality: match[3],
              };
            }
            return null;
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);
        resolve(voices);
      } else {
        resolve([]);
      }
    });

    say.on('error', () => resolve([]));
  });
}

/**
 * Speak text using macOS say command (free, offline)
 */
export async function speakWithSay(
  text: string,
  voice?: string,
  speed = 1.0,
): Promise<{
  stop: () => void;
  waitForEnd: () => Promise<void>;
}> {
  const selectedVoice = getVoiceForText(text, voice);
  const args = ['-v', selectedVoice];

  if (speed !== 1.0) {
    args.push('-r', String(Math.round(200 * speed))); // default rate is 200 wpm
  }

  args.push(text);

  const say = spawn('say', args);

  const waitForEnd = () =>
    new Promise<void>((resolve) => {
      say.on('close', () => resolve());
      say.on('error', () => resolve());
    });

  // Return stop function and wait promise
  return {
    stop: () => {
      say.kill('SIGTERM');
    },
    waitForEnd,
  };
}

/**
 * Speak text using OpenAI TTS API (requires API key)
 */
export async function speakWithOpenAI(
  text: string,
  apiKey: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
): Promise<{
  stop: () => void;
  waitForEnd: () => Promise<void>;
}> {
  const tmpFile = `/tmp/nanoclaw-tts-${Date.now()}.mp3`;

  // Fetch audio from OpenAI
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI TTS error: ${response.status} ${await response.text()}`,
    );
  }

  const audioData = await response.arrayBuffer();
  await fs.writeFile(tmpFile, Buffer.from(audioData));

  // Play audio using afplay (macOS)
  const afplay = spawn('afplay', [tmpFile]);

  const waitForEnd = () =>
    new Promise<void>((resolve) => {
      afplay.on('close', () => {
        fs.unlink(tmpFile).catch(() => {});
        resolve();
      });
      afplay.on('error', () => {
        fs.unlink(tmpFile).catch(() => {});
        resolve();
      });
    });

  // Return stop function and wait promise
  return {
    stop: () => {
      afplay.kill('SIGTERM');
      fs.unlink(tmpFile).catch(() => {});
    },
    waitForEnd,
  };
}

// Track current speaking session
let currentStopFunction: (() => void) | null = null;
let currentWaitForEnd: (() => Promise<void>) | null = null;

/**
 * Main speak function - chooses engine based on config
 */
export async function speak(text: string, config: TTSConfig): Promise<void> {
  // Stop any current speech
  stopSpeaking();

  // Truncate very long text for TTS
  const maxLength = 500;
  const truncatedText =
    text.length > maxLength ? text.slice(0, maxLength) + '...' : text;

  try {
    if (config.engine === 'openai' && config.openaiApiKey) {
      const { stop, waitForEnd } = await speakWithOpenAI(
        truncatedText,
        config.openaiApiKey,
      );
      currentStopFunction = stop;
      currentWaitForEnd = waitForEnd;
    } else {
      // Default to say
      const { stop, waitForEnd } = await speakWithSay(
        truncatedText,
        config.voiceName,
        config.speed,
      );
      currentStopFunction = stop;
      currentWaitForEnd = waitForEnd;
    }

    // Wait for speech to complete
    await currentWaitForEnd();

    // Cleanup
    currentStopFunction = null;
    currentWaitForEnd = null;
  } catch (error) {
    currentStopFunction = null;
    currentWaitForEnd = null;
    throw error;
  }
}

/**
 * Stop current speech
 */
export function stopSpeaking(): void {
  if (currentStopFunction) {
    currentStopFunction();
    currentStopFunction = null;
    currentWaitForEnd = null;
  }
}

/**
 * Check if currently speaking
 */
export function isSpeaking(): boolean {
  return currentStopFunction !== null;
}
