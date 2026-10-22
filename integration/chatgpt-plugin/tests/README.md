# Local plugin validation

Run from the repository root:

```sh
npm run build
node --test integration/chatgpt-plugin/tests/protocol-examples.test.mjs
node integration/chatgpt-plugin/tests/validate-package.mjs
```

The validator parses the portable manifest, app binding, personal configuration,
skill frontmatter, and agent metadata. It also checks the expected decisions in
`scenarios.json` and scans package-source text for private paths and common
credential forms.

The scenario file records expected outputs for direct and indirect saves,
abstract-path `.pdf` normalization, study-only questions, missing setup or
tools, unsupported new-import URLs, missing conversation material, a clear
import-and-save request, version ambiguity, verified duplicate reuse,
unknown-outcome recovery, manual-edit conflicts, long proofs, reference URLs,
and viewer failure. These checks prove that the package source states those
expectations consistently. They do not prove that ChatGPT loads or implicitly
invokes the skill, that Mac Safe Files exposes its tools, or that Zotero
performs and displays a native write. Those behaviors require the separate
account and Zotero acceptance run.
