import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useIPC } from '../hooks/useIPC.js';
import { useVoice } from '../hooks/useVoice.js';
import { Header } from './Header.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { Help } from './Help.js';
import { ThinkingPanel } from './ThinkingPanel.js';
import { ApiRequestPanel } from './ApiRequestPanel.js';
import { AgentEvent, Message, GroupInfo, VoiceConfig } from '../types.js';
import { PROJECT_ROOT } from '../../config.js';

// Voice configuration from environment
const voiceConfig: VoiceConfig = {
  enabled: process.env.VOICE_ENABLED !== 'false',
  inputEnabled: process.env.VOICE_INPUT_ENABLED !== 'false',
  outputEnabled: process.env.VOICE_OUTPUT_ENABLED !== 'false',
  outputEngine: (process.env.VOICE_OUTPUT_ENGINE as 'say' | 'openai') || 'say',
  voiceName: process.env.VOICE_NAME,
  openaiApiKey: process.env.OPENAI_API_KEY,
  whisperModelPath: `${PROJECT_ROOT}/data/models/ggml-base.bin`,
  autoSendTranscript: process.env.VOICE_AUTO_SEND === 'true',
};

const CLI_MAIN_JID = 'cli:main';
const CLI_MAIN_FOLDER = 'cli-main';

interface AppProps {
  debug?: boolean;
}

export const App: React.FC<AppProps> = ({ debug = false }) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'idle' | 'starting' | 'processing'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [thinkingContent, setThinkingContent] = useState<string>('');
  const [hasActiveThinking, setHasActiveThinking] = useState(false);
  const [apiRequestData, setApiRequestData] = useState<{
    model?: string;
    messageCount?: number;
    maxTokens?: number;
    firstMessagePreview?: string;
  } | null>(null);
  const [hasActiveApiRequest, setHasActiveApiRequest] = useState(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Group selection state
  const [cliGroups, setCliGroups] = useState<GroupInfo[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null);
  const selectedGroupRef = React.useRef<GroupInfo | null>(null);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [selectorIndex, setSelectorIndex] = useState(0);

  // Voice state
  const [transcriptPreview, setTranscriptPreview] = useState<string | null>(
    null,
  );
  const lastAgentMessageRef = useRef<Message | null>(null);
  const isRecordingRef = useRef(false);

  // Voice hook
  const {
    state: voiceState,
    setupStatus: voiceSetupStatus,
    startRecordingVoice,
    stopRecordingVoice,
    cancelRecording,
    speakText,
    toggleEnabled: toggleVoiceEnabled,
    setEnabled: setVoiceEnabled,
    isReady: isVoiceReady,
  } = useVoice({
    config: voiceConfig,
    onTranscript: (text) => {
      if (voiceConfig.autoSendTranscript && selectedGroup) {
        // Auto-send transcript
        handleSubmit(text);
      } else {
        // Show preview for user to confirm
        setTranscriptPreview(text);
      }
    },
  });

  // Keep ref in sync with state to avoid closure issues in callbacks
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  }, [selectedGroup]);

  // Keep recording ref in sync
  useEffect(() => {
    isRecordingRef.current = voiceState.isRecording;
  }, [voiceState.isRecording]);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      // Use ref to get latest value and avoid closure issues
      const currentGroup = selectedGroupRef.current;
      // Only show messages from the currently selected group
      // If no group selected yet, allow events from cli:* groups (auto-select on first event)
      if (currentGroup && event.groupJid !== currentGroup.jid) return;
      // If no group selected but event is from a cli group, auto-select it
      if (!currentGroup && event.groupJid.startsWith('cli:')) {
        // Create default group info
        const defaultGroup: GroupInfo = {
          jid: event.groupJid,
          name: 'CLI Main',
          folder: 'cli-main',
        };
        setSelectedGroup(defaultGroup);
        subscribeToGroup(defaultGroup.folder);
      }

      switch (event.type) {
        case 'container:started':
          setStatus('starting');
          break;
        case 'container:output':
          setStatus('processing');
          setHasActiveThinking(true);
          // Cancel any pending idle transition
          if (idleTimeoutRef.current) {
            clearTimeout(idleTimeoutRef.current);
            idleTimeoutRef.current = null;
          }
          break;
        case 'api:request': {
          const data = event.data as {
            model?: string;
            messageCount?: number;
            maxTokens?: number;
            firstMessagePreview?: string;
          };
          setApiRequestData(data);
          setHasActiveApiRequest(true);
          break;
        }
        case 'container:idle':
          // Delay idle transition to prevent flickering
          if (!idleTimeoutRef.current) {
            idleTimeoutRef.current = setTimeout(() => {
              setStatus('idle');
              setHasActiveThinking(false);
              idleTimeoutRef.current = null;
            }, 500);
          }
          break;
        case 'container:closed':
          setStatus('idle');
          setHasActiveThinking(false);
          setHasActiveApiRequest(false);
          if (idleTimeoutRef.current) {
            clearTimeout(idleTimeoutRef.current);
            idleTimeoutRef.current = null;
          }
          break;
        case 'agent:thinking': {
          const thinking = typeof event.data === 'string' ? event.data : '';
          if (debug) {
            // eslint-disable-next-line no-console
            console.error(
              '[CLI Debug] Received thinking:',
              thinking.slice(0, 100),
            );
          }
          setThinkingContent((prev) => prev + (prev ? '\n' : '') + thinking);
          setHasActiveThinking(true);
          // Cancel idle timeout if new thinking arrives
          if (idleTimeoutRef.current) {
            clearTimeout(idleTimeoutRef.current);
            idleTimeoutRef.current = null;
          }
          break;
        }
        case 'message:received': {
          // Message from CLI channel - clear thinking on new conversation turn
          setThinkingContent('');
          setHasActiveThinking(false);
          setApiRequestData(null);
          setHasActiveApiRequest(false);
          if (idleTimeoutRef.current) {
            clearTimeout(idleTimeoutRef.current);
            idleTimeoutRef.current = null;
          }
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
          let text: string;
          let senderName: string | undefined;
          if (typeof event.data === 'string') {
            text = event.data;
          } else if (event.data && typeof event.data === 'object') {
            const data = event.data as { text?: string; senderName?: string };
            text = data.text || '';
            senderName = data.senderName;
          } else {
            text = '';
          }
          const newMessage: Message = {
            id: `${Date.now()}-${Math.random()}`,
            type: 'received',
            sender: 'agent',
            senderName,
            content: text,
            timestamp: Date.now(),
            groupJid: event.groupJid,
          };
          setMessages((prev) => [...prev, newMessage]);
          lastAgentMessageRef.current = newMessage;

          // Speak the agent response if TTS is enabled (non-blocking, auto-interrupts previous)
          if (voiceConfig.outputEnabled && voiceState.enabled) {
            speakText(text);
          }

          // Agent finished replying - mark thinking as inactive
          setHasActiveThinking(false);
          setHasActiveApiRequest(false);
          if (idleTimeoutRef.current) {
            clearTimeout(idleTimeoutRef.current);
            idleTimeoutRef.current = null;
          }
          break;
        }
      }
    },
    [voiceState.enabled, speakText],
  );

  const { connected, sendMessage, listGroups, subscribeToGroup } = useIPC({
    onEvent: handleEvent,
    onError: setError,
    groupFolder: selectedGroup?.folder,
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
              subscribeToGroup(targetGroup.folder); // Subscribe to new group
              setMessages([]); // Clear messages when switching
              setThinkingContent(''); // Clear thinking when switching
              setTranscriptPreview(null); // Clear transcript preview
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
          case 'voice': {
            const subCmd = args[0]?.toLowerCase();
            switch (subCmd) {
              case 'on':
                setVoiceEnabled(true);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    type: 'received',
                    sender: 'system',
                    content: '🔊 Text-to-speech enabled.',
                    timestamp: Date.now(),
                  },
                ]);
                return;
              case 'off':
                setVoiceEnabled(false);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    type: 'received',
                    sender: 'system',
                    content: '🔇 Text-to-speech disabled.',
                    timestamp: Date.now(),
                  },
                ]);
                return;
              case 'status':
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    type: 'received',
                    sender: 'system',
                    content:
                      `Voice Status:\n` +
                      `  TTS: ${voiceState.enabled ? 'enabled' : 'disabled'}\n` +
                      `  Input: ${voiceConfig.inputEnabled ? 'enabled' : 'disabled'}\n` +
                      `  Output Engine: ${voiceConfig.outputEngine}\n` +
                      `  Voice: ${voiceConfig.voiceName || 'default'}\n` +
                      `  Setup: ${isVoiceReady ? '✓ ready' : '⚠ missing dependencies'}`,
                    timestamp: Date.now(),
                  },
                ]);
                return;
              default:
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    type: 'received',
                    sender: 'system',
                    content:
                      'Voice Commands:\n' +
                      '  /voice on     - Enable text-to-speech\n' +
                      '  /voice off    - Disable text-to-speech\n' +
                      '  /voice status - Show voice settings',
                    timestamp: Date.now(),
                  },
                ]);
                return;
            }
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

      // Clear transcript preview after sending
      setTranscriptPreview(null);

      // Send message to selected CLI group
      // Add user message to local display immediately
      setThinkingContent(''); // Clear thinking on new user message
      setHasActiveThinking(false);
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
    [
      sendMessage,
      exit,
      selectedGroup,
      cliGroups,
      listGroups,
      subscribeToGroup,
      voiceState.enabled,
      setVoiceEnabled,
      isVoiceReady,
    ],
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
        const selected = cliGroups[selectorIndex];
        setSelectedGroup(selected);
        subscribeToGroup(selected.folder);
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

    // Ctrl+R: Toggle voice recording
    if (key.ctrl && _input === 'r') {
      if (!voiceConfig.inputEnabled) {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            type: 'received',
            sender: 'system',
            content:
              'Voice input is disabled. Enable with VOICE_INPUT_ENABLED=true',
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (isRecordingRef.current) {
        // Stop recording
        stopRecordingVoice().catch((err) => {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              type: 'received',
              sender: 'system',
              content: `Voice error: ${err instanceof Error ? err.message : String(err)}`,
              timestamp: Date.now(),
            },
          ]);
        });
      } else {
        // Start recording
        startRecordingVoice().catch((err) => {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              type: 'received',
              sender: 'system',
              content: `Voice error: ${err instanceof Error ? err.message : String(err)}`,
              timestamp: Date.now(),
            },
          ]);
        });
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

      {/* Thinking panel - above status bar, auto-height */}
      {thinkingContent && (
        <Box
          borderStyle="single"
          padding={1}
          flexDirection="column"
          marginTop={1}
          flexShrink={0}
        >
          <Text bold>Thinking Process</Text>
          <Box marginTop={1}>
            <ThinkingPanel
              content={thinkingContent}
              isActive={hasActiveThinking}
            />
          </Box>
        </Box>
      )}

      {/* API Request panel - only in debug mode */}
      {debug && apiRequestData && (
        <Box
          borderStyle="single"
          borderColor="yellow"
          padding={1}
          flexDirection="column"
          marginTop={1}
          flexShrink={0}
        >
          <ApiRequestPanel
            model={apiRequestData.model}
            messageCount={apiRequestData.messageCount}
            maxTokens={apiRequestData.maxTokens}
            firstMessagePreview={apiRequestData.firstMessagePreview}
            isActive={hasActiveApiRequest}
          />
        </Box>
      )}

      <StatusBar
        status={status}
        group={selectedGroup?.folder || 'none'}
        voiceState={voiceState}
      />

      <InputBox
        onSubmit={handleSubmit}
        currentGroup={selectedGroup?.folder ?? null}
        disabled={showHelp}
        isRecording={voiceState.isRecording}
        isTranscribing={voiceState.isTranscribing}
        recordingDuration={voiceState.recordingDuration}
        transcriptPreview={transcriptPreview}
        onClearTranscript={() => setTranscriptPreview(null)}
      />
    </Box>
  );
};
