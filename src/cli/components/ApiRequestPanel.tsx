import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface ApiRequestPanelProps {
  model?: string;
  messageCount?: number;
  maxTokens?: number;
  firstMessagePreview?: string;
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

  return <Text color="yellow">{visible ? '●' : '○'}</Text>;
};

export const ApiRequestPanel: React.FC<ApiRequestPanelProps> = ({
  model,
  messageCount,
  maxTokens,
  firstMessagePreview,
  isActive = true,
}): React.ReactElement => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text dimColor>
          {isActive && <PulseDot />}{' '}
          <Text color="yellow" bold>
            API Request
          </Text>
          {isActive && <Text color="magenta"> · in flight</Text>}
        </Text>
      </Box>

      <Box flexDirection="column">
        {model && (
          <Box>
            <Text color="magenta">Model: </Text>
            <Text>{model}</Text>
          </Box>
        )}
        {messageCount !== undefined && (
          <Box>
            <Text color="magenta">Messages: </Text>
            <Text>{messageCount}</Text>
          </Box>
        )}
        {maxTokens !== undefined && (
          <Box>
            <Text color="magenta">Max Tokens: </Text>
            <Text>{maxTokens}</Text>
          </Box>
        )}
        {firstMessagePreview && (
          <Box marginTop={1} flexDirection="column">
            <Text color="magenta">Preview:</Text>
            <Text dimColor>{firstMessagePreview}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
