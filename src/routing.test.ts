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

  it('Feishu group JID: starts with feishu:oc_', () => {
    const jid = 'feishu:oc_1234567890abcdef';
    expect(jid.startsWith('feishu:oc_')).toBe(true);
  });

  it('Feishu DM JID: starts with feishu:ou_', () => {
    const jid = 'feishu:ou_1234567890abcdef';
    expect(jid.startsWith('feishu:ou_')).toBe(true);
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns only groups, excludes DMs', () => {
    storeChatMetadata(
      'feishu:oc_group1',
      '2024-01-01T00:00:01.000Z',
      'Group 1',
      'feishu',
      true,
    );
    storeChatMetadata(
      'feishu:ou_user',
      '2024-01-01T00:00:02.000Z',
      'User DM',
      'feishu',
      false,
    );
    storeChatMetadata(
      'feishu:oc_group2',
      '2024-01-01T00:00:03.000Z',
      'Group 2',
      'feishu',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.jid)).toContain('feishu:oc_group1');
    expect(groups.map((g) => g.jid)).toContain('feishu:oc_group2');
    expect(groups.map((g) => g.jid)).not.toContain('feishu:ou_user');
  });

  it('excludes __group_sync__ sentinel', () => {
    storeChatMetadata('__group_sync__', '2024-01-01T00:00:00.000Z');
    storeChatMetadata(
      'feishu:oc_group',
      '2024-01-01T00:00:01.000Z',
      'Group',
      'feishu',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('feishu:oc_group');
  });

  it('marks registered groups correctly', () => {
    storeChatMetadata(
      'feishu:oc_reg',
      '2024-01-01T00:00:01.000Z',
      'Registered',
      'feishu',
      true,
    );
    storeChatMetadata(
      'feishu:oc_unreg',
      '2024-01-01T00:00:02.000Z',
      'Unregistered',
      'feishu',
      true,
    );

    _setRegisteredGroups({
      'feishu:oc_reg': {
        name: 'Registered',
        folder: 'registered',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });

    const groups = getAvailableGroups();
    const reg = groups.find((g) => g.jid === 'feishu:oc_reg');
    const unreg = groups.find((g) => g.jid === 'feishu:oc_unreg');

    expect(reg?.isRegistered).toBe(true);
    expect(unreg?.isRegistered).toBe(false);
  });

  it('returns groups ordered by most recent activity', () => {
    storeChatMetadata(
      'feishu:oc_old',
      '2024-01-01T00:00:01.000Z',
      'Old',
      'feishu',
      true,
    );
    storeChatMetadata(
      'feishu:oc_new',
      '2024-01-01T00:00:05.000Z',
      'New',
      'feishu',
      true,
    );
    storeChatMetadata(
      'feishu:oc_mid',
      '2024-01-01T00:00:03.000Z',
      'Mid',
      'feishu',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups[0].jid).toBe('feishu:oc_new');
    expect(groups[1].jid).toBe('feishu:oc_mid');
    expect(groups[2].jid).toBe('feishu:oc_old');
  });

  it('excludes non-group chats regardless of JID format', () => {
    // Unknown JID format stored without is_group should not appear
    storeChatMetadata(
      'unknown-format-123',
      '2024-01-01T00:00:01.000Z',
      'Unknown',
    );
    // Explicitly non-group with unusual JID
    storeChatMetadata(
      'custom:abc',
      '2024-01-01T00:00:02.000Z',
      'Custom DM',
      'custom',
      false,
    );
    // A real group for contrast
    storeChatMetadata(
      'feishu:oc_group',
      '2024-01-01T00:00:03.000Z',
      'Group',
      'feishu',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('feishu:oc_group');
  });

  it('returns empty array when no chats exist', () => {
    const groups = getAvailableGroups();
    expect(groups).toHaveLength(0);
  });
});
