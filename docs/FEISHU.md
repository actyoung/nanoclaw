# Feishu (Lark) Channel Documentation

This document describes the Feishu (Lark) messaging channel for NanoClaw.

---

## Features

### Message Reactions

NanoClaw uses Feishu message reactions (emojis) to provide visual feedback:

| Scenario | Reaction |
|----------|----------|
| Message received | Get, OK, THUMBSUP |
| Processing | Typing, OnIt, OneSecond |
| Success/Completion | DONE, LGTM, CheckMark |
| Error | ERROR, CrossMark, FACEPALM |

Reactions are selected based on message content keywords (supports English and Chinese).

---

## Setup Guide

### Prerequisites

1. A Feishu account (personal or enterprise)
2. Access to [Feishu Open Platform](https://open.feishu.cn/)

### Step 1: Create a Feishu App

1. Go to [Feishu Open Platform](https://open.feishu.cn/app)
2. Click "Create App" → "Custom App"
3. Fill in basic information:
   - App Name: e.g., "NanoClaw Assistant"
   - App Description: Your personal AI assistant
   - App Avatar: Upload an image (optional)
4. Click "Create"

### Step 2: Enable Bot Feature

1. In your app dashboard, go to "Bot" tab
2. Enable "Bot" feature
3. Set bot visibility: Visible to all employees (or as needed)
4. Save changes

### Step 3: Get Credentials

1. In app dashboard, go to "Credentials & Basic Info"
2. Copy the following:
   - **App ID** (e.g., `cli_xxxxxxxxxxxxxxxx`)
   - **App Secret** (click "Show" to reveal)
3. Add to `.env` file:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Step 4: Enable WebSocket Long Connection

NanoClaw uses Feishu's official Node.js SDK with WebSocket long connection:

1. In app dashboard, go to "Event Subscriptions" (事件与回调)
2. Select **"Receive events through persistent connection"** (使用长连接接收事件)
3. Add subscription event: `im.message.receive_v1`

### Step 5: Configure Permissions

1. Go to "Permissions & Scopes"
2. Add permissions:
   - `im:chat:readonly` - Read chat information
   - `im:message:send` - Send messages
   - `im:message.group_msg` - Send group messages
   - `im:message.p2p_msg` - Send private messages

### Step 6: Publish the App

1. Go to "Versions & Releases"
2. Click "Create Version"
3. Fill in version information
4. Submit for approval (personal apps are auto-approved)
5. Once approved, bot becomes available

### Step 7: Add Bot to Groups

1. In Feishu, open the group to add the bot
2. Click group settings → "Group Apps"
3. Search for your bot name
4. Add bot to group

### Step 8: Register Groups in NanoClaw

Once bot receives messages in groups, register them:

```bash
# Find chat ID from logs after bot receives a message
npm run setup -- --step register --jid feishu:chat_id --name "Group Name" --folder main
```

---

## Architecture

### JID Format

Feishu chat JIDs use format: `feishu:{chat_id}`
- Example: `feishu:oc_xxxxxxxxxxxxxxxx`

### Message Flow

1. User sends message in Feishu
2. Feishu pushes event via WebSocket long connection
3. NanoClaw receives and parses event
4. Message stored in database
5. Agent processes message
6. Reply sent via Feishu Message API

### Key Differences from WhatsApp

| Feature | WhatsApp | Feishu |
|---------|----------|--------|
| Connection | WebSocket | WebSocket long connection |
| Authentication | QR code | App ID/Secret |
| Typing indicators | Supported | Not supported by API |
| Group sync | Proactive fetch | Runtime discovery |

---

## Troubleshooting

### Bot Doesn't Receive Messages

- Verify "Long Connection" mode enabled (not HTTP webhook)
- Check `im.message.receive_v1` event is subscribed
- Ensure bot added to chat and app published
- Check NanoClaw logs: `tail -f logs/app.log`

### Cannot Send Messages

- Verify `im:message:send` permission granted
- Check `FEISHU_APP_SECRET` is correct in `.env`
- Token auto-refreshed by SDK

### WebSocket Connection Drops

- Feishu SDK auto-reconnects on connection loss
- Check network stability
- Monitor logs for reconnection events

---

## Migration from WhatsApp

See [docs/FEISHU_MIGRATION.md](FEISHU_MIGRATION.md) for detailed migration notes from WhatsApp to Feishu.
