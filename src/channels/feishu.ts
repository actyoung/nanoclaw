import * as Lark from '@larksuiteoapi/node-sdk';
import { logger } from '../logger.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
  NewMessage,
} from '../types.js';
import {
  FEISHU_APP_ID,
  FEISHU_APP_SECRET,
  ASSISTANT_NAME,
} from '../config.js';

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
            logger.error({ err }, 'Failed to flush outgoing queue')
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
    logger.info({ eventType: 'im.message.receive_v1', data }, 'Received Feishu event');

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
      logger.info({ chatJid, chatId, chatType }, 'Received message from unregistered Feishu chat. To register, run: npm run setup -- --step register --jid "' + chatJid + '" --name "My Group" --trigger "@Andy" --folder main');
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
    const senderName = message.mentions?.find(
      (m) => m.id.open_id === senderId
    )?.name || senderId.slice(0, 8);

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
      'Feishu message received'
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
        'Feishu disconnected, message queued'
      );
      return;
    }

    try {
      await this.sendFeishuMessage(chatId, prefixed);
      logger.info({ chatId, length: prefixed.length }, 'Feishu message sent');
    } catch (err) {
      this.outgoingQueue.push({ chatId, text: prefixed });
      logger.warn(
        { chatId, err, queueSize: this.outgoingQueue.length },
        'Failed to send Feishu message, queued'
      );
    }
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
      throw new Error(`Feishu API error: ${response.msg} (code: ${response.code})`);
    }
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
          true // Assume all listed chats are groups
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
        'Flushing Feishu outgoing queue'
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
