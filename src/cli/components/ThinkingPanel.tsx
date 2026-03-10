import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface ThinkingPanelProps {
  content: string;
  isActive?: boolean;
}

const PulseDot: React.FC = () => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((v) => !v);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return <Text color="cyan">{visible ? '●' : '○'}</Text>;
};

export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({
  content,
  isActive = true,
}) => {
  // Strip ANSI codes if present
  const cleanContent = content.replace(/\x1b\[[0-9;]*m/g, '');

  // Split into lines - display all thinking content
  const lines = cleanContent.split('\n');

  // Calculate stats
  const charCount = cleanContent.length;
  const lineCount = lines.filter((l) => l.trim()).length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {lines.length === 0 || !cleanContent ? (
        <Text dimColor>Waiting for agent...</Text>
      ) : (
        <>
          {/* Stats header */}
          <Box marginBottom={1}>
            <Text dimColor>
              {isActive && <PulseDot />} {lineCount} lines · {charCount} chars
              {isActive && <Text color="yellow"> · live</Text>}
            </Text>
          </Box>
          {/* Content */}
          <Box flexDirection="column">
            {lines.map((line, index) => (
              <Text key={index} dimColor={line.startsWith('>')}>
                {line || ' '}
              </Text>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};
