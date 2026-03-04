import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  currentGroup: string | null;
  disabled?: boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  onSubmit,
  currentGroup,
  disabled = false,
}) => {
  const [query, setQuery] = useState('');
  const [multiline, setMultiline] = useState('');
  const [isMultiline, setIsMultiline] = useState(false);

  useInput(
    (_input, key) => {
      // Shift+Enter: add newline for multiline
      if (key.return && key.shift) {
        setMultiline((prev) => prev + query + '\n');
        setQuery('');
        setIsMultiline(true);
        return;
      }

      // Enter: submit
      if (key.return) {
        const fullText = multiline + query;
        if (fullText.trim()) {
          onSubmit(fullText.trim());
          setQuery('');
          setMultiline('');
          setIsMultiline(false);
        }
      }
    },
    { isActive: !disabled },
  );

  const prompt = currentGroup || '?';

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
      <Box borderStyle="single" borderColor={currentGroup ? 'green' : 'yellow'} paddingX={1}>
        <Text color={currentGroup ? 'green' : 'yellow'}>
          ● {prompt} {'>'}{' '}
        </Text>
        <TextInput value={query} onChange={setQuery} />
        {isMultiline && <Text dimColor> (...)</Text>}
      </Box>
    </Box>
  );
};
