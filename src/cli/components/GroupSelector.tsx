import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { GroupInfo } from '../types.js';

interface GroupSelectorProps {
  groups: GroupInfo[];
  currentGroupJid: string | null;
  onSelect: (group: GroupInfo) => void;
  onCancel: () => void;
}

export const GroupSelector: React.FC<GroupSelectorProps> = ({
  groups,
  currentGroupJid,
  onSelect,
  onCancel,
}) => {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredGroups = groups.filter(
    (g) =>
      g.folder.toLowerCase().includes(filter.toLowerCase()) ||
      g.name.toLowerCase().includes(filter.toLowerCase()),
  );

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredGroups.length - 1,
      );
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev < filteredGroups.length - 1 ? prev + 1 : 0,
      );
      return;
    }

    if (key.return && filteredGroups[selectedIndex]) {
      onSelect(filteredGroups[selectedIndex]);
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold>Available Groups</Text>
      <Box marginY={1}>
        <Text dimColor>Filter: </Text>
        <TextInput value={filter} onChange={setFilter} placeholder="Type to filter..." />
      </Box>
      <Box flexDirection="column">
        {filteredGroups.map((group, index) => {
          const isSelected = index === selectedIndex;
          const isCurrent = group.jid === currentGroupJid;
          return (
            <Box key={group.jid}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? '> ' : '  '}
                {isCurrent ? '● ' : '  '}
                <Text bold={isSelected}>{group.folder}</Text>
                <Text dimColor> ({group.name})</Text>
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ to navigate, Enter to select, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
};
