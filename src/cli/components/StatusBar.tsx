import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Status } from '../types.js';
import { useElapsedTime, formatDuration } from '../hooks/useElapsedTime.js';

interface StatusBarProps {
  status: Status;
  group: string | null;
}

const PulseIndicator: React.FC = () => {
  const [frame, setFrame] = useState(0);
  const frames = ['◐', '◓', '◑', '◒'];

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return <Text color="cyan">{frames[frame]}</Text>;
};

export const StatusBar: React.FC<StatusBarProps> = ({ status, group }) => {
  const elapsed = useElapsedTime(status !== 'idle');

  return (
    <Box paddingY={1}>
      {status === 'idle' ? (
        <Text color="green">● ready</Text>
      ) : (
        <Box>
          <Text color="cyan">
            {status === 'starting' ? (
              <Spinner type="dots" />
            ) : (
              <PulseIndicator />
            )}
          </Text>
          <Text color={status === 'starting' ? 'yellow' : 'cyan'}>
            {' '}
            {status === 'starting' ? '⚡ starting container' : '🤔 thinking'}
          </Text>
          <Text dimColor> ({formatDuration(elapsed)})</Text>
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
