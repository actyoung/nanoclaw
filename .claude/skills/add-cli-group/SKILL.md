# Add CLI Group

Create a new CLI group for isolated CLI-based agent contexts.

## Usage

```
/add-cli-group <name>
```

Or directly:
```
npx tsx scripts/add-cli-group.ts <name>
```

## Examples

- `/add-cli-group dev` - Create cli:dev group
- `/add-cli-group test` - Create cli:test group
- `/add-cli-group staging` - Create cli:staging group

## What It Does

1. Creates `groups/cli-{name}/` folder with logs subdirectory
2. Creates `groups/cli-{name}/CLAUDE.md` with group context
3. Registers the group in the database with JID `cli:{name}`
4. The new group is immediately available in the CLI client

## Group Isolation

Each CLI group has:
- Separate file system (`groups/cli-{name}/`)
- Separate session/memory
- Separate message history
- Separate tasks and scheduled jobs

## CLI Commands

When using the CLI client:
- `/groups` - Show group selector
- `/switch <folder>` - Switch to a specific group (e.g., `/switch cli-dev`)
- `/help` - Show all available commands

## Notes

- Group name should be alphanumeric with hyphens/underscores
- Folder will be `cli-{name}` (prefixed automatically)
- Main CLI group (`cli:main`) is always available
- Groups are selected at startup if multiple exist
