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

The scenario file records expected decisions for selected-plugin read-only
startup, unique local PDF reads, missing items and metadata-only parents,
conversation target continuity, ambiguous matches, explicit-version conflicts,
unknown versions, failed switches, comparison references, context loss, full
canonical Korean proof bodies, collection preservation without import,
unresolved anchors, oversize bodies, conflict recovery, unknown outcomes, and
viewer failure. The runtime example test also validates the strict
`find_local_arxiv` request shape.

These checks prove only that package source states those decisions consistently
and that the runtime request validator accepts or rejects the exercised shapes.
They do not prove that ChatGPT loads the selected skill, that Mac Safe Files
exposes its tools, that a local PDF is read, or that Zotero performs and displays
a native write. Those behaviors require separate account and Zotero acceptance.
