# Intent: src/routing.test.ts modifications

## What changed
Added Slack JID pattern tests and Slack-specific getAvailableGroups tests.

## Key sections
- **JID ownership patterns**: Added Slack channel JID (`slack:C...`) and Slack DM JID (`slack:D...`) pattern tests
- **getAvailableGroups**: Added tests for Slack channel inclusion, Slack DM handling, registered Slack channels, and mixed Feishu + Slack ordering

## Invariants
- All existing Feishu JID pattern tests remain unchanged
- All existing getAvailableGroups tests remain unchanged
- New tests follow the same patterns as existing tests

## Must-keep
- All existing Feishu tests (group JID, DM JID patterns)
- All existing getAvailableGroups tests (DM exclusion, sentinel exclusion, registration, ordering, non-group exclusion, empty array)
