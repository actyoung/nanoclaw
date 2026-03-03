# Intent: src/channels/feishu.ts modifications

## What changed
Added voice message transcription support to Feishu channel. When a voice/audio message is received, it is transcribed using OpenAI Whisper and the transcript is added to the message content.

## Key sections

### Imports (top of file)
- Added: `isVoiceMessage` and `transcribeFeishuVoiceMessage` from `./transcription.js`

### handleMessage() method
- Added: Voice message type detection before content parsing
- Added: `isVoice` boolean to track if message is voice
- Added: Conditional transcription block that:
  1. Calls `isVoiceMessage()` to detect voice messages
  2. Calls `transcribeFeishuVoiceMessage()` to transcribe audio
  3. Formats content as `[Voice: <transcript>]`
  4. Falls back to `[Voice Message - transcription unavailable]` on failure
- Added: Voice message marker in log output (`isVoice: true`)

### Log output
- Voice messages are logged with transcription info
- Content is formatted with `[Voice: ...]` prefix for agent visibility

## Invariants
- Text messages are unchanged in processing flow
- Voice messages that fail transcription show a fallback message
- The `processedContent` variable is formatted with `[Voice: ...]` for voice messages
- All existing message handling (mentions, triggers, metadata) works the same for voice messages
- Voice transcription only runs for registered groups (same as text messages)

## Dependencies
- Requires `src/transcription.ts` to be present (added by this skill)
- Uses `FEISHU_APP_ID` and `FEISHU_APP_SECRET` from config (already present)
- Uses `OPENAI_API_KEY` from env (added by this skill)

## Feishu API used
- Message Resource API: `GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}`
- Docs: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get
