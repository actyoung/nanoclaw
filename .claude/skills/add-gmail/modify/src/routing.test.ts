import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, getAllChats, storeChatMetadata } from './db.js';
import { getAvailableGroups, _setRegisteredGroups } from './index.js';

beforeEach(() => {
  _initTestDatabase();
  _setRegisteredGroups({});
});

// --- JID ownership patterns ---

describe('JID ownership patterns', () => {
  // These test the patterns that will become ownsJid() on the Channel interface

  it('Feishu group JID: ends with ', () => {
    const jid = '12345678';
    expect(jid.endsWith('')).toBe(true);
  });

  it('Feishu DM JID: ends with ', () => {
    const jid = '12345678';
    expect(jid.endsWith('')).toBe(true);
  });

  it('Gmail JID: starts with gmail:', () => {
    const jid = 'gmail:abc123def';
    expect(jid.startsWith('gmail:')).toBe(true);
  });

  it('Gmail thread JID: starts with gmail: followed by thread ID', () => {
    const jid = 'gmail:18d3f4a5b6c7d8e9';
    expect(jid.startsWith('gmail:')).toBe(true);
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns only groups, excludes DMs', () => {
    storeChatMetadata('group1', '2024-01-01T00:00:01.000Z', 'Group 1', 'feishu', true);
    storeChatMetadata('user', '2024-01-01T00:00:02.000Z', 'User DM', 'feishu', false);
    storeChatMetadata('group2', '2024-01-01T00:00:03.000Z', 'Group 2', 'feishu', true);

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.jid)).toContain('group1');
    expect(groups.map((g) => g.jid)).toContain('group2');
    expect(groups.map((g) => g.jid)).not.toContain('user');
  });

  it('excludes __group_sync__ sentinel', () => {
    storeChatMetadata('__group_sync__', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group', '2024-01-01T00:00:01.000Z', 'Group', 'feishu', true);

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group');
  });

  it('marks registered groups correctly', () => {
    storeChatMetadata('reg', '2024-01-01T00:00:01.000Z', 'Registered', 'feishu', true);
    storeChatMetadata('unreg', '2024-01-01T00:00:02.000Z', 'Unregistered', 'feishu', true);

    _setRegisteredGroups({
      'reg': {
        name: 'Registered',
        folder: 'registered',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });

    const groups = getAvailableGroups();
    const reg = groups.find((g) => g.jid === 'reg');
    const unreg = groups.find((g) => g.jid === 'unreg');

    expect(reg?.isRegistered).toBe(true);
    expect(unreg?.isRegistered).toBe(false);
  });

  it('returns groups ordered by most recent activity', () => {
    storeChatMetadata('old', '2024-01-01T00:00:01.000Z', 'Old', 'feishu', true);
    storeChatMetadata('new', '2024-01-01T00:00:05.000Z', 'New', 'feishu', true);
    storeChatMetadata('mid', '2024-01-01T00:00:03.000Z', 'Mid', 'feishu', true);

    const groups = getAvailableGroups();
    expect(groups[0].jid).toBe('new');
    expect(groups[1].jid).toBe('mid');
    expect(groups[2].jid).toBe('old');
  });

  it('excludes non-group chats regardless of JID format', () => {
    // Unknown JID format stored without is_group should not appear
    storeChatMetadata('unknown-format-123', '2024-01-01T00:00:01.000Z', 'Unknown');
    // Explicitly non-group with unusual JID
    storeChatMetadata('custom:abc', '2024-01-01T00:00:02.000Z', 'Custom DM', 'custom', false);
    // A real group for contrast
    storeChatMetadata('group', '2024-01-01T00:00:03.000Z', 'Group', 'feishu', true);

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group');
  });

  it('returns empty array when no chats exist', () => {
    const groups = getAvailableGroups();
    expect(groups).toHaveLength(0);
  });

  it('excludes Gmail threads from group list (Gmail threads are not groups)', () => {
    storeChatMetadata('gmail:abc123', '2024-01-01T00:00:01.000Z', 'Email thread', 'gmail', false);
    storeChatMetadata('group', '2024-01-01T00:00:02.000Z', 'Group', 'feishu', true);

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group');
  });
});
