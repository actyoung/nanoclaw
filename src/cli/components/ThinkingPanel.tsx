import React from 'react';
import { Box, Text } from 'ink';

interface ThinkingPanelProps {
  content: string;
}

export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({ content }) => {
  // Strip ANSI codes if present
  const cleanContent = content.replace(/\x1b\[[0-9;]*m/g, '');

  // Split into lines and limit display
  const lines = cleanContent.split('\n').slice(-50); // Keep last 50 lines

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {lines.length === 0 || !cleanContent ? (
        <Text dimColor>Waiting for agent...</Text>
      ) : (
        lines.map((line, index) => (
          <Text key={index} dimColor={line.startsWith('>')}>
            {line || ' '}
          </Text>
        ))
      )}
    </Box>
  );
};
