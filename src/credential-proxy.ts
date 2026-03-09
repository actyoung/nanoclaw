/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve as pathResolve } from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { broadcastAgentEvent } from './ipc-server.js';
import { PROJECT_ROOT } from './config.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        // Extract group folder from URL path for CLI debug mode
        // URL format: /{groupFolder}/v1/messages
        const urlPathMatch = req.url?.match(/^\/([^\/]+)(\/v1\/)/);
        const groupFolder = urlPathMatch ? urlPathMatch[1] : undefined;
        const isCliGroup = !!groupFolder && groupFolder.startsWith('cli-');
        let cleanPath = req.url || '/';

        // Remove group folder prefix from URL if present
        if (groupFolder && req.url?.startsWith(`/${groupFolder}/`)) {
          cleanPath = req.url.slice(`/${groupFolder}`.length);
        }

        // Log API request to file for CLI debug mode (only when LOG_LEVEL=debug)
        const isDebugMode = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';
        if (isCliGroup) {
          try {
            const requestData = JSON.parse(body.toString());
            const firstMessage = requestData.messages?.[0];
            const firstContent = firstMessage?.content;
            let firstPreview = '';
            if (typeof firstContent === 'string') {
              firstPreview = firstContent.slice(0, 100);
            } else if (Array.isArray(firstContent)) {
              const textBlock = firstContent.find(
                (c: { type?: string; text?: string }) =>
                  c.type === 'text' || c.text,
              );
              firstPreview = textBlock?.text?.slice(0, 100) || '';
            }

            // Generate groupJid to match index.ts logic: cli:${folder.replace('cli-', '')}
            const groupJid = `cli:${groupFolder!.replace('cli-', '')}`;

            // Write full request to log file only in debug mode
            if (isDebugMode) {
              const logDir = pathResolve(
                PROJECT_ROOT,
                'logs',
                'api-requests',
                groupFolder!,
              );
              mkdirSync(logDir, { recursive: true });

              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const sessionId = requestData.session_id || 'unknown';
              const logFile = pathResolve(
                logDir,
                `api-request-${groupFolder}-${sessionId}-${timestamp}.json`,
              );

              writeFileSync(
                logFile,
                JSON.stringify(
                  {
                    timestamp: Date.now(),
                    model: requestData.model,
                    messageCount: requestData.messages?.length,
                    maxTokens: requestData.max_tokens,
                    requestBody: requestData,
                  },
                  null,
                  2,
                ),
              );
            }

            // Broadcast simplified info (without requestBody)
            broadcastAgentEvent({
              type: 'api:request',
              groupJid,
              groupFolder: groupFolder!,
              timestamp: Date.now(),
              data: {
                model: requestData.model,
                messageCount: requestData.messages?.length,
                maxTokens: requestData.max_tokens,
                firstMessagePreview:
                  firstPreview.length > 0 ? `${firstPreview}...` : '',
              },
            });
          } catch {
            // Ignore parse errors
          }
        }

        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        // Build upstream path: preserve base URL path prefix + clean request path
        const basePath = upstreamUrl.pathname.replace(/\/$/, '');
        const upstreamPath = basePath + cleanPath;

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: upstreamPath,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
