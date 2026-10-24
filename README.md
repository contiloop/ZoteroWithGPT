# Zotero AI Research Companion

Study a paper in ChatGPT Web, then save the requested explanation, question,
proof, reference, or highlight into the relevant passage in your local Zotero
PDF reader. Long comments stay beside the passage.

Save the paper and PDF in Zotero first. Select **Zotero Study Save**, provide
its arXiv link, and study it. Later say “save this explanation beside that
equation” without repeating the link. Studying alone does not save anything.

[Install](docs/install.md) · [Remove/reinstall](docs/uninstall.md) ·
[Troubleshoot](docs/troubleshooting.md) · [Verified status](docs/tracking/status.md)

The selected Web route uses a dedicated stdio MCP server through a separately
owned private Secure MCP tunnel. The server wraps the same local bridge and
native Zotero executor; it does not add another writer or model API. Public
hosting, authenticated user/profile routing, and ChatGPT Work access remain
future distribution work.

## Development

Node.js 24–26 and npm 11.4.2 are required. A clean checkout needs both locked
installs: `npm ci` and `npm ci --prefix integration/zotero-mcp --ignore-scripts`.
Then run `npm run verify`.

`npm run package` creates four matching 0.5.0 artifacts: the XPI, a generic
local-file client kit, an explicitly unconfigured ChatGPT plugin ZIP, and a
relocatable locked MCP server ZIP. Private account binding is a separate 0600
archive. Configured archives, bridge history, and operation journals are never
portable release content.

[Architecture](docs/architecture.md) · [Study rules](docs/business-rules.md) ·
[Protocol](docs/protocol/v1.md) · [Host pitfalls](docs/engineering-notes.md)
