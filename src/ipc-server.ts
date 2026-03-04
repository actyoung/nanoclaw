import fs from 'fs';
import net from 'net';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

// Unix socket path for CLI channel communication
const SOCKET_PATH = path.join(DATA_DIR, 'nanoclaw.sock');

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

export interface CliMessage {
  type: 'message' | 'list_groups';
  text?: string;
}

export interface CliResponse {
  type: 'connected' | 'event' | 'groups_list';
  message?: string;
  event?: AgentEvent;
  groups?: Array<{ jid: string; name: string; folder: string }>;
}

export class IpcServer {
  private server: net.Server | null = null;
  private clients: Map<string, net.Socket> = new Map();
  private clientCounter = 0;

  /**
   * Start the IPC server listening on Unix socket
   */
  start(): void {
    // Clean up any stale socket file
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
        logger.debug({ socketPath: SOCKET_PATH }, 'Removed stale socket file');
      } catch (err) {
        logger.warn(
          { socketPath: SOCKET_PATH, err },
          'Failed to remove stale socket file',
        );
      }
    }

    this.server = net.createServer((socket) => {
      this.handleClientConnection(socket);
    });

    this.server.on('error', (err) => {
      logger.error({ err }, 'IPC server error');
    });

    this.server.listen(SOCKET_PATH, () => {
      // Set socket permissions to allow all users (for CLI access)
      try {
        fs.chmodSync(SOCKET_PATH, 0o666);
      } catch (err) {
        logger.warn(
          { socketPath: SOCKET_PATH, err },
          'Failed to set socket permissions',
        );
      }
      logger.info({ socketPath: SOCKET_PATH }, 'IPC server started');
    });
  }

  /**
   * Stop the IPC server and close all client connections
   */
  stop(): void {
    for (const [id, client] of this.clients) {
      client.destroy();
      this.clients.delete(id);
    }

    this.server?.close(() => {
      logger.info('IPC server stopped');
    });

    // Clean up socket file
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Broadcast an agent event to all connected CLI clients
   */
  broadcastEvent(event: AgentEvent): void {
    const message = JSON.stringify({ type: 'event', event }) + '\n';
    for (const [id, client] of this.clients) {
      try {
        if (!client.destroyed) {
          client.write(message);
        }
      } catch (err) {
        logger.debug({ clientId: id, err }, 'Failed to send event to client');
        this.clients.delete(id);
      }
    }
  }

  /**
   * Register a callback for incoming CLI messages
   */
  onMessage(callback: (msg: CliMessage) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Register a provider for groups list
   */
  onGroupsList(callback: () => Array<{ jid: string; name: string; folder: string }>): void {
    this.groupsListCallback = callback;
  }

  private messageCallback: ((msg: CliMessage) => void) | null = null;
  private groupsListCallback: (() => Array<{ jid: string; name: string; folder: string }>) | null = null;

  private handleClientConnection(socket: net.Socket): void {
    const clientId = `cli-${++this.clientCounter}`;
    this.clients.set(clientId, socket);
    logger.info({ clientId, clientCount: this.clients.size }, 'CLI client connected');

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as CliMessage;
          if (msg.type === 'message' && msg.text) {
            logger.debug({ clientId }, 'CLI message received');
            this.messageCallback?.(msg);
          } else if (msg.type === 'list_groups') {
            logger.debug({ clientId }, 'CLI list_groups request received');
            const groups = this.groupsListCallback?.() ?? [];
            this.sendToClient(clientId, {
              type: 'groups_list',
              groups,
            });
          }
        } catch (err) {
          logger.warn({ clientId, line, err }, 'Invalid message from CLI client');
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(clientId);
      logger.info(
        { clientId, clientCount: this.clients.size },
        'CLI client disconnected',
      );
    });

    socket.on('error', (err) => {
      logger.debug({ clientId, err }, 'CLI client socket error');
      this.clients.delete(clientId);
    });

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'connected',
      message: 'Connected to NanoClaw IPC server',
    });
  }

  private sendToClient(clientId: string, data: unknown): void {
    const client = this.clients.get(clientId);
    if (client && !client.destroyed) {
      try {
        client.write(JSON.stringify(data) + '\n');
      } catch {
        // ignore
      }
    }
  }
}

// Singleton instance
let ipcServer: IpcServer | null = null;

export function getIpcServer(): IpcServer {
  if (!ipcServer) {
    ipcServer = new IpcServer();
  }
  return ipcServer;
}

export function broadcastAgentEvent(event: AgentEvent): void {
  getIpcServer().broadcastEvent(event);
}
