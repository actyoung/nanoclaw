# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (Feishu, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

## Feishu Branch Features

This branch includes Feishu as the default channel and adds several enhancements:

### CLI Voice Interaction

The CLI group supports voice input/output for hands-free interaction:

- **Voice Input**: Press `Ctrl+R` to start recording, `Enter` to stop and transcribe
  - Uses local whisper.cpp for offline speech-to-text (free, no API calls)
  - Requires: `brew install ffmpeg whisper-cpp`
  - Download model: `curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o data/models/ggml-base.bin`

- **Voice Output (TTS)**: Press `Ctrl+T` to toggle text-to-speech
  - Uses macOS `say` command by default (free, offline, supports multiple languages)
  - Optional: OpenAI TTS API for higher quality voices (set `OPENAI_API_KEY`)

- **Voice Indicator**: Shows recording status (🔴), transcribing (⏳), speaking (💬), or ready (🎤)

### API Debug Panel

CLI groups display real-time API request information:
- Model being used
- Message count in context
- Max tokens setting
- First message preview
- Request status (in flight/completed)

### Feishu Message Reactions

NanoClaw uses Feishu message reactions (emojis) to provide visual feedback:

| Scenario | Reaction |
|----------|----------|
| Message received | Get, OK, THUMBSUP |
| Processing | Typing, OnIt, OneSecond |
| Success/Completion | DONE, LGTM, CheckMark |
| Error | ERROR, CrossMark, FACEPALM |

Reactions are selected based on message content keywords (supports English and Chinese).

## Troubleshooting

### Feishu Connection Issues

**Bot doesn't receive messages:**
- Verify "Long Connection" mode is enabled in Feishu app settings (not HTTP webhook)
- Check that `im.message.receive_v1` event is subscribed
- Ensure bot has been added to the chat and the app is published
- Check NanoClaw logs for incoming events: `tail -f logs/app.log`

**Cannot send messages:**
- Verify `im:message:send` permission is granted in Feishu app permissions
- Check that `FEISHU_APP_SECRET` is correct in `.env`
- Ensure token hasn't expired (automatically refreshed by SDK)

**WebSocket connection drops:**
- Feishu SDK auto-reconnects on connection loss
- Check network stability
- Monitor logs for reconnection events

### CLI Voice Issues

**Recording fails:**
- Check ffmpeg is installed: `brew install ffmpeg`
- Check whisper-cli is installed: `brew install whisper-cpp`
- Download the model file to `data/models/ggml-base.bin`

**TTS not working:**
- macOS `say` command should work out of the box
- For OpenAI TTS, verify `OPENAI_API_KEY` is set

### Container Issues

**Agent container fails to start:**
- Run `/debug` for diagnostic checks
- Check container logs: `docker logs nanoclaw-agent` (or use `/debug`)
- Verify container image is built: `./container/build.sh`

**Container build fails:**
- Prune buildkit cache: `docker builder prune -f`
- Rebuild: `./container/build.sh`
