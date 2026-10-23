# Zotero AI Research Companion

Study a paper in ChatGPT Web, then save the requested explanation, question,
proof, reference, or highlight into the relevant passage in your local Zotero
PDF reader. Long comments stay beside the passage.

Save the paper and PDF in Zotero first. Select **Zotero Study Save**, provide
its arXiv link, and study it. Later say “save this explanation beside that
equation” without repeating the link. Studying alone does not save anything.

[Install](docs/install.md) · [Remove/reinstall](docs/uninstall.md) ·
[Troubleshoot](docs/troubleshooting.md) · [Verified status](docs/tracking/status.md)

The Zotero extension uses an existing Mac Safe Files connection. No model API
key or hosted service is required. Public Mac connection installation and
ChatGPT Work access are not supplied.

## Development

Node.js 24–26, npm 11.4.2: `npm ci`, then `npm run verify`.
`npm run package` creates matching XPI, local client kit, and portable ChatGPT
plugin artifacts. Configured account archives and operation journals are private.

[Architecture](docs/architecture.md) · [Study rules](docs/business-rules.md) ·
[Protocol](docs/protocol/v1.md) · [Host pitfalls](docs/engineering-notes.md)
