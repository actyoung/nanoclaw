/**
 * Voice recording and transcription module using whisper.cpp
 * Free, local, offline speech-to-text
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import { promises as fs } from 'fs';
import { PROJECT_ROOT } from '../../config.js';

const WHISPER_MODEL = resolve(PROJECT_ROOT, 'data/models/ggml-base.bin');

export interface RecordingSession {
  stop: () => void;
  waitForStop: () => Promise<string>;
}

/**
 * Check if whisper.cpp is installed and model exists
 */
export async function checkVoiceSetup(): Promise<{
  ffmpeg: boolean;
  whisper: boolean;
  model: boolean;
}> {
  const results = { ffmpeg: false, whisper: false, model: false };

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject()));
      ffmpeg.on('error', reject);
    });
    results.ffmpeg = true;
  } catch {
    // ffmpeg not available
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const whisper = spawn('whisper-cli', ['--help']);
      whisper.on('close', (code) => (code === 0 ? resolve() : reject()));
      whisper.on('error', reject);
    });
    results.whisper = true;
  } catch {
    // whisper-cli not available
  }

  try {
    await fs.access(WHISPER_MODEL);
    results.model = true;
  } catch {
    // model file not found
  }

  return results;
}

/**
 * Get whisper model path, creating directory if needed
 */
export function getWhisperModelPath(): string {
  return WHISPER_MODEL;
}

/**
 * Start recording audio using ffmpeg
 * Returns a function to stop recording
 */
export async function startRecording(
  outputPath: string,
): Promise<RecordingSession> {
  const ffmpeg = spawn('ffmpeg', [
    '-f',
    'avfoundation', // macOS audio framework
    '-i',
    ':0', // default microphone
    '-ar',
    '16000', // 16kHz (whisper requires)
    '-ac',
    '1', // mono
    '-c:a',
    'pcm_s16le', // 16-bit PCM
    '-y', // overwrite file
    outputPath,
  ]);

  let stderr = '';
  ffmpeg.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  const stopPromise = new Promise<string>((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0 || code === 255) {
        // 255 is SIGTERM exit code
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
    ffmpeg.on('error', (err) => reject(err));
  });

  return {
    stop: () => {
      ffmpeg.kill('SIGTERM');
    },
    waitForStop: () => stopPromise,
  };
}

/**
 * Transcribe audio using local whisper.cpp
 */
export async function transcribeWithWhisper(
  audioPath: string,
): Promise<string | null> {
  // Check if model exists
  try {
    await fs.access(WHISPER_MODEL);
  } catch {
    throw new Error(
      `Whisper model not found at ${WHISPER_MODEL}. ` +
        'Run: mkdir -p data/models && curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o data/models/ggml-base.bin',
    );
  }

  return new Promise((resolve, reject) => {
    const whisper = spawn('whisper-cli', [
      '-m',
      WHISPER_MODEL,
      '-f',
      audioPath,
      '-l',
      'auto', // auto detect language
      '--output-txt', // output plain text
      '-of',
      '-', // output to stdout
    ]);

    let output = '';
    let errorOutput = '';

    whisper.stdout.on('data', (data) => {
      output += data.toString();
    });

    whisper.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    whisper.on('close', (code) => {
      if (code === 0) {
        // Clean up the output (remove timestamps if present)
        const lines = output.split('\n');
        const textLines = lines
          .map((line) => {
            // Remove timestamp patterns like [00:00:00.000 --> 00:00:05.000]
            return line.replace(
              /^\[\d{2}:\d{2}:\d{2}\.\d+\s*-->\s*\d{2}:\d{2}:\d{2}\.\d+\]\s*/,
              '',
            );
          })
          .filter((line) => line.trim().length > 0);

        resolve(textLines.join(' ').trim() || null);
      } else {
        reject(
          new Error(`whisper-cli exited with code ${code}: ${errorOutput}`),
        );
      }
    });

    whisper.on('error', (err) => {
      reject(new Error(`Failed to run whisper-cli: ${err.message}`));
    });
  });
}

/**
 * Full voice recording and transcription flow
 */
export async function recordAndTranscribe(
  onStatusUpdate?: (
    status: 'recording' | 'transcribing' | 'done' | 'error',
    message?: string,
  ) => void,
): Promise<string | null> {
  const tmpFile = `/tmp/nanoclaw-voice-${Date.now()}.wav`;

  try {
    // Start recording
    onStatusUpdate?.('recording');
    const session = await startRecording(tmpFile);

    // Wait for recording to stop (caller must call session.stop())
    await session.waitForStop();

    // Check if file exists and has content
    const stats = await fs.stat(tmpFile).catch(() => null);
    if (!stats || stats.size < 1000) {
      // Less than 1KB, probably no audio
      await fs.unlink(tmpFile).catch(() => {});
      return null;
    }

    // Transcribe
    onStatusUpdate?.('transcribing');
    const transcript = await transcribeWithWhisper(tmpFile);

    // Cleanup
    await fs.unlink(tmpFile).catch(() => {});

    onStatusUpdate?.('done');
    return transcript;
  } catch (error) {
    onStatusUpdate?.(
      'error',
      error instanceof Error ? error.message : String(error),
    );
    // Cleanup on error
    await fs.unlink(tmpFile).catch(() => {});
    throw error;
  }
}
