/**
 * Type definitions for CLI components
 */

export interface GroupInfo {
  jid: string;
  name: string;
  folder: string;
}

export interface AgentEvent {
  type:
    | 'container:started'
    | 'container:output'
    | 'container:idle'
    | 'container:closed'
    | 'message:received'
    | 'message:sent';
  groupJid: string;
  groupFolder: string;
  timestamp: number;
  data?: unknown;
}

export interface Message {
  id: string;
  type: 'sent' | 'received';
  sender: string;
  content: string;
  timestamp: number;
  groupJid?: string;
}

export type Status = 'idle' | 'starting' | 'processing';

export interface CliMessage {
  type: 'message' | 'list_groups';
  text?: string;
  groupFolder?: string;
}

export interface CliResponse {
  type: 'connected' | 'event' | 'groups_list';
  message?: string;
  event?: AgentEvent;
  groups?: Array<{ jid: string; name: string; folder: string }>;
}
