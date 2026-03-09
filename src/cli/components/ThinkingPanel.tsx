import React from 'react';
import { Box, Text } from 'ink';

interface ThinkingPanelProps {
  content: string;
}

export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({ content }) => {
  // Strip ANSI codes if present
  const cleanContent = content.replace(/\x1b\[[0-9;]*m/g, '');

  // Split into lines - display all thinking content
  const lines = cleanContent.split('\n');

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
