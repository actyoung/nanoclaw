import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useIPC } from '../hooks/useIPC.js';
import { Header } from './Header.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { Help } from './Help.js';
import { AgentEvent, Message, Status } from '../types.js';

const CLI_GROUP_JID = 'cli:internal:main';
const CLI_GROUP_FOLDER = 'cli-main';

export const App: React.FC = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const handleEvent = useCallback((event: AgentEvent) => {
    // Only show messages from CLI group
    if (event.groupJid !== CLI_GROUP_JID) return;

    switch (event.type) {
      case 'container:started':
        setStatus('starting');
        break;
      case 'container:output':
        setStatus('processing');
        break;
      case 'container:idle':
        setStatus('idle');
        break;
      case 'container:closed':
        setStatus('idle');
        break;
      case 'message:received': {
        // Message from CLI channel
        const data = event.data as {
          sender_name: string;
          content: string;
          is_from_me?: boolean;
        };
        if (!data.is_from_me) {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              type: 'received',
              sender: data.sender_name,
              content: data.content,
              timestamp: Date.now(),
            },
          ]);
        }
        break;
      }
      case 'message:sent': {
        // Agent reply - show as incoming from agent
        const text = typeof event.data === 'string' ? event.data : '';
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            type: 'received',
            sender: 'agent',
            content: text,
            timestamp: Date.now(),
          },
        ]);
        break;
      }
    }
  }, []);

  const { connected, sendMessage } = useIPC({
    onEvent: handleEvent,
    onError: setError,
  });

  const handleSubmit = useCallback(
    (text: string) => {
      // Handle commands
      if (text.startsWith('/')) {
        const [cmd] = text.slice(1).split(' ');
        switch (cmd) {
          case 'help':
            setShowHelp(true);
            return;
          case 'exit':
          case 'quit':
            exit();
            return;
          default:
            setMessages((prev) => [
              ...prev,
              {
                id: `${Date.now()}-${Math.random()}`,
                type: 'received',
                sender: 'system',
                content: `Unknown command: /${cmd}. Type /help for available commands.`,
                timestamp: Date.now(),
              },
            ]);
            return;
        }
      }

      // Send message to CLI group
      // Add user message to local display immediately
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          type: 'sent',
          sender: 'you',
          content: text,
          timestamp: Date.now(),
        },
      ]);
      sendMessage(text);
    },
    [sendMessage, exit],
  );

  // Global keyboard shortcuts
  useInput((_input, key) => {
    if (showHelp) {
      if (key.escape) {
        setShowHelp(false);
      }
      return;
    }

    if (key.ctrl && _input === 'h') {
      setShowHelp(true);
    }
  });

  // Error state
  if (error) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      <Header connected={connected} />

      {showHelp ? (
        <Box flexGrow={1}>
          <Help onClose={() => setShowHelp(false)} />
        </Box>
      ) : (
        <MessageList messages={messages} />
      )}

      <StatusBar status={status} group={CLI_GROUP_FOLDER} />
      <InputBox
        onSubmit={handleSubmit}
        currentGroup={CLI_GROUP_FOLDER}
        disabled={showHelp}
      />
    </Box>
  );
};
