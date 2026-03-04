import React from 'react';
import { Box, Text } from 'ink';

interface HelpProps {
  onClose: () => void;
}

export const Help: React.FC<HelpProps> = () => {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" padding={1}>
      <Text bold>Commands</Text>
      <Box marginY={1} flexDirection="column">
        <Text>/use {'<folder>'}  Select a group</Text>
        <Text>/groups           List all groups</Text>
        <Text>/help             Show this help</Text>
        <Text>/exit             Exit CLI</Text>
      </Box>
      <Text bold>Tips</Text>
      <Box marginY={1} flexDirection="column">
        <Text>• Enter to send message</Text>
        <Text>• Shift+Enter for new line (multiline mode)</Text>
        <Text>• Ctrl+G to open group selector</Text>
        <Text>• Ctrl+H to show help</Text>
        <Text>• Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};
