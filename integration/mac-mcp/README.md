# Mac Safe Files client

This is the generic local-file fallback, separate from the selected plugin's
dedicated MCP route. Use the packaged `client-v1` kit described in
[installation](../../docs/install.md) only when deliberately configuring such a
client. The [protocol](../../docs/protocol/v1.md) owns wire shapes. Do not bundle
this client or its source-only fallback workflow into Zotero Study Save.

Mac Safe Files supplies `policy_status`, `fs_read_text`, `fs_write_text`, and
`fs_stat`. Publish complete requests in create mode; no shell, remote command,
or direct Zotero database access is needed. Configure only the dedicated root,
not the Zotero data directory. Mac Safe Files installation and authorization
belong to that independent product.
