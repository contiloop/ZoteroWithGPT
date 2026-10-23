# Mac Safe Files client

Use the packaged `client-v1` kit described in
[installation](../../docs/install.md). The selected plugin's
[workflow](../chatgpt-plugin/skills/zotero-study-save/resources/workflow.md)
is the conversation entry; the [protocol](../../docs/protocol/v1.md) owns wire
shapes. Do not copy a second workflow into this guide.

Mac Safe Files supplies `policy_status`, `fs_read_text`, `fs_write_text`, and
`fs_stat`. Publish complete requests in create mode; no shell, remote command,
or direct Zotero database access is needed. Configure only the dedicated root,
not the Zotero data directory. Mac Safe Files installation and authorization
belong to that independent product.
