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
  // Table tokens - using unknown since marked's structure varies
  header?: unknown[];
  rows?: unknown[][];
  align?: ('left' | 'right' | 'center' | null)[];
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
}) => {
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

    case 'table': {
      const headers = (token.header || []) as Token[][];
      const rows = (token.rows || []) as Token[][][];
      const align = token.align || [];

      // Calculate column widths based on content
      const colWidths: number[] = [];
      headers.forEach((h, i) => {
        const cellText = getCellText(h);
        colWidths[i] = Math.max(colWidths[i] || 0, cellText.length);
      });
      rows.forEach((row) => {
        row.forEach((cell, i) => {
          const cellText = getCellText(cell);
          colWidths[i] = Math.max(colWidths[i] || 0, cellText.length);
        });
      });
      // Ensure minimum width
      colWidths.forEach((w, i) => {
        colWidths[i] = Math.max(w, 3);
      });

      return (
        <Box flexDirection="column" marginY={1}>
          {/* Header row */}
          <Box flexDirection="row">
            {headers.map((header, idx) => (
              <Box
                key={`h-${idx}`}
                marginRight={1}
                width={colWidths[idx]}
                minWidth={colWidths[idx]}
              >
                <Text bold>{renderCell(header, align[idx])}</Text>
              </Box>
            ))}
          </Box>
          {/* Separator */}
          <Box flexDirection="row">
            {headers.map((_, idx) => (
              <Box
                key={`s-${idx}`}
                marginRight={1}
                width={colWidths[idx]}
                minWidth={colWidths[idx]}
              >
                <Text dimColor>{'─'.repeat(colWidths[idx])}</Text>
              </Box>
            ))}
          </Box>
          {/* Data rows */}
          {rows.map((row, rowIdx) => (
            <Box key={`r-${rowIdx}`} flexDirection="row">
              {row.map((cell, cellIdx) => (
                <Box
                  key={`c-${rowIdx}-${cellIdx}`}
                  marginRight={1}
                  width={colWidths[cellIdx]}
                  minWidth={colWidths[cellIdx]}
                >
                  <Text>{renderCell(cell, align[cellIdx])}</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      );
    }

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
          </Text>,
        );
        break;

      case 'em':
        result.push(
          <Text key={i} italic>
            {token.text}
          </Text>,
        );
        break;

      case 'codespan':
        result.push(
          <Text key={i} color="cyan">
            {token.text}
          </Text>,
        );
        break;

      case 'del':
        result.push(
          <Text key={i} strikethrough>
            {token.text}
          </Text>,
        );
        break;

      case 'link':
        result.push(
          <Text key={i} color="blue" underline>
            {token.text}
          </Text>,
        );
        break;

      case 'br':
        result.push('\n');
        break;

      default:
        // For nested tokens, recursively render
        if (token.tokens && token.tokens.length > 0) {
          result.push(<Text key={i}>{renderInlineTokens(token.tokens)}</Text>);
        } else if (token.text) {
          result.push(token.text);
        }
    }
  }

  return result;
};

// Helper to safely get tokens array from a table cell
// Marked's table cell structure can vary - sometimes it's an array of tokens,
// sometimes it's a single token object with a tokens property
const getCellTokens = (
  cell: Token[] | { tokens?: Token[] } | unknown,
): Token[] => {
  if (Array.isArray(cell)) {
    return cell as Token[];
  }
  if (cell && typeof cell === 'object' && cell !== null && 'tokens' in cell) {
    const cellWithTokens = cell as { tokens?: Token[] };
    return cellWithTokens.tokens || [];
  }
  return [];
};

// Helper to get text content from a table cell
const getCellText = (
  cell: Token[] | { tokens?: Token[] } | unknown,
): string => {
  const tokens = getCellTokens(cell);
  return tokens
    .map((t) => {
      if (t.type === 'text') return t.text || '';
      if (t.type === 'codespan') return t.text || '';
      if (t.type === 'strong') return t.text || '';
      if (t.type === 'em') return t.text || '';
      return '';
    })
    .join('');
};

// Helper to render a table cell with alignment
const renderCell = (
  cell: Token[] | { tokens?: Token[] } | unknown,
  align: 'left' | 'right' | 'center' | null,
): React.ReactNode => {
  const tokens = getCellTokens(cell);
  const content = renderInlineTokens(tokens);

  if (align === 'right') {
    return <Text>{content}</Text>;
  }
  if (align === 'center') {
    return <Text>{content}</Text>;
  }
  return <Text>{content}</Text>;
};

export default MarkdownRenderer;
