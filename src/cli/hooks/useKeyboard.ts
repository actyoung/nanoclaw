import { useInput } from 'ink';

interface UseKeyboardOptions {
  onExit: () => void;
  onHelp: () => void;
  onGroups: () => void;
}

export const useKeyboard = ({ onExit, onHelp, onGroups }: UseKeyboardOptions) => {
  useInput((input, key) => {
    // Ctrl+C or Escape to exit
    if (key.ctrl && input === 'c') {
      onExit();
      return;
    }

    // Ctrl+H for help
    if (key.ctrl && input === 'h') {
      onHelp();
      return;
    }

    // Ctrl+G for groups
    if (key.ctrl && input === 'g') {
      onGroups();
      return;
    }
  });
};
