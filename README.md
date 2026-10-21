# Zotero AI Research Companion

A local connection for recording ChatGPT Web study sessions as native Zotero PDF annotations. Long explanations, proofs, questions, and references belong beside their source passage in the paper reader.

## Development

Requires Node.js 24–26 and npm. Recreate dependencies with `npm ci`, then run `npm run verify`.

The verification command covers strict TypeScript checking, the Node.js test suite, compilation, deterministic XPI packaging, and package validation. Real ChatGPT Web and Zotero reader acceptance remain separate checks; passing this command alone does not establish a working end-to-end connection. ChatGPT Work access has not been independently verified; direct Codex local files are the validated alternative route for this cycle.

Build the installable XPI and matching client instructions with `npm run package`. See [installation](docs/install.md), [removal and recovery](docs/uninstall.md), and [connection validation](docs/connection-validation.md).

No OpenAI API key is required. Do not put personal credentials, Zotero libraries, transport secrets, or private study content in this repository.

## Verified local use

Actual ChatGPT Web with the existing Mac Safe Files connection searched/read Huginn, saved a Korean question with a multi-step mathematical explanation and references, protected a manual edit from a stale update, and appended approved follow-up questions to the same native annotation. Direct Codex local files also completed an independent save. The actual Zotero reader showed formatted mathematics beside the selected passage.

The macOS Zotero 10.0.6 validation includes install/remove/reinstall retention, historical retry protection, 160 automated tests, and clean deterministic packaging. A public Mac Safe Files installer and independent ChatGPT Work execution are not supplied or claimed. Distribution is currently a local manual XPI; no public release has been published.
