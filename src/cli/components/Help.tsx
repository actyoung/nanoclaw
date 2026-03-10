import React from 'react';
import { Box, Text } from 'ink';

interface HelpProps {
  onClose: () => void;
}

export const Help: React.FC<HelpProps> = () => {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      padding={1}
    >
      <Text bold>Commands</Text>
      <Box marginY={1} flexDirection="column">
        <Text>/help Show this help</Text>
        <Text>/exit Exit CLI</Text>
        <Text>/groups List and select CLI groups</Text>
        <Text>/switch &lt;folder&gt; Switch to a specific group</Text>
      </Box>
      <Text bold>Voice Commands</Text>
      <Box marginY={1} flexDirection="column">
        <Text>/voice on Enable text-to-speech</Text>
        <Text>/voice off Disable text-to-speech</Text>
        <Text>/voice status Show voice settings</Text>
        <Text>Ctrl+R Hold to record voice input</Text>
      </Box>
      <Text bold>Tips</Text>
      <Box marginY={1} flexDirection="column">
        <Text>• Enter to send message</Text>
        <Text>• Shift+Enter for new line (multiline mode)</Text>
        <Text>• Ctrl+H to show help</Text>
        <Text>• Ctrl+C to exit</Text>
        <Text>• Hold Ctrl+R to record, release to transcribe</Text>
      </Box>
      <Text dimColor>Voice requires: brew install ffmpeg whisper-cpp</Text>
      <Text dimColor>
        Model: curl -L
        https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
        -o data/models/ggml-base.bin
      </Text>
    </Box>
  );
};
