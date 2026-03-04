---
name: skills-cli
description: Install and manage skills from skills.sh (Vercel Labs skill registry). Use to add new capabilities like web browsing, database access, API integrations, code review tools, and more. Helps discover and install skills when users ask "how do I do X", "find a skill for X", or express interest in extending capabilities.
allowed-tools: Bash
---

# Skills CLI - skills.sh Integration

Browse, install, discover, and manage skills from [skills.sh](https://skills.sh) - a community skill registry by Vercel Labs.

## Quick Start

```bash
skills add -g -a claude-code --copy vercel-labs/agent-skills    # Install a skill globally
skills list -g                                                   # List installed skills
skills find web                                                  # Search for skills
skills remove -g skill-name                                      # Remove a skill
skills check                                                     # Check for updates
skills update                                                    # Update all skills
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `skills add` | Install a skill from GitHub, GitLab, or local path |
| `skills list` | List installed skills (use `-g` for global) |
| `skills find` | Search for skills by keyword or interactively |
| `skills remove` | Remove installed skills |
| `skills check` | Check for available skill updates |
| `skills update` | Update all installed skills |

---

## Finding Skills

Use the `skills find` command to discover skills from the open agent skills ecosystem.

### When to Search for Skills

Search for skills when the user:
- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

### How to Search

```bash
skills find              # Interactive search
skills find web          # Search for web-related skills
skills find database     # Search for database skills
skills find "react performance"  # Multi-word queries
```

### Understanding Search Results

Results are returned in this format:

```
Install with npx skills add <owner/repo@skill>

vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### How to Help Users Find Skills

1. **Understand what they need** - Identify the domain, specific task, and whether a skill likely exists
2. **Run the search** - Use `skills find <query>` with relevant keywords
3. **Present options** - Show skill name, description, install command, and skills.sh link
4. **Offer to install** - If interested, install with `skills add -g -a claude-code --copy <source>`

### Example: Finding and Presenting a Skill

User asks: "how do I make my React app faster?"

```bash
# Search for relevant skills
skills find react performance
```

Then present to user:

> I found a skill that might help! The "vercel-react-best-practices" skill provides React and Next.js performance optimization guidelines from Vercel Engineering.
>
> To install it:
> ```
> skills add -g -a claude-code --copy vercel-labs/agent-skills
> ```
>
> Learn more: https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices

### Common Skill Categories

| Category | Example Queries |
|----------|-----------------|
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| Documentation | docs, readme, changelog, api-docs |
| Code Quality | review, lint, refactor, best-practices |
| Design | ui, ux, design-system, accessibility |
| Productivity | workflow, automation, git |

### Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"
3. **Check popular sources**: Many skills come from `vercel-labs/agent-skills` or `ComposioHQ/awesome-claude-skills`

### When No Skills Are Found

If no relevant skills exist:
1. Acknowledge that no existing skill was found
2. Offer to help with the task directly using general capabilities
3. Suggest the user could create their own skill with `npx skills init`

---

## Installing Skills

### Important: Always Use Global Install

In NanoClaw containers, **always use `-g`** for global installation:

```bash
skills add -g -a claude-code --copy <skill-source>
```

- Global path: `~/.claude/skills/` (persisted across sessions)
- The `-a claude-code` flag skips the interactive app selection
- Without `-g`, skills would be lost when the container restarts

### Use `--copy` for Persistence

By default, `skills add` creates symlinks. In NanoClaw containers, **always use `--copy`** to install actual files:

```bash
skills add -g -a claude-code --copy <skill-source>
```

- `--copy` installs actual files (not symlinks) to `~/.claude/skills/`
- This ensures skills persist when the container directory is mounted to the host
- Without `--copy`, only the symlink is persisted, not the actual skill files

### Install Commands

```bash
# Install from GitHub (most common)
skills add -g -a claude-code --copy vercel-labs/agent-skills
skills add -g -a claude-code --copy owner/repo

# Install from GitLab
skills add -g -a claude-code --copy gitlab:owner/repo

# Install from local path (for development)
skills add -g -a claude-code --copy ./path/to/skill

# Install specific skill from a monorepo
skills add -g -a claude-code --copy https://github.com/vercel-labs/skills --skill find-skills
skills add -g -a claude-code --copy https://github.com/owner/repo --skill specific-skill-name
```

### Installing from Monorepos

Some repositories contain multiple skills. Use `--skill` to install a specific one:

```bash
skills add -g -a claude-code --copy https://github.com/vercel-labs/next-skills --skill next-best-practices
```

**Common monorepos:**
- `vercel-labs/next-skills` - Contains: next-best-practices, etc.
- `microsoft/github-copilot-for-azure` - Contains: azure-ai, azure-storage, azure-deploy, etc.

---

## Listing and Removing Skills

### List Installed Skills

```bash
skills list -g              # List globally installed skills
skills list                 # List project-level skills
```

### Remove Skills

```bash
skills remove -g skill-name         # Remove by name
skills remove -g skill1 skill2      # Remove multiple
```

---

## Updating Skills

```bash
skills check                # Check for available updates
skills update               # Update all installed skills
```

---

## Popular Skills

| Skill | Install Command | Description |
|-------|-----------------|-------------|
| agent-skills | `skills add -g -a claude-code --copy vercel-labs/agent-skills` | Web search, file operations, data processing |
| next-best-practices | `skills add -g -a claude-code --copy vercel-labs/next-skills --skill next-best-practices` | Next.js best practices |

---

## Installation Flow

When you install a skill:

1. Run: `skills add -g -a claude-code --copy <source>`
2. The skill is downloaded and installed to `~/.claude/skills/`
3. The current session will be reset automatically
4. The next message will use a fresh session with the new skill loaded

---

## Skill Structure

Skills are directories containing:

```
skill-name/
└── SKILL.md          # Skill definition with YAML frontmatter
```

The `SKILL.md` file contains:

```yaml
---
name: skill-name
description: What this skill does
allowed-tools: Bash, Read, Write
---

# Skill documentation...
```

---

## Troubleshooting

**Skill not available after install?**
- The session resets automatically after installation
- Send a new message to get a fresh session with the new skill

**Permission denied?**
- Ensure you're using `-g` for global installation
- The container user (`node`) has write access to `~/.claude/skills/`

**Skill conflicts?**
- Skills are loaded in alphabetical order
- Later skills can override earlier ones with the same name

---

## Version Info

- **Current Version**: 1.0.0
- **Last Updated**: 2026-03-04
- **Supported Commands**: add, list, find, remove, check, update

---

## Resources

- **Skills Registry**: https://skills.sh
- **Vercel Labs Skills**: https://github.com/vercel-labs/skills
