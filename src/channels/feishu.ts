import * as Lark from '@larksuiteoapi/node-sdk';
import { logger } from '../logger.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
  NewMessage,
} from '../types.js';
import { FEISHU_APP_ID, FEISHU_APP_SECRET, ASSISTANT_NAME } from '../config.js';

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
  private outgoingQueue: Array<{ chatId: string; text: string }> = [];
  private flushing = false;
  private botOpenId: string | null = null;

  private opts: FeishuChannelOpts;

  constructor(opts: FeishuChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
    }

    const config = {
      appId: FEISHU_APP_ID,
      appSecret: FEISHU_APP_SECRET,
      loggerLevel: Lark.LoggerLevel.info,
    };

    // 创建 REST API 客户端
    this.client = new Lark.Client(config);

    // 获取机器人信息
    await this.fetchBotInfo();

    // 创建 WebSocket 客户端
    this.wsClient = new Lark.WSClient({
      ...config,
      loggerLevel: Lark.LoggerLevel.info,
    });

    // 启动 WebSocket 连接（异步，不阻塞）
    this.startWebSocket();

    // 不等待连接建立，让其在后台运行
    logger.info('WebSocket connection started asynchronously');
  }

  private async fetchBotInfo(): Promise<void> {
    // Skip bot info fetch for now - SDK API may vary
    logger.info('Feishu bot info skipped (SDK compatibility)');
  }

  private startWebSocket(): void {
    const eventDispatcher = new Lark.EventDispatcher({});

    // 注册系统回调事件（连接建立等）
    eventDispatcher.register({
      'system.call_back_v2': async (data: unknown) => {
        logger.info({ data }, 'system.call_back_v2 received');
        const typedData = data as { event?: { type?: string } };
        if (typedData.event?.type === 'connect') {
          this.connected = true;
          logger.info('Feishu WebSocket connected');
          this.flushOutgoingQueue().catch((err) =>
            logger.error({ err }, 'Failed to flush outgoing queue'),
          );
        }
      },
    });

    // 注册消息接收事件
    eventDispatcher.register({
      'im.message.receive_v1': async (data: unknown) => {
        logger.info({ data }, 'im.message.receive_v1 received');
        await this.handleMessage(data as FeishuMessageEvent);
      },
    });

    // 启动 WebSocket 客户端
    this.wsClient.start({ eventDispatcher });

    // SDK 会在连接成功后自动发送日志，我们根据日志判断
    // 由于 SDK 内部处理连接，我们假设启动即开始连接
    logger.info('WebSocket client started, waiting for connection...');

    // 使用一个延迟来设置 connected 状态（SDK 内部会自动重连）
    setTimeout(() => {
      // 如果收到了消息，说明连接成功了
      this.connected = true;
    }, 5000);
  }

  private async handleMessage(data: FeishuMessageEvent): Promise<void> {
    // 添加调试日志
    logger.info(
      { eventType: 'im.message.receive_v1', data },
      'Received Feishu event',
    );

    const { message, sender } = data;
    const chatId = message.chat_id;
    const chatType = message.chat_type;
    const isGroup = chatType === 'group';

    // 生成 JID (使用 feishu: 前缀区分)
    const chatJid = `feishu:${chatId}`;

    // 记录聊天元数据
    const timestamp = new Date(parseInt(message.create_time)).toISOString();
    this.opts.onChatMetadata(chatJid, timestamp, undefined, 'feishu', isGroup);

    // 只处理已注册群组的消息
    const groups = this.opts.registeredGroups();
    if (!groups[chatJid]) {
      // 记录未注册群组的信息，方便用户获取 chat_id
      logger.info(
        { chatJid, chatId, chatType },
        'Received message from unregistered Feishu chat. To register, run: npm run setup -- --step register --jid "' +
          chatJid +
          '" --name "My Group" --trigger "@Andy" --folder main',
      );
      return;
    }

    // 解析消息内容
    let content: string;
    try {
      const parsed = JSON.parse(message.content);
      // 文本消息
      content = parsed.text || '';
    } catch {
      content = message.content;
    }

    if (!content) {
      logger.debug({ messageId: message.message_id }, 'Skipping empty message');
      return;
    }

    // 获取发送者信息
    const senderId = sender.sender_id.open_id;
    const senderName =
      message.mentions?.find((m) => m.id.open_id === senderId)?.name ||
      senderId.slice(0, 8);

    // 检查是否是机器人消息
    const isFromMe = senderId === this.botOpenId;
    const isBotMessage = isFromMe || content.startsWith(`${ASSISTANT_NAME}:`);

    const newMessage: NewMessage = {
      id: message.message_id,
      chat_jid: chatJid,
      sender: senderId,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: isFromMe,
      is_bot_message: isBotMessage,
    };

    logger.info(
      { chatJid, sender: senderName, content: content.slice(0, 100) },
      'Feishu message received',
    );

    this.opts.onMessage(chatJid, newMessage);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // 从 feishu:chatId 格式提取 chatId
    const chatId = jid.startsWith('feishu:') ? jid.slice(7) : jid;

    // 添加机器人名称前缀
    const prefixed = `${ASSISTANT_NAME}: ${text}`;

    if (!this.connected) {
      this.outgoingQueue.push({ chatId, text: prefixed });
      logger.info(
        { chatId, queueSize: this.outgoingQueue.length },
        'Feishu disconnected, message queued',
      );
      return;
    }

    try {
      // 自动识别是否使用卡片消息
      if (this.shouldUseCardMessage(prefixed)) {
        await this.sendCardMessage(chatId, prefixed);
        logger.info(
          { chatId, length: prefixed.length },
          'Feishu card message sent',
        );
      } else {
        await this.sendFeishuMessage(chatId, prefixed);
        logger.info(
          { chatId, length: prefixed.length },
          'Feishu text message sent',
        );
      }
    } catch (err) {
      this.outgoingQueue.push({ chatId, text: prefixed });
      logger.warn(
        { chatId, err, queueSize: this.outgoingQueue.length },
        'Failed to send Feishu message, queued',
      );
    }
  }

  /**
   * 判断是否应该使用卡片消息
   * 当消息包含以下特征时使用卡片：
   * - 包含链接
   * - 包含多行结构化内容（如新闻列表、分节内容）
   * - 包含标题标记（如 ## 标题）
   * - 包含分隔线（---）
   */
  private shouldUseCardMessage(text: string): boolean {
    // 包含链接
    if (text.includes('http://') || text.includes('https://')) {
      return true;
    }
    // 包含多个标题（## 或 **标题**）
    if ((text.match(/##\s+|\*\*[\s\S]*?\*\*/g) || []).length >= 2) {
      return true;
    }
    // 包含分隔线
    if (text.includes('---')) {
      return true;
    }
    // 包含多个项目符号段落（可能是新闻列表）
    if ((text.match(/^[\s]*[•\-\*]\s+/gm) || []).length >= 3) {
      return true;
    }
    // 消息长度较长且结构复杂
    if (text.length > 500 && text.split('\n').length > 10) {
      return true;
    }
    return false;
  }

  private async sendFeishuMessage(chatId: string, text: string): Promise<void> {
    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
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

  /**
   * 发送飞书卡片消息
   * 将文本内容转换为美观的卡片格式
   */
  private async sendCardMessage(chatId: string, text: string): Promise<void> {
    const cardContent = this.buildCardContent(text);

    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
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

  /**
   * 构建卡片内容
   * 将纯文本转换为飞书卡片 JSON 格式
   */
  private buildCardContent(text: string): Record<string, unknown> {
    const elements: Array<Record<string, unknown>> = [];
    const lines = text.split('\n');

    let currentSection: Array<Record<string, unknown>> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 处理标题（## 标题 或 **标题**）
      if (
        line.startsWith('## ') ||
        (line.startsWith('**') && line.endsWith('**') && line.length < 100)
      ) {
        // 先提交当前段落
        if (currentSection.length > 0) {
          elements.push(...currentSection);
          currentSection = [];
        }

        const titleText = line.replace(/^##\s+|\*\*/g, '').trim();
        elements.push({
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**${titleText}**`,
          },
        });
        continue;
      }

      // 处理分隔线
      if (line === '---') {
        if (currentSection.length > 0) {
          elements.push(...currentSection);
          currentSection = [];
        }
        elements.push({
          tag: 'hr',
        });
        continue;
      }

      // 处理项目符号列表
      const bulletMatch = line.match(/^[\s]*[•\-\*]\s+(.*)$/);
      if (bulletMatch) {
        const content = bulletMatch[1];
        // 转换链接为飞书格式
        const processedContent = this.processLinks(content);
        currentSection.push({
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `• ${processedContent}`,
          },
        });
        continue;
      }

      // 处理普通文本（转换链接）
      const processedLine = this.processLinks(line);
      currentSection.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: processedLine,
        },
      });
    }

    // 提交剩余段落
    if (currentSection.length > 0) {
      elements.push(...currentSection);
    }

    // 构建完整卡片
    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: `${ASSISTANT_NAME} 回复`,
        },
        template: 'blue',
      },
      elements,
    };
  }

  /**
   * 处理文本中的链接，转换为飞书 markdown 格式
   */
  private processLinks(text: string): string {
    // 转换 [标题](URL) 格式
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)');
    // 转换纯 URL 为链接格式
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
    // WebSocket client will auto-reconnect, no explicit stop needed
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // 飞书没有直接的打字指示器 API
    logger.debug({ jid, isTyping }, 'Typing indicator not supported in Feishu');
  }

  /**
   * 同步群组元数据（飞书版本）
   * 获取用户参与的群组列表
   */
  async syncGroupMetadata(force = false): Promise<void> {
    try {
      const response = await this.client.im.v1.chat.list({
        params: {
          page_size: 100,
        },
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
          true, // Assume all listed chats are groups
        );
      }
    } catch (err) {
      logger.error({ err }, 'Failed to sync Feishu group metadata');
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing Feishu outgoing queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        try {
          await this.sendFeishuMessage(item.chatId, item.text);
          logger.info({ chatId: item.chatId }, 'Queued Feishu message sent');
        } catch (err) {
          // 发送失败，放回队列
          this.outgoingQueue.unshift(item);
          throw err;
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
