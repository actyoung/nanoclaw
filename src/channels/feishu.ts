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
  private outgoingQueue: Array<{ chatId: string; text: string }> = [];
  private flushing = false;
  private botOpenId: string | null = null;
  private botName: string | null = null;

  // 用户名字缓存 (open_id -> name)
  private userNameCache: Map<string, string> = new Map();

  // 消息表情跟踪 (chat_jid:message_id -> emoji_type) - 用于后续更新表情
  private messageReactions: Map<string, FeishuEmojiType> = new Map();

  // 跟踪每个聊天的最后一条用户消息 ID - 用于后续更新表情
  private lastUserMessageId: Map<string, string> = new Map();

  // 心跳检测相关
  private lastMessageTime = Date.now();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 30_000; // 30秒检查一次
  private readonly HEARTBEAT_TIMEOUT_MS = 5 * 60_000; // 5分钟超时

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
    try {
      // 使用原始 HTTP 获取 tenant access token
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

      // 获取机器人信息
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
          'Feishu bot info fetched successfully',
        );
      } else {
        logger.warn({ code: botData.code }, 'Failed to fetch bot info');
      }
    } catch (err) {
      logger.warn(
        { err },
        'Error fetching bot info, will retry on next message',
      );
    }
  }

  /**
   * 获取用户名字，优先从缓存中获取，否则调用 API
   */
  private async fetchUserName(openId: string): Promise<string | null> {
    // 先检查缓存
    if (this.userNameCache.has(openId)) {
      return this.userNameCache.get(openId)!;
    }

    try {
      const response = await this.client.contact.v3.user.get({
        params: {
          user_id_type: 'open_id',
        },
        path: {
          user_id: openId,
        },
      });

      logger.info(
        {
          openId: openId.slice(0, 8),
          code: response.code,
          data: response.data,
        },
        'User API response',
      );

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

  /**
   * 检查消息是否 @ 了机器人
   * 通过比对 mention 的 open_id 和 botOpenId 来判断
   * 同时支持 @所有人 (@_all) 触发
   */
  private isBotMentioned(message: FeishuMessageEvent['message']): boolean {
    // 检查是否有 @所有人
    const parsedContent = JSON.parse(message.content || '{}');
    if (parsedContent.text?.includes('@_all')) {
      return true;
    }

    if (!message.mentions || message.mentions.length === 0) {
      return false;
    }

    // 如果已知 botOpenId，检查是否有 mention 的 open_id 匹配
    if (this.botOpenId) {
      return message.mentions.some((m) => m.id.open_id === this.botOpenId);
    }

    // Fallback: if we don't know botOpenId yet, assume any mention might be us
    // This will be refined once botOpenId is fetched
    return true;
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
          this.updateLastMessageTime(); // 连接成功时更新时间
          logger.info('Feishu WebSocket connected (via system callback)');
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
    // 重连后 system.call_back_v2 可能不会被触发，所以使用延迟作为后备
    setTimeout(() => {
      if (!this.connected) {
        this.connected = true;
        logger.info('Feishu WebSocket connected (via timeout fallback)');
        this.flushOutgoingQueue().catch((err) =>
          logger.error({ err }, 'Failed to flush outgoing queue'),
        );
      }
    }, 5000);

    // 启动心跳检测
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    // 避免重复启动心跳
    if (this.heartbeatInterval) {
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      this.checkConnectionHealth();
    }, this.HEARTBEAT_INTERVAL_MS);

    logger.info(
      {
        intervalMs: this.HEARTBEAT_INTERVAL_MS,
        timeoutMs: this.HEARTBEAT_TIMEOUT_MS,
      },
      'WebSocket heartbeat monitoring started',
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.info('WebSocket heartbeat monitoring stopped');
    }
  }

  private checkConnectionHealth(): void {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    const timeoutThreshold = this.HEARTBEAT_TIMEOUT_MS;

    // 记录健康状态（每5分钟记录一次正常状态，避免日志过多）
    if (timeSinceLastMessage < timeoutThreshold) {
      const minutesSinceLastMessage = Math.floor(timeSinceLastMessage / 60_000);
      if (minutesSinceLastMessage > 0 && minutesSinceLastMessage % 5 === 0) {
        logger.info(
          {
            timeSinceLastMessageMs: timeSinceLastMessage,
            connected: this.connected,
          },
          'WebSocket heartbeat: connection healthy',
        );
      }
      return;
    }

    // 连接超时，需要重连
    logger.warn(
      {
        timeSinceLastMessageMs: timeSinceLastMessage,
        timeoutMs: timeoutThreshold,
      },
      'WebSocket heartbeat timeout - no message received for too long, reconnecting...',
    );

    // 标记为断开连接
    this.connected = false;

    // 尝试重新连接
    this.reconnect();
  }

  private reconnect(): void {
    try {
      logger.info('Attempting to reconnect WebSocket...');

      // 先停止心跳，避免重复
      this.stopHeartbeat();

      // 重置连接状态
      this.connected = false;

      // 停止现有客户端（如果可能）
      try {
        // @ts-expect-error - SDK 类型定义不完整，但实际有此方法
        this.wsClient?.stop?.();
      } catch (err) {
        logger.debug(
          { err },
          'Error stopping WebSocket client (expected if already disconnected)',
        );
      }

      // 重置最后消息时间，给新连接一个宽限期
      this.lastMessageTime = Date.now();

      // 重新创建 WebSocket 客户端（stop 后不能重用）
      const config = {
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
        loggerLevel: Lark.LoggerLevel.info,
      };
      this.wsClient = new Lark.WSClient({
        ...config,
        loggerLevel: Lark.LoggerLevel.info,
      });

      // 重新启动 WebSocket
      this.startWebSocket();

      logger.info('WebSocket reconnection initiated');
    } catch (err) {
      logger.error({ err }, 'Failed to reconnect WebSocket');
    }
  }

  private updateLastMessageTime(): void {
    this.lastMessageTime = Date.now();
  }

  private async handleMessage(data: FeishuMessageEvent): Promise<void> {
    // 更新最后消息时间（心跳检测用）
    this.updateLastMessageTime();

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
          '" --name "main" --folder main',
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

    // 优先从 mentions 中获取发送者名字（如果发送者 @ 了自己）
    let senderName = message.mentions?.find(
      (m) => m.id.open_id === senderId,
    )?.name;

    // 如果 mentions 中没有，尝试从缓存或 API 获取
    if (!senderName) {
      const cachedName = this.userNameCache.get(senderId);
      if (cachedName) {
        senderName = cachedName;
      } else {
        // 异步获取用户名字，不阻塞消息处理
        this.fetchUserName(senderId).then((name) => {
          if (name) {
            logger.debug(
              { openId: senderId.slice(0, 8), name },
              'Fetched user name',
            );
          }
        });
        // 临时使用 open_id 前 8 位
        senderName = senderId.slice(0, 8);
      }
    }

    // 检查是否是机器人消息（通过 open_id 匹配）
    const isFromMe = senderId === this.botOpenId;
    const isBotMessage = isFromMe;

    // 检查是否 @ 了机器人（用于触发检测）
    const isMentioned = this.isBotMentioned(message);

    // 将所有 @_user_X 替换为实际的 @名称，如果是已知机器人则添加标记
    let processedContent = content;

    // 替换 @_all 为 @所有人
    processedContent = processedContent.replaceAll('@_all', '@所有人');

    if (message.mentions && message.mentions.length > 0) {
      logger.info(
        {
          mentions: message.mentions.map((m) => ({
            key: m.key,
            name: m.name,
            open_id: m.id.open_id.slice(0, 8) + '...',
          })),
        },
        'Mentions detail for replacement',
      );

      for (const mention of message.mentions) {
        const isOtherBot = mention.id.open_id !== this.botOpenId;

        let displayName = mention.name;
        if (isOtherBot) {
          displayName = `${mention.name}[机器人]`;
        }

        processedContent = processedContent.replaceAll(
          mention.key,
          `@${displayName}`,
        );
      }
    }

    // 获取机器人名称用于日志
    const botMention = message.mentions?.find(
      (m) => m.id.open_id === this.botOpenId,
    );
    const botName = botMention?.name || 'Bot';

    const newMessage: NewMessage = {
      id: message.message_id,
      chat_jid: chatJid,
      sender: senderId,
      sender_name: senderName,
      content: processedContent,
      timestamp,
      is_from_me: isFromMe,
      is_bot_message: isBotMessage,
      is_mentioned: isMentioned,
    };

    logger.info(
      {
        chatJid,
        sender: senderName,
        content: processedContent.slice(0, 100),
        isMentioned,
        botName,
      },
      `Feishu message received${isMentioned ? ` (triggered via @${botName})` : ''}`,
    );

    // 为收到的消息添加默认"已收到"表情，并跟踪消息ID用于后续更新
    if (!isFromMe) {
      this.lastUserMessageId.set(chatJid, message.message_id);
      this.addReaction(message.message_id, 'Get', chatJid).catch(() => {});
    }

    this.opts.onMessage(chatJid, newMessage);
  }

  /**
   * 为消息添加表情回应
   * @param messageId 消息 ID
   * @param emojiType 表情类型
   * @param chatJid 可选，用于跟踪表情状态
   */
  private async addReaction(
    messageId: string,
    emojiType: FeishuEmojiType,
    chatJid?: string,
  ): Promise<void> {
    try {
      const response = await this.client.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      });
      if (response.code !== 0) {
        logger.warn(
          {
            messageId: messageId.slice(0, 8),
            code: response.code,
            msg: response.msg,
          },
          'Failed to add reaction - check permission: im:message.reaction:write',
        );
      } else if (chatJid) {
        // 记录表情状态，用于后续更新
        this.messageReactions.set(`${chatJid}:${messageId}`, emojiType);
      }
    } catch (err) {
      logger.warn(
        { messageId: messageId.slice(0, 8), err },
        'Error adding reaction - check permission: im:message.reaction:write',
      );
    }
  }

  /**
   * 获取消息的所有表情回应
   * @param messageId 消息 ID
   */
  private async getReactions(messageId: string): Promise<Array<{ reaction_id: string; emoji_type: string }>> {
    try {
      const response = await this.client.im.v1.messageReaction.list({
        path: { message_id: messageId },
      });
      if (response.code === 0 && response.data?.items) {
        return response.data.items.map((item: { reaction_id?: string; emoji_type?: string }) => ({
          reaction_id: item.reaction_id || '',
          emoji_type: item.emoji_type || '',
        })).filter((item: { reaction_id: string }) => item.reaction_id);
      }
    } catch (err) {
      logger.debug({ messageId: messageId.slice(0, 8), err }, 'Error getting reactions');
    }
    return [];
  }

  /**
   * 更新消息表情回应 - 添加新表情（保留旧表情）
   * @param chatJid 聊天 JID
   * @param messageId 消息 ID
   * @param newEmoji 新表情类型
   */
  async updateReaction(
    chatJid: string,
    messageId: string,
    newEmoji: FeishuEmojiType,
  ): Promise<void> {
    // 获取当前所有表情
    const currentReactions = await this.getReactions(messageId);

    // 检查新表情是否已存在
    const hasNewEmoji = currentReactions.some((r) => r.emoji_type === newEmoji);
    if (!hasNewEmoji) {
      // 添加新表情（保留所有旧表情）
      await this.addReaction(messageId, newEmoji, chatJid);
    }

    // 更新跟踪状态
    const key = `${chatJid}:${messageId}`;
    this.messageReactions.set(key, newEmoji);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // 从 feishu:chatId 格式提取 chatId
    const chatId = jid.startsWith('feishu:') ? jid.slice(7) : jid;

    // 根据 Agent 回复内容自动选择合适的表情
    const agentEmoji = selectEmojiForMessage(text);

    if (!this.connected) {
      this.outgoingQueue.push({ chatId, text });
      logger.info(
        { chatId, queueSize: this.outgoingQueue.length },
        'Feishu disconnected, message queued',
      );
      return;
    }

    try {
      // 自动识别是否使用卡片消息
      if (this.shouldUseCardMessage(text)) {
        await this.sendCardMessage(chatId, text);
        logger.info(
          { chatId, length: text.length },
          'Feishu card message sent',
        );
      } else {
        await this.sendFeishuMessage(chatId, text);
        logger.info(
          { chatId, length: text.length },
          'Feishu text message sent',
        );
      }

      // Agent 回复后，更新最后一条用户消息的表情
      const lastMessageId = this.lastUserMessageId.get(jid);
      logger.info(
        { jid, lastMessageId: lastMessageId?.slice(0, 8), agentEmoji },
        'Checking reaction update',
      );
      if (lastMessageId && agentEmoji) {
        this.updateReaction(jid, lastMessageId, agentEmoji).then(
          () => {
            logger.info(
              { jid, lastMessageId: lastMessageId.slice(0, 8), agentEmoji },
              'Reaction updated successfully',
            );
          },
          (err) => {
            logger.warn(
              { jid, lastMessageId: lastMessageId.slice(0, 8), agentEmoji, err },
              'Failed to update reaction',
            );
          },
        );
      }
    } catch (err) {
      this.outgoingQueue.push({ chatId, text });
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
          content: '回复',
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

    // 清理心跳检测
    this.stopHeartbeat();

    // WebSocket client will auto-reconnect, no explicit stop needed
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // 飞书没有直接的打字指示器 API
    logger.debug({ jid, isTyping }, 'Typing indicator not supported in Feishu');
  }

  /**
   * 获取机器人在飞书上的显示名称
   */
  getBotName(): string | null {
    return this.botName;
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

// Self-register the Feishu channel
registerChannel('feishu', (opts: ChannelOpts) => {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    logger.debug(
      'Feishu: FEISHU_APP_ID or FEISHU_APP_SECRET not set, skipping',
    );
    return null;
  }
  return new FeishuChannel(opts);
});
