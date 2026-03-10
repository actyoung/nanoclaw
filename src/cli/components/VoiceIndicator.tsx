import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface VoiceIndicatorProps {
  isRecording: boolean;
  isPlaying: boolean;
  isTranscribing: boolean;
  recordingDuration: number;
  enabled: boolean;
}

const RecordingAnimation: React.FC<{ duration: number }> = ({ duration }) => {
  const [frame, setFrame] = useState(0);
  const frames = ['🔴', '⭕', '🔴', '⭕'];

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box>
      <Text color="red">{frames[frame]}</Text>
      <Text color="red"> Recording... </Text>
      <Text dimColor>({duration}s)</Text>
    </Box>
  );
};

const PlayingAnimation: React.FC = () => {
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text color="cyan"> Speaking...</Text>
    </Box>
  );
};

const TranscribingAnimation: React.FC = () => {
  return (
    <Box>
      <Text color="yellow">
        <Spinner type="dots" />
      </Text>
      <Text color="yellow"> Transcribing...</Text>
    </Box>
  );
};

export const VoiceIndicator: React.FC<VoiceIndicatorProps> = ({
  isRecording,
  isPlaying,
  isTranscribing,
  recordingDuration,
  enabled,
}) => {
  // Show recording state first (highest priority)
  if (isRecording) {
    return (
      <Box marginRight={2}>
        <RecordingAnimation duration={recordingDuration} />
      </Box>
    );
  }

  // Show transcribing state
  if (isTranscribing) {
    return (
      <Box marginRight={2}>
        <TranscribingAnimation />
      </Box>
    );
  }

  // Show playing state
  if (isPlaying) {
    return (
      <Box marginRight={2}>
        <PlayingAnimation />
      </Box>
    );
  }

  // Show muted indicator when TTS is disabled
  if (!enabled) {
    return (
      <Box marginRight={2}>
        <Text dimColor>🔇</Text>
      </Box>
    );
  }

  // Show voice ready indicator
  return (
    <Box marginRight={2}>
      <Text color="green">🎤</Text>
    </Box>
  );
};
