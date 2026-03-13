import * as Lark from '@larksuiteoapi/node-sdk';
import { logger } from '../logger.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
  NewMessage,
} from '../types.js';
import { FEISHU_APP_ID, FEISHU_APP_SECRET } from '../config.js';
import { registerChannel, ChannelOpts } from './registry.js';
import type { FeishuEmojiType } from './feishu-emojis.js';
import { selectEmojiForMessage } from './feishu-emojis.js';

export interface FeishuChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

interface FeishuMessageEvent {
  message: {
    message_id: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: string;
    content: string;
    create_time: string;
    mentions?: Array<{
      key: string;
      id: {
        open_id: string;
        union_id?: string;
        user_id?: string;
      };
      name: string;
      tenant_key: string;
    }>;
  };
  sender: {
    sender_id: {
      open_id: string;
      union_id?: string;
      user_id?: string;
    };
    sender_type: string;
    tenant_key: string;
  };
}

export class FeishuChannel implements Channel {
  name = 'feishu';

  private client!: Lark.Client;
  private wsClient!: Lark.WSClient;
  private connected = false;
  private botOpenId: string | null = null;
  private botName: string | null = null;
  private userNameCache: Map<string, string> = new Map();

  private opts: FeishuChannelOpts;

  constructor(opts: FeishuChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
    }

    // 防止重复连接
    if (this.wsClient) {
      logger.debug('WebSocket client already exists, skipping connect');
      return;
    }

    const config = {
      appId: FEISHU_APP_ID,
      appSecret: FEISHU_APP_SECRET,
      loggerLevel: Lark.LoggerLevel.info,
    };

    this.client = new Lark.Client(config);
    await this.fetchBotInfo();

    this.wsClient = new Lark.WSClient(config);

    const eventDispatcher = new Lark.EventDispatcher({});

    eventDispatcher.register({
      'system.call_back_v2': async (data: unknown) => {
        const typedData = data as { event?: { type?: string } };
        if (typedData.event?.type === 'connect') {
          this.connected = true;
          logger.info('Feishu WebSocket connected');
        }
      },
    });

    eventDispatcher.register({
      'im.message.receive_v1': async (data: unknown) => {
        await this.handleMessage(data as FeishuMessageEvent);
      },
    });

    await this.wsClient.start({ eventDispatcher });
    logger.info('Feishu WebSocket client started');
  }

  private async fetchBotInfo(): Promise<void> {
    try {
      const tokenRes = await fetch(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_id: FEISHU_APP_ID,
            app_secret: FEISHU_APP_SECRET,
          }),
        },
      );

      const tokenData = (await tokenRes.json()) as {
        code: number;
        tenant_access_token?: string;
      };

      if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
        logger.warn(
          { code: tokenData.code },
          'Failed to get tenant access token',
        );
        return;
      }

      const botRes = await fetch(
        'https://open.feishu.cn/open-apis/bot/v3/info',
        {
          headers: {
            Authorization: `Bearer ${tokenData.tenant_access_token}`,
          },
        },
      );

      const botData = (await botRes.json()) as {
        code: number;
        bot?: { open_id: string; app_name: string };
      };

      if (botData.code === 0 && botData.bot?.open_id) {
        this.botOpenId = botData.bot.open_id;
        this.botName = botData.bot.app_name;
        logger.info(
          { botOpenId: this.botOpenId, botName: this.botName },
          'Feishu bot info fetched',
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Error fetching bot info');
    }
  }

  private async fetchUserName(openId: string): Promise<string | null> {
    if (this.userNameCache.has(openId)) {
      return this.userNameCache.get(openId)!;
    }

    try {
      const response = await this.client.contact.v3.user.get({
        params: { user_id_type: 'open_id' },
        path: { user_id: openId },
      });

      if (response.code === 0 && response.data?.user?.name) {
        const name = response.data.user.name;
        this.userNameCache.set(openId, name);
        return name;
      }
    } catch (err) {
      logger.warn(
        { err, openId: openId.slice(0, 8) },
        'Failed to fetch user name',
      );
    }
    return null;
  }

  private isBotMentioned(message: FeishuMessageEvent['message']): boolean {
    const parsedContent = JSON.parse(message.content || '{}');
    if (parsedContent.text?.includes('@_all')) {
      return true;
    }

    if (!message.mentions || message.mentions.length === 0) {
      return false;
    }

    if (this.botOpenId) {
      return message.mentions.some((m) => m.id.open_id === this.botOpenId);
    }

    return true;
  }

  private async handleMessage(data: FeishuMessageEvent): Promise<void> {
    const { message, sender } = data;
    const chatId = message.chat_id;
    const chatJid = `feishu:${chatId}`;

    const timestamp = new Date(parseInt(message.create_time)).toISOString();
    this.opts.onChatMetadata(
      chatJid,
      timestamp,
      undefined,
      'feishu',
      message.chat_type === 'group',
    );

    const groups = this.opts.registeredGroups();
    if (!groups[chatJid]) {
      logger.info(
        { chatJid, chatId },
        'Received message from unregistered Feishu chat',
      );
      return;
    }

    let content: string;
    try {
      const parsed = JSON.parse(message.content);
      content = parsed.text || '';
    } catch {
      content = message.content;
    }

    if (!content) {
      return;
    }

    const senderId = sender.sender_id.open_id;
    let senderName = message.mentions?.find(
      (m) => m.id.open_id === senderId,
    )?.name;

    if (!senderName) {
      const cachedName = this.userNameCache.get(senderId);
      if (cachedName) {
        senderName = cachedName;
      } else {
        this.fetchUserName(senderId).then((name) => {
          if (name)
            logger.debug(
              { openId: senderId.slice(0, 8), name },
              'Fetched user name',
            );
        });
        senderName = senderId.slice(0, 8);
      }
    }

    const isFromMe = senderId === this.botOpenId;

    let processedContent = content.replaceAll('@_all', '@所有人');

    if (message.mentions && message.mentions.length > 0) {
      for (const mention of message.mentions) {
        const isOtherBot = mention.id.open_id !== this.botOpenId;
        const displayName = isOtherBot
          ? `${mention.name}[机器人]`
          : mention.name;
        processedContent = processedContent.replaceAll(
          mention.key,
          `@${displayName}`,
        );
      }
    }

    const newMessage: NewMessage = {
      id: message.message_id,
      chat_jid: chatJid,
      sender: senderId,
      sender_name: senderName,
      content: processedContent,
      timestamp,
      is_from_me: isFromMe,
      is_bot_message: isFromMe,
      is_mentioned: this.isBotMentioned(message),
    };

    logger.info({ chatJid, sender: senderName }, 'Feishu message received');

    if (!isFromMe) {
      this.addReaction(message.message_id, 'Get').catch(() => {});
    }

    this.opts.onMessage(chatJid, newMessage);
  }

  private async addReaction(
    messageId: string,
    emojiType: FeishuEmojiType,
  ): Promise<void> {
    try {
      await this.client.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      });
    } catch (err) {
      logger.debug({ err }, 'Error adding reaction');
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chatId = jid.startsWith('feishu:') ? jid.slice(7) : jid;

    try {
      if (this.shouldUseCardMessage(text)) {
        await this.sendCardMessage(chatId, text);
      } else {
        await this.sendFeishuMessage(chatId, text);
      }
    } catch (err) {
      logger.warn({ chatId, err }, 'Failed to send message');
      throw err;
    }
  }

  private shouldUseCardMessage(text: string): boolean {
    if (text.includes('http://') || text.includes('https://')) return true;
    if ((text.match(/##\s+|\*\*[\s\S]*?\*\*/g) || []).length >= 2) return true;
    if (text.includes('---')) return true;
    if ((text.match(/^[\s]*[•\-\*]\s+/gm) || []).length >= 3) return true;
    if (text.length > 500 && text.split('\n').length > 10) return true;
    return false;
  }

  private async sendFeishuMessage(chatId: string, text: string): Promise<void> {
    const response = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    });

    if (response.code !== 0) {
      throw new Error(
        `Feishu API error: ${response.msg} (code: ${response.code})`,
      );
    }
  }

  private async sendCardMessage(chatId: string, text: string): Promise<void> {
    const cardContent = this.buildCardContent(text);
    const response = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify(cardContent),
        msg_type: 'interactive',
      },
    });

    if (response.code !== 0) {
      throw new Error(
        `Feishu API error: ${response.msg} (code: ${response.code})`,
      );
    }
  }

  private buildCardContent(text: string): Record<string, unknown> {
    const elements: Array<Record<string, unknown>> = [];
    const lines = text.split('\n');
    let currentSection: Array<Record<string, unknown>> = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      if (
        trimmedLine.startsWith('## ') ||
        (trimmedLine.startsWith('**') &&
          trimmedLine.endsWith('**') &&
          trimmedLine.length < 100)
      ) {
        if (currentSection.length > 0) {
          elements.push(...currentSection);
          currentSection = [];
        }
        const titleText = trimmedLine.replace(/^##\s+|\*\*/g, '').trim();
        elements.push({
          tag: 'div',
          text: { tag: 'lark_md', content: `**${titleText}**` },
        });
        continue;
      }

      if (trimmedLine === '---') {
        if (currentSection.length > 0) {
          elements.push(...currentSection);
          currentSection = [];
        }
        elements.push({ tag: 'hr' });
        continue;
      }

      const bulletMatch = trimmedLine.match(/^[\s]*[•\-\*]\s+(.*)$/);
      if (bulletMatch) {
        const content = bulletMatch[1];
        const processedContent = this.processLinks(content);
        currentSection.push({
          tag: 'div',
          text: { tag: 'lark_md', content: `• ${processedContent}` },
        });
        continue;
      }

      const processedLine = this.processLinks(trimmedLine);
      currentSection.push({
        tag: 'div',
        text: { tag: 'lark_md', content: processedLine },
      });
    }

    if (currentSection.length > 0) {
      elements.push(...currentSection);
    }

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '回复' },
        template: 'blue',
      },
      elements,
    };
  }

  private processLinks(text: string): string {
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)');
    text = text.replace(/(https?:\/\/[^\s\)\]]+)/g, '[$1]($1)');
    return text;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.wsClient) {
      try {
        // @ts-expect-error - SDK 类型定义不完整
        this.wsClient?.stop?.();
        logger.info('WebSocket client stopped');
      } catch (err) {
        logger.debug({ err }, 'Error stopping WebSocket client');
      }
      this.wsClient = undefined as any; // 清除引用，允许重新连接
    }
  }

  async setTyping(): Promise<void> {
    // 飞书不支持打字指示器
  }

  getBotName(): string | null {
    return this.botName;
  }

  async syncGroupMetadata(): Promise<void> {
    try {
      const response = await this.client.im.v1.chat.list({
        params: { page_size: 100 },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to list chats: ${response.msg}`);
      }

      const chats = response.data?.items || [];
      logger.info({ count: chats.length }, 'Synced Feishu group metadata');

      for (const chat of chats) {
        const chatJid = `feishu:${chat.chat_id}`;
        this.opts.onChatMetadata(
          chatJid,
          new Date().toISOString(),
          chat.name,
          'feishu',
          true,
        );
      }
    } catch (err) {
      logger.error({ err }, 'Failed to sync Feishu group metadata');
    }
  }
}

// 自注册 Feishu 频道
registerChannel('feishu', (opts: ChannelOpts) => {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    logger.debug(
      'Feishu: FEISHU_APP_ID or FEISHU_APP_SECRET not set, skipping',
    );
    return null;
  }
  return new FeishuChannel(opts);
});
