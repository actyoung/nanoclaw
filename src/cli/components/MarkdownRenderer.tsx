import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
}

// Token types from marked
interface Token {
  type: string;
  raw?: string;
  text?: string;
  lang?: string;
  depth?: number;
  items?: Array<{ text: string; tokens?: Token[] }>;
  ordered?: boolean;
  tokens?: Token[];
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  // Parse markdown to tokens
  const tokens = marked.lexer(content) as Token[];

  return (
    <Box flexDirection="column">
      {tokens.map((token, index) => (
        <TokenRenderer key={index} token={token} />
      ))}
    </Box>
  );
};

const TokenRenderer: React.FC<{ token: Token }> = ({ token }) => {
  switch (token.type) {
    case 'heading':
      return (
        <Box marginTop={1}>
          <Text bold underline>
            {renderInlineTokens(token.tokens || [])}
          </Text>
        </Box>
      );

    case 'paragraph':
      return (
        <Box>
          <Text wrap="wrap">{renderInlineTokens(token.tokens || [])}</Text>
        </Box>
      );

    case 'code':
      return (
        <Box
          marginY={1}
          paddingX={1}
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
        >
          {token.lang && (
            <Text dimColor italic>
              {token.lang}
            </Text>
          )}
          <Text wrap="wrap" color="cyan">
            {token.text || ''}
          </Text>
        </Box>
      );

    case 'blockquote':
      return (
        <Box marginY={1} paddingLeft={1} borderStyle="single" borderLeft>
          <Text wrap="wrap" color="yellow">
            {renderInlineTokens(token.tokens || [])}
          </Text>
        </Box>
      );

    case 'list':
      return (
        <Box flexDirection="column">
          {token.items?.map((item, idx) => (
            <Box key={idx} flexDirection="row">
              <Text>{token.ordered ? `${idx + 1}. ` : '• '}</Text>
              <Text wrap="wrap">
                {renderInlineTokens((item.tokens as Token[]) || [])}
              </Text>
            </Box>
          ))}
        </Box>
      );

    case 'hr':
      return (
        <Box marginY={1}>
          <Text dimColor>{'─'.repeat(40)}</Text>
        </Box>
      );

    case 'space':
      return null;

    default:
      // For unknown tokens, try to render inline content
      if (token.tokens) {
        return (
          <Box>
            <Text wrap="wrap">{renderInlineTokens(token.tokens)}</Text>
          </Box>
        );
      }
      return null;
  }
};

// Render inline tokens (bold, italic, code, etc.)
const renderInlineTokens = (tokens: Token[]): React.ReactNode[] => {
  const result: React.ReactNode[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case 'text':
        result.push(token.text || '');
        break;

      case 'strong':
        result.push(
          <Text key={i} bold>
            {token.text}
          </Text>
        );
        break;

      case 'em':
        result.push(
          <Text key={i} italic>
            {token.text}
          </Text>
        );
        break;

      case 'codespan':
        result.push(
          <Text key={i} color="cyan">
            {token.text}
          </Text>
        );
        break;

      case 'del':
        result.push(
          <Text key={i} strikethrough>
            {token.text}
          </Text>
        );
        break;

      case 'link':
        result.push(
          <Text key={i} color="blue" underline>
            {token.text}
          </Text>
        );
        break;

      case 'br':
        result.push('\n');
        break;

      default:
        // For nested tokens, recursively render
        if (token.tokens && token.tokens.length > 0) {
          result.push(
            <Text key={i}>{renderInlineTokens(token.tokens)}</Text>
          );
        } else if (token.text) {
          result.push(token.text);
        }
    }
  }

  return result;
};

export default MarkdownRenderer;
