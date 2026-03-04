import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useIPC } from '../hooks/useIPC.js';
import { Header } from './Header.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { Help } from './Help.js';
import { AgentEvent, Message, GroupInfo } from '../types.js';

const CLI_MAIN_JID = 'cli:main';
const CLI_MAIN_FOLDER = 'cli-main';

export const App: React.FC = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'idle' | 'starting' | 'processing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Group selection state
  const [cliGroups, setCliGroups] = useState<GroupInfo[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [selectorIndex, setSelectorIndex] = useState(0);

  const handleEvent = useCallback((event: AgentEvent) => {
    // Only show messages from the currently selected group
    if (selectedGroup && event.groupJid !== selectedGroup.jid) return;

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
              groupJid: event.groupJid,
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
            groupJid: event.groupJid,
          },
        ]);
        break;
      }
    }
  }, [selectedGroup]);

  const { connected, sendMessage, listGroups } = useIPC({
    onEvent: handleEvent,
    onError: setError,
  });

  // Fetch CLI groups on connect
  useEffect(() => {
    if (connected) {
      listGroups().then((groups) => {
        setCliGroups(groups);
        if (groups.length === 0) {
          // No CLI groups available - use default
          setSelectedGroup({
            jid: CLI_MAIN_JID,
            name: 'CLI Main',
            folder: CLI_MAIN_FOLDER,
          });
        } else if (groups.length === 1) {
          // Only one group - use it directly
          setSelectedGroup(groups[0]);
        } else {
          // Multiple groups - show selector
          setShowGroupSelector(true);
        }
      });
    }
  }, [connected, listGroups]);

  const handleSubmit = useCallback(
    (text: string) => {
      // Handle commands
      if (text.startsWith('/')) {
        const [cmd, ...args] = text.slice(1).split(' ');
        switch (cmd) {
          case 'help':
            setShowHelp(true);
            return;
          case 'exit':
          case 'quit':
            exit();
            return;
          case 'groups': {
            // Refresh and show group selector
            listGroups().then((groups) => {
              setCliGroups(groups);
              setShowGroupSelector(true);
              setSelectorIndex(0);
            });
            return;
          }
          case 'switch': {
            const folder = args[0];
            if (!folder) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  type: 'received',
                  sender: 'system',
                  content: 'Usage: /switch <folder> (e.g., /switch cli-dev)',
                  timestamp: Date.now(),
                },
              ]);
              return;
            }
            // Find group by folder
            const targetGroup = cliGroups.find((g) => g.folder === folder);
            if (targetGroup) {
              setSelectedGroup(targetGroup);
              setMessages([]); // Clear messages when switching
              setMessages((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  type: 'received',
                  sender: 'system',
                  content: `Switched to ${targetGroup.name} (${targetGroup.folder})`,
                  timestamp: Date.now(),
                },
              ]);
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  type: 'received',
                  sender: 'system',
                  content: `Group not found: ${folder}. Use /groups to list available groups.`,
                  timestamp: Date.now(),
                },
              ]);
            }
            return;
          }
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

      if (!selectedGroup) {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            type: 'received',
            sender: 'system',
            content: 'No group selected. Use /groups to select a group.',
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // Send message to selected CLI group
      // Add user message to local display immediately
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          type: 'sent',
          sender: 'you',
          content: text,
          timestamp: Date.now(),
          groupJid: selectedGroup.jid,
        },
      ]);
      sendMessage(text, selectedGroup.folder);
    },
    [sendMessage, exit, selectedGroup, cliGroups, listGroups],
  );

  // Global keyboard shortcuts
  useInput((_input, key) => {
    if (showGroupSelector) {
      if (key.upArrow) {
        setSelectorIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectorIndex((prev) => Math.min(cliGroups.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        setSelectedGroup(cliGroups[selectorIndex]);
        setShowGroupSelector(false);
        return;
      }
      return;
    }

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

  // Group selector state
  if (showGroupSelector && cliGroups.length > 0) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text bold>Select CLI Group:</Text>
        <Box marginY={1} flexDirection="column">
          {cliGroups.map((group, index) => (
            <Box key={group.jid}>
              <Text
                color={index === selectorIndex ? 'green' : undefined}
                bold={index === selectorIndex}
              >
                {index === selectorIndex ? '> ' : '  '}
                {group.name} ({group.folder})
              </Text>
            </Box>
          ))}
        </Box>
        <Text dimColor>Use ↑/↓ to select, Enter to confirm</Text>
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

      <StatusBar
        status={status}
        group={selectedGroup?.folder || 'none'}
      />
      <InputBox
        onSubmit={handleSubmit}
        currentGroup={selectedGroup?.folder ?? null}
        disabled={showHelp}
      />
    </Box>
  );
};
