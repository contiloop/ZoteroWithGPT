# Decisions

| Record | Decision | Consequence |
| --- | --- | --- |
| 0001-native-file-bridge | Native annotations behind a local request/result bridge | Existing file-only MCP and direct local clients share one bounded interface |
| 0002-reader-rendering | Native editable Markdown/LaTeX plus sanitized rendering using permissive dependencies | Removal retains readable source and avoids copying AGPL plugin code |
| 0003-conversational-arxiv-save | Private ChatGPT workflow plus bounded Zotero-host arXiv import over the existing file bridge | Natural save intent includes necessary exact-version import; account activation and native persistence require separate actual acceptance |
