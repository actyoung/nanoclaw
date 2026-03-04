import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  connected: boolean;
}

export const Header: React.FC<HeaderProps> = ({ connected }) => {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      justifyContent="space-between"
    >
      <Box>
        <Text>🤖 </Text>
        <Text bold>NanoClaw CLI</Text>
      </Box>
      <Text color={connected ? 'green' : 'red'}>
        {connected ? '●' : '○'} {connected ? 'connected' : 'disconnected'}
      </Text>
    </Box>
  );
};
