/**
 * Voice functionality hook for CLI
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceState, VoiceConfig } from '../types.js';
import {
  startRecording,
  transcribeWithWhisper,
  checkVoiceSetup,
} from '../lib/voiceRecorder.js';
import { speak, stopSpeaking, TTSConfig } from '../lib/tts.js';

interface UseVoiceOptions {
  config: VoiceConfig;
  onTranscript?: (text: string) => void;
}

export function useVoice({ config, onTranscript }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>({
    isRecording: false,
    isPlaying: false,
    enabled: config.outputEnabled,
    recordingDuration: 0,
    isTranscribing: false,
  });

  const [setupStatus, setSetupStatus] = useState<{
    ffmpeg: boolean;
    whisper: boolean;
    model: boolean;
  } | null>(null);

  const recordingSessionRef = useRef<{
    stop: () => void;
    waitForStop: () => Promise<string>;
  } | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);

  // Check setup on mount
  useEffect(() => {
    checkVoiceSetup().then(setSetupStatus);
  }, []);

  // Update enabled state when config changes
  useEffect(() => {
    setState((prev) => ({ ...prev, enabled: config.outputEnabled }));
  }, [config.outputEnabled]);

  /**
   * Start recording voice input
   */
  const startRecordingVoice = useCallback(async (): Promise<void> => {
    if (state.isRecording || state.isTranscribing) return;

    // Check setup
    const setup = await checkVoiceSetup();
    setSetupStatus(setup);

    if (!setup.ffmpeg) {
      throw new Error('ffmpeg not found. Install with: brew install ffmpeg');
    }
    if (!setup.whisper) {
      throw new Error(
        'whisper-cpp not found. Install with: brew install whisper-cpp',
      );
    }
    if (!setup.model) {
      throw new Error(
        'Whisper model not found. Download with: ' +
          'mkdir -p data/models && curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o data/models/ggml-base.bin',
      );
    }

    const tmpFile = `/tmp/nanoclaw-voice-${Date.now()}.wav`;

    try {
      const session = await startRecording(tmpFile);
      recordingSessionRef.current = session;
      recordingStartTimeRef.current = Date.now();

      setState((prev) => ({
        ...prev,
        isRecording: true,
        recordingDuration: 0,
      }));

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          recordingDuration: Math.floor(
            (Date.now() - recordingStartTimeRef.current) / 1000,
          ),
        }));
      }, 1000);
    } catch (error) {
      throw new Error(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [state.isRecording, state.isTranscribing]);

  /**
   * Stop recording and transcribe
   */
  const stopRecordingVoice = useCallback(async (): Promise<string | null> => {
    if (!recordingSessionRef.current || !state.isRecording) {
      return null;
    }

    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop recording
    recordingSessionRef.current.stop();

    setState((prev) => ({
      ...prev,
      isRecording: false,
      isTranscribing: true,
    }));

    try {
      const audioPath = await recordingSessionRef.current.waitForStop();
      recordingSessionRef.current = null;

      const transcript = await transcribeWithWhisper(audioPath);

      setState((prev) => ({
        ...prev,
        isTranscribing: false,
        recordingDuration: 0,
      }));

      if (transcript && onTranscript) {
        onTranscript(transcript);
      }

      return transcript;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isTranscribing: false,
        recordingDuration: 0,
      }));
      recordingSessionRef.current = null;
      throw error;
    }
  }, [state.isRecording, onTranscript]);

  /**
   * Cancel recording without transcribing
   */
  const cancelRecording = useCallback((): void => {
    if (recordingSessionRef.current) {
      recordingSessionRef.current.stop();
      recordingSessionRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      isRecording: false,
      isTranscribing: false,
      recordingDuration: 0,
    }));
  }, []);

  /**
   * Speak text using TTS (non-blocking, auto-interrupts previous)
   */
  const speakText = useCallback(
    (text: string): void => {
      if (!config.outputEnabled || !state.enabled) return;

      // Stop any current speech immediately and abort previous tracking
      stopSpeaking();
      ttsAbortControllerRef.current?.abort();

      const abortController = new AbortController();
      ttsAbortControllerRef.current = abortController;

      setState((prev) => ({ ...prev, isPlaying: true }));

      const ttsConfig: TTSConfig = {
        engine: config.outputEngine,
        voiceName: config.voiceName,
        openaiApiKey: config.openaiApiKey,
        speed: 1.0,
      };

      // Start speaking in background (non-blocking)
      speak(text, ttsConfig)
        .then(() => {
          // Only update state if not aborted (i.e., no newer speech started)
          if (!abortController.signal.aborted) {
            setState((prev) => ({ ...prev, isPlaying: false }));
          }
        })
        .catch(() => {
          if (!abortController.signal.aborted) {
            setState((prev) => ({ ...prev, isPlaying: false }));
          }
        });
    },
    [config, state.enabled],
  );

  /**
   * Stop current speech
   */
  const stopSpeech = useCallback((): void => {
    stopSpeaking();
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  /**
   * Toggle TTS enabled state
   */
  const toggleEnabled = useCallback((): boolean => {
    const newEnabled = !state.enabled;
    setState((prev) => ({ ...prev, enabled: newEnabled }));
    return newEnabled;
  }, [state.enabled]);

  /**
   * Set TTS enabled state
   */
  const setEnabled = useCallback((enabled: boolean): void => {
    setState((prev) => ({ ...prev, enabled }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (recordingSessionRef.current) {
        recordingSessionRef.current.stop();
      }
      stopSpeaking();
    };
  }, []);

  return {
    state,
    setupStatus,
    startRecordingVoice,
    stopRecordingVoice,
    cancelRecording,
    speakText,
    stopSpeech,
    toggleEnabled,
    setEnabled,
    isReady: setupStatus
      ? setupStatus.ffmpeg && setupStatus.whisper && setupStatus.model
      : false,
  };
}
