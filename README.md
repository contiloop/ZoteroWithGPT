# Zotero AI Research Companion

An in-progress connection for recording ChatGPT Web study sessions as native Zotero PDF annotations. Long explanations, proofs, questions, and references belong beside their source passage in the paper reader.

## Development

Requires Node.js 24–26 and npm. Recreate dependencies with `npm ci`, then run `npm run verify`.

The verification command currently covers strict TypeScript checking, the Node.js test suite, and compilation. Plugin packaging and real ChatGPT Web/Work/Zotero acceptance checks are required before a release; passing the core command alone does not establish an installable or working end-to-end product.

No OpenAI API key is required. Do not put personal credentials, Zotero libraries, transport secrets, or private study content in this repository.
