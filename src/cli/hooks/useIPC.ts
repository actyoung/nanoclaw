import { useEffect, useRef, useState, useCallback } from 'react';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../config.js';
import { AgentEvent, CliResponse } from '../types.js';

const SOCKET_PATH = path.join(DATA_DIR, 'nanoclaw.sock');

interface UseIPCOptions {
  onEvent: (event: AgentEvent) => void;
  onConnected?: () => void;
  onError?: (error: string) => void;
}

export const useIPC = ({
  onEvent,
  onConnected,
  onError,
}: UseIPCOptions) => {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const socketRef = useRef<net.Socket | null>(null);
  const bufferRef = useRef('');

  useEffect(() => {
    // Check if socket file exists
    if (!fs.existsSync(SOCKET_PATH)) {
      setConnecting(false);
      onError?.('NanoClaw is not running. Start it with: npm run dev');
      return;
    }

    const socket = net.createConnection(SOCKET_PATH);
    socketRef.current = socket;

    socket.on('data', (data) => {
      bufferRef.current += data.toString();
      const lines = bufferRef.current.split('\n');
      bufferRef.current = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as CliResponse;
          handleMessage(msg);
        } catch {
          // ignore parse errors
        }
      }
    });

    socket.on('connect', () => {
      setConnected(true);
      setConnecting(false);
      onConnected?.();
    });

    socket.on('close', () => {
      setConnected(false);
      onError?.('Disconnected from NanoClaw');
    });

    socket.on('error', (err) => {
      setConnecting(false);
      onError?.(`Connection error: ${err.message}`);
    });

    const handleMessage = (msg: CliResponse) => {
      switch (msg.type) {
        case 'connected':
          // Initial connection established
          break;
        case 'event':
          if (msg.event) {
            onEvent(msg.event);
          }
          break;
      }
    };

    return () => {
      socket.destroy();
    };
  }, []);

  const sendMessage = useCallback((text: string) => {
    socketRef.current?.write(
      JSON.stringify({ type: 'message', text }) + '\n',
    );
  }, []);

  return {
    connected,
    connecting,
    sendMessage,
  };
};
