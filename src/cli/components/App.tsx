import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useIPC } from '../hooks/useIPC.js';
import { Header } from './Header.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { GroupSelector } from './GroupSelector.js';
import { Help } from './Help.js';
import { AgentEvent, GroupInfo, Message, Status } from '../types.js';

export const App: React.FC = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [currentGroupJid, setCurrentGroupJid] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const currentGroup = useMemo(() => {
    return groups.find((g) => g.jid === currentGroupJid)?.folder ?? null;
  }, [groups, currentGroupJid]);

  const handleEvent = useCallback((event: AgentEvent) => {

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
        // Message from other channels (Feishu, etc.) - show as incoming
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
  }, [groups]);

  const { connected, sendMessage } = useIPC({
    onEvent: handleEvent,
    onGroupsList: setGroups,
    onError: setError,
  });

  const handleSubmit = useCallback(
    (text: string) => {
      // Handle commands
      if (text.startsWith('/')) {
        const [cmd, ...args] = text.slice(1).split(' ');
        switch (cmd) {
          case 'use':
            if (args[0]) {
              const group = groups.find((g) => g.folder === args[0]);
              if (group) {
                setCurrentGroupJid(group.jid);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    type: 'received',
                    sender: 'system',
                    content: `Switched to ${group.name}`,
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
                    content: `Group not found: ${args[0]}`,
                    timestamp: Date.now(),
                  },
                ]);
              }
            }
            return;
          case 'groups':
            setShowGroupSelector(true);
            return;
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

      // Send message
      if (currentGroupJid) {
        // Add user message to local display immediately
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            type: 'sent',
            sender: 'you',
            content: text,
            timestamp: Date.now(),
            groupJid: currentGroupJid,
          },
        ]);
        sendMessage(text, currentGroupJid);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            type: 'received',
            sender: 'system',
            content: 'No group selected. Use /groups or /use <folder> first.',
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [currentGroupJid, groups, sendMessage, exit],
  );

  // Global keyboard shortcuts
  useInput((input, key) => {
    if (showGroupSelector || showHelp) {
      if (key.escape) {
        setShowGroupSelector(false);
        setShowHelp(false);
      }
      return;
    }

    if (key.ctrl && input === 'g') {
      setShowGroupSelector(true);
    } else if (key.ctrl && input === 'h') {
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
      ) : showGroupSelector ? (
        <Box flexGrow={1}>
          <GroupSelector
            groups={groups}
            currentGroupJid={currentGroupJid}
            onSelect={(group) => {
              setCurrentGroupJid(group.jid);
              setMessages((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  type: 'received',
                  sender: 'system',
                  content: `Switched to ${group.name}`,
                  timestamp: Date.now(),
                },
              ]);
              setShowGroupSelector(false);
            }}
            onCancel={() => setShowGroupSelector(false)}
          />
        </Box>
      ) : (
        <MessageList messages={messages} />
      )}

      <StatusBar status={status} group={currentGroup} />
      <InputBox
        onSubmit={handleSubmit}
        currentGroup={currentGroup}
        disabled={showGroupSelector || showHelp}
      />
    </Box>
  );
};
