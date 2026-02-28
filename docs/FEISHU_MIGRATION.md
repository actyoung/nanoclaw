# WhatsApp to Feishu Migration Summary

This document summarizes the changes made to replace WhatsApp integration with Feishu (Lark) bot integration.

## Overview

The codebase has been migrated from WhatsApp Web (using Baileys library) to Feishu Bot API. This enables NanoClaw to receive and send messages through Feishu's official bot platform.

## Key Changes

### 1. Channel Implementation (`src/channels/`)

**Removed:**
- `src/channels/whatsapp.ts` - WhatsApp Web implementation
- `src/channels/whatsapp.test.ts` - WhatsApp tests

**Added:**
- `src/channels/feishu.ts` - Feishu bot implementation using official SDK
  - WebSocket long connection for receiving events
  - Token management (automatic by SDK)
  - Event parsing (`im.message.receive_v1`)
  - Message sending via Feishu Message API
  - Group metadata sync

### 2. Dependencies (`package.json`)

**Removed:**
- `@whiskeysockets/baileys` - WhatsApp Web library
- `qrcode` - QR code generation
- `qrcode-terminal` - Terminal QR display

**Added:**
- `@larksuiteoapi/node-sdk` - Official Feishu SDK for WebSocket long connection

### 3. Configuration (`src/config.ts`)

**Added environment variables:**
```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Note:** HTTP server port is fixed at `3000` for webhook endpoint.

### 4. Main Entry Point (`src/index.ts`)

- Replaced `WhatsAppChannel` with `FeishuChannel`
- Updated IPC `syncGroupMetadata` to use Feishu

### 5. Database (`src/db.ts`)

- Added migration for Feishu JID pattern (`feishu:%`)

### 6. Setup Scripts (`setup/`)

**Removed:**
- `setup/whatsapp-auth.ts` - WhatsApp authentication

**Added:**
- `setup/feishu-auth.ts` - Feishu credential verification

**Updated:**
- `setup/index.ts` - Changed step from `whatsapp-auth` to `feishu-auth`
- `setup/groups.ts` - Updated for Feishu group discovery
- `setup/verify.ts` - Changed WhatsApp auth check to Feishu config check

### 7. Documentation

**Added:**
- `docs/FEISHU_SETUP.md` - Complete setup guide for Feishu bot

**Updated:**
- `CLAUDE.md` - Updated key files reference
- `docs/REQUIREMENTS.md` - Updated architecture decisions
- `.env.example` - Added Feishu configuration

## Architecture Differences

### Connection Model
- **WhatsApp**: WebSocket connection (persistent)
- **Feishu**: HTTP webhook (event-driven)

### Authentication
- **WhatsApp**: QR code scan, session files stored in `store/auth/`
- **Feishu**: App ID/App Secret, token-based authentication

### Message Reception
- **WhatsApp**: `messages.upsert` event via WebSocket
- **Feishu**: WebSocket long connection (no public URL needed)

### Message Sending
- **WhatsApp**: Direct WebSocket send
- **Feishu**: REST API call with Bearer token

### Connection Model
- **WhatsApp**: WebSocket connection (persistent)
- **Feishu**: WebSocket long connection (persistent, no server required)

### Typing Indicators
- **WhatsApp**: Supported via presence updates
- **Feishu**: Not supported by API

### Group Sync
- **WhatsApp**: Proactive fetch via `groupFetchAllParticipating()`
- **Feishu**: Reactive - groups discovered as messages arrive

## JID Format

Chat identifiers now use Feishu format:
- **Before**: `123456789@g.us` (WhatsApp group)
- **After**: `feishu:oc_xxxxxxxxxxxxxxxx` (Feishu chat)

## Setup Process

### Before (WhatsApp)
```bash
npm run setup -- --step whatsapp-auth  # Scan QR code
npm run setup -- --step groups         # Sync groups
npm run setup -- --step register       # Register groups
```

### After (Feishu)
```bash
# 1. Create bot in Feishu Open Platform
# 2. Configure webhook URL
# 3. Add credentials to .env
npm run setup -- --step feishu-auth    # Verify credentials
npm run setup -- --step groups         # Prepare database
npm run setup -- --step register       # Register groups
```

## Backwards Compatibility

- Database schema is compatible (JID column accepts any string)
- Registered groups need to be re-registered with Feishu JIDs
- Message history is preserved but old JIDs won't match new messages

## Testing

All existing tests pass (311 tests). The Feishu implementation doesn't include unit tests yet (can be added following the same patterns as other channels).

## Next Steps

1. Create a Feishu app at https://open.feishu.cn/app
2. Configure webhook URL pointing to your server
3. Add bot to desired Feishu groups
4. Set environment variables in `.env`
5. Run setup and register groups
6. Start the service

See `docs/FEISHU_SETUP.md` for detailed instructions.
