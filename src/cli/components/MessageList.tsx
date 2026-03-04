import React from 'react';
import { Box, Text } from 'ink';
import { Message } from '../types.js';

interface MessageListProps {
  messages: Message[];
  maxHeight?: number;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  maxHeight = 20,
}) => {
  // Show last N messages to fit in terminal
  const visibleMessages = messages.slice(-maxHeight);

  if (messages.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingY={1}>
        <Text dimColor>
          No messages yet. Use /use {'<folder>'} to select a group.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingY={1}>
      {visibleMessages.map((message) => {
        // Agent replies use › (pointing right), user messages use ‹ (pointing left)
        const isAgent = message.sender === 'agent';
        return (
          <Box key={message.id} flexDirection="column" marginBottom={1}>
            {isAgent ? (
              // Agent reply - right side with magenta indicator
              <Box>
                <Text color="magenta">› </Text>
                <Text bold>agent</Text>
              </Box>
            ) : (
              // User message (CLI or other channels) - left side with blue indicator
              <Box>
                <Text color="blue">‹ </Text>
                <Text bold>{message.sender || 'you'}</Text>
              </Box>
            )}
            <Box paddingLeft={2}>
              <Text wrap="wrap">{message.content}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
