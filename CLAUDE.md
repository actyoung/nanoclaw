# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (Feishu, Telegram, Slack, Discord, Gmail, CLI) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

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

## Channel Documentation

- **[docs/CLI.md](docs/CLI.md)** - CLI channel (voice input/output, API debug panel)
- **[docs/FEISHU.md](docs/FEISHU.md)** - Feishu channel (message reactions, connection troubleshooting)
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture documentation

## Troubleshooting

### Database & Storage

**Database file location:**
- SQLite database: `store/messages.db` (relative to project root)
- IPC files: `data/ipc/{group-folder}/`
- Session cache: `data/sessions/{group-folder}/`
- Group files: `groups/{name}/`

**Database locked or corrupted:**
- Stop NanoClaw: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
- Backup: `cp store/messages.db store/messages.db.bak`
- Check integrity: `sqlite3 store/messages.db "PRAGMA integrity_check;"`
- If corrupted, restore from backup or delete to start fresh

**Disk space issues:**
- NanoClaw requires >100MB free space on startup
- Check: `df -h .` (run in project directory)
- Clean up: `rm -rf data/sessions/*/container-*.log` (old container logs)

### Container Issues

**Agent container fails to start:**
- Run `/debug` for diagnostic checks
- Check container logs: `docker logs nanoclaw-agent` (or use `/debug`)
- Verify container image is built: `./container/build.sh`

**Container build fails:**
- Prune buildkit cache: `docker builder prune -f`
- Rebuild: `./container/build.sh`
