/**
 * Feishu bot configuration verification
 */
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';
import {
  FEISHU_APP_ID,
  FEISHU_APP_SECRET,
} from '../src/config.js';

interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuBotInfoResponse {
  code: number;
  msg: string;
  bot?: {
    open_id: string;
    app_name: string;
  };
}

export async function run(): Promise<void> {
  emitStatus('FEISHU_AUTH', { STATUS: 'in_progress' });

  // Verify configuration
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error(
      'Feishu configuration missing. Please set FEISHU_APP_ID and FEISHU_APP_SECRET in your .env file.'
    );
  }

  logger.info('Verifying Feishu bot credentials...');

  // Test authentication
  const tokenResponse = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    }
  );

  const tokenData = (await tokenResponse.json()) as FeishuTokenResponse;

  if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
    throw new Error(
      `Failed to authenticate with Feishu: ${tokenData.msg} (code: ${tokenData.code})`
    );
  }

  logger.info('Successfully authenticated with Feishu');

  // Fetch bot info
  const botResponse = await fetch(
    'https://open.feishu.cn/open-apis/bot/v3/info',
    {
      headers: {
        Authorization: `Bearer ${tokenData.tenant_access_token}`,
      },
    }
  );

  const botData = (await botResponse.json()) as FeishuBotInfoResponse;

  if (botData.code === 0 && botData.bot) {
    logger.info(
      { botName: botData.bot.app_name, openId: botData.bot.open_id },
      'Feishu bot info retrieved'
    );
  }

  emitStatus('FEISHU_AUTH', {
    STATUS: 'success',
    APP_ID: FEISHU_APP_ID,
    BOT_NAME: botData.bot?.app_name || 'Unknown',
  });

  logger.info('Feishu bot configuration verified successfully');
  logger.info('');
  logger.info('Next steps:');
  logger.info('1. In Feishu app settings -> "Event Subscriptions"');
  logger.info('   Select "Receive events/callbacks through persistent connection" (长连接)');
  logger.info('   Subscribe to event: im.message.receive_v1');
  logger.info('2. Add the bot to your Feishu groups');
  logger.info('3. Run setup with --step groups to configure groups');
}
