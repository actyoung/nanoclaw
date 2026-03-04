import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Status } from '../types.js';

interface StatusBarProps {
  status: Status;
  group: string | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ status, group }) => {
  return (
    <Box paddingY={1}>
      {status === 'idle' ? (
        <Text color="green">● ready</Text>
      ) : (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> {status === 'starting' ? 'starting' : 'thinking'}</Text>
        </Box>
      )}
      {group && (
        <Text dimColor>
          {' '}
          in <Text bold>{group}</Text>
        </Text>
      )}
    </Box>
  );
};
