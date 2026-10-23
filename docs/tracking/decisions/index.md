# Decisions

| Record | Decision | Consequence |
| --- | --- | --- |
| 0001-native-file-bridge | Native annotations behind a local request/result bridge | Existing file-only MCP and direct local clients share one bounded interface |
| 0002-reader-rendering | Native editable Markdown/LaTeX plus sanitized rendering using permissive dependencies | Removal retains readable source and avoids copying AGPL plugin code |
| 0003-conversational-arxiv-save | Historical private ChatGPT workflow plus bounded Zotero-host arXiv import over the existing file bridge | Protocol compatibility and historical outcomes remain; this is no longer the active study flow |
| 0004-selected-local-arxiv-study | Explicitly selected ChatGPT workflow studies a manually saved local PDF through offline discovery | Study is read-only; later save intent authorizes only the requested records, and automatic activation is not a completion gate |
