# Zotero AI Research Companion

An in-progress connection for recording ChatGPT Web study sessions as native Zotero PDF annotations. Long explanations, proofs, questions, and references belong beside their source passage in the paper reader.

## Development

Requires Node.js 24–26 and npm. Recreate dependencies with `npm ci`, then run `npm run verify`.

The verification command covers strict TypeScript checking, the Node.js test suite, compilation, deterministic XPI packaging, and package validation. Real ChatGPT Web and Zotero reader acceptance remain separate checks; passing this command alone does not establish a working end-to-end connection. ChatGPT Work access has not been independently verified; direct Codex local files are the validated alternative route for this cycle.

Build the installable XPI and matching client instructions with `npm run package`. See [installation](docs/install.md), [removal and recovery](docs/uninstall.md), and [connection validation](docs/connection-validation.md).

No OpenAI API key is required. Do not put personal credentials, Zotero libraries, transport secrets, or private study content in this repository.
