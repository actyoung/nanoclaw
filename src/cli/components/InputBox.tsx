import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  currentGroup: string | null;
  disabled?: boolean;
  isRecording?: boolean;
  isTranscribing?: boolean;
  recordingDuration?: number;
  transcriptPreview?: string | null;
  onClearTranscript?: () => void;
}

export const InputBox: React.FC<InputBoxProps> = ({
  onSubmit,
  currentGroup,
  disabled = false,
  isRecording = false,
  isTranscribing = false,
  recordingDuration = 0,
  transcriptPreview = null,
  onClearTranscript,
}) => {
  const [query, setQuery] = useState('');
  const [multiline, setMultiline] = useState('');
  const [isMultiline, setIsMultiline] = useState(false);

  useInput(
    (_input, key) => {
      // Don't process input while recording or transcribing
      if (isRecording || isTranscribing) {
        return;
      }

      // Shift+Enter: add newline for multiline
      if (key.return && key.shift) {
        setMultiline((prev) => prev + query + '\n');
        setQuery('');
        setIsMultiline(true);
        return;
      }

      // Enter: submit
      if (key.return) {
        const fullText = transcriptPreview || multiline + query;
        if (fullText.trim()) {
          onSubmit(fullText.trim());
          setQuery('');
          setMultiline('');
          setIsMultiline(false);
          onClearTranscript?.();
        }
      }
    },
    { isActive: !disabled && !isRecording && !isTranscribing },
  );

  const prompt = currentGroup || '?';

  // Show recording state
  if (isRecording) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">
            🔴 Recording... ({recordingDuration}s) - Release Ctrl+R to stop
          </Text>
        </Box>
      </Box>
    );
  }

  // Show transcribing state
  if (isTranscribing) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">🎙️ Transcribing... Please wait</Text>
        </Box>
      </Box>
    );
  }

  // Show transcript preview if available
  if (transcriptPreview) {
    return (
      <Box flexDirection="column">
        <Box paddingLeft={2}>
          <Text color="cyan">
            📝 Transcript: {transcriptPreview.slice(0, 50)}
            {transcriptPreview.length > 50 ? '...' : ''}
          </Text>
          <Text dimColor> (Press Enter to send, type to edit)</Text>
        </Box>
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="cyan">
            ● {prompt} {'>'}{' '}
          </Text>
          <TextInput value={query} onChange={setQuery} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Show multiline buffer if any */}
      {isMultiline && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {multiline.split('\n').length - 1} lines buffered...
          </Text>
        </Box>
      )}
      <Box
        borderStyle="single"
        borderColor={currentGroup ? 'green' : 'yellow'}
        paddingX={1}
      >
        <Text color={currentGroup ? 'green' : 'yellow'}>
          ● {prompt} {'>'}{' '}
        </Text>
        <TextInput value={query} onChange={setQuery} />
        {isMultiline && <Text dimColor> (...)</Text>}
      </Box>
    </Box>
  );
};
