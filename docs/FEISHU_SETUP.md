# Feishu (Lark) Bot Setup Guide

This guide explains how to set up NanoClaw with Feishu (Lark) as the messaging channel.

## Overview

NanoClaw uses Feishu's official Node.js SDK (`@larksuiteoapi/node-sdk`) with WebSocket long connection to:
- Receive messages in real-time via persistent WebSocket connection
- Send replies using Feishu's Message API
- Support both private chats (p2p) and group chats

**Advantage:** No public URL or server required - runs directly on your local machine.

## Prerequisites

1. A Feishu account (can be personal or enterprise)
2. Access to [Feishu Open Platform](https://open.feishu.cn/)

## Step 1: Create a Feishu App

1. Go to [Feishu Open Platform](https://open.feishu.cn/app)
2. Click "Create App" → "Custom App"
3. Fill in the basic information:
   - App Name: e.g., "NanoClaw Assistant"
   - App Description: Your personal AI assistant
   - App Avatar: Upload an image (optional)
4. Click "Create"

## Step 2: Configure Bot Features

1. In your app dashboard, go to "Bot" tab
2. Enable "Bot" feature
3. Set bot visibility: Visible to all employees (or as needed)
4. Save the changes

## Step 3: Get Credentials

1. In your app dashboard, go to "Credentials & Basic Info"
2. Copy the following:
   - **App ID** (e.g., `cli_xxxxxxxxxxxxxxxx`)
   - **App Secret** (click "Show" to reveal)

3. Add these to your `.env` file:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Step 4: Enable WebSocket Long Connection

NanoClaw uses the official Feishu Node.js SDK (`@larksuiteoapi/node-sdk`) with WebSocket long connection to receive events, so you don't need to configure a public webhook URL.

1. In your app dashboard, go to "Event Subscriptions" (事件与回调)
2. Select **"Receive events/callbacks through persistent connection"** (使用长连接接收事件/回调)
3. Add subscription events:
   - `im.message.receive_v1` - Receive all messages

## Step 5: Configure Permissions

1. Go to "Permissions & Scopes"
2. Add the following permissions:
   - `im:chat:readonly` - Read chat information
   - `im:message:send` - Send messages
   - `im:message.group_msg` - Send group messages
   - `im:message.p2p_msg` - Send private messages

## Step 6: Publish the App

1. Go to "Versions & Releases"
2. Click "Create Version"
3. Fill in version information
4. Submit for approval (personal apps are auto-approved)
5. Once approved, the bot becomes available

## Step 7: Configure NanoClaw

1. Update your `.env` file with all Feishu credentials:

```bash
# Feishu Configuration
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

2. Run the setup verification:
```bash
npm run setup -- --step feishu-auth
```

3. Build and start NanoClaw:
```bash
npm run build
npm start
```

## Step 8: Add Bot to Groups

1. In Feishu, open the group you want to add the bot to
2. Click the group settings → "Group Apps"
3. Search for your bot name
4. Add the bot to the group

## Step 9: Register Groups in NanoClaw

Once the bot is added to groups and messages have been received, register the groups:

```bash
npm run setup -- --step register --jid feishu:chat_id --name "Group Name" --folder main
```

To find the chat ID, check the logs or database after the bot receives a message in the group.

## Troubleshooting

### Bot doesn't receive messages
- Verify "Long Connection" mode is enabled (not HTTP webhook)
- Check that `im.message.receive_v1` event is subscribed
- Ensure bot has been added to the chat
- Check NanoClaw logs for incoming events

### Cannot send messages
- Verify `im:message:send` permission is granted
- Check that `FEISHU_APP_SECRET` is correct
- Ensure token hasn't expired (automatically refreshed)

## Architecture Notes

### JID Format
Feishu chat JIDs use the format: `feishu:{chat_id}`
- Example: `feishu:oc_xxxxxxxxxxxxxxxx`

### Message Flow
1. User sends message in Feishu
2. Feishu pushes event via WebSocket long connection
3. NanoClaw receives and parses the event
4. Message stored in database
5. Agent processes the message
6. Reply sent via Feishu Message API

### Differences from WhatsApp
- **Connection**: WebSocket long connection (no public URL needed)
- **Authentication**: App ID/Secret instead of QR code
- **Typing indicators**: Not supported by Feishu API
- **Group sync**: Happens at runtime as messages arrive
