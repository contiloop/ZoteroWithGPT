# Product status

## Current source release: 0.3.0 — package and actual selected-workflow acceptance verified

The matching XPI, 20-file plain-text client kit, and 27-file portable ChatGPT personal plugin are built. Production now advertises 15 protocol operations and 5 mutations. `find_local_arxiv` performs bounded offline discovery across eligible Zotero libraries; the selected workflow requires a current attachment fingerprint before a fresh local `read_pdf` can establish the target. A missing fingerprint stops before that read and requires manual restoration plus fresh discovery. The retained `inspect_arxiv` and `ensure_arxiv_pdf` operations remain compatible for older clients and immutable history but are outside this workflow.

On Node.js 24.3.0 and npm 11.4.2, `npm run verify` exited 0 with strict type checking, 294 tests, compilation, deterministic package tests, artifact generation, and final package validation. Node 24.3.0 satisfies the declared `>=24 <27` range, and npm matches the declared `npm@11.4.2` package manager. The generated XPI contains 35 files, the client kit 20, and the portable plugin 27. SHA-256 is `634eff4538c2c438f425b1a8a9bed9e85bcd2d4eb18bd11ffe2e8ee84cae4410` for `zotero-ai-research-companion-0.3.0.xpi` and `d569208c3ce1cb3976e10780bbf7a33615058ca7d5ea9826287eb6a0c41e956f` for `zotero-study-save-0.3.0.zip`. The sorted 20-file client hash manifest has SHA-256 `546c6f879d101c453544c599d64f27d17df264b5617026e965c1fd89f4478b1b`. A separate committed-source extraction began without `node_modules`, completed lockfile-only `npm ci`, passed the same full verification, and reproduced both archives plus every client file byte for byte.

The profile-installed 0.3.0 XPI matches the release artifact hash above. The owned private ChatGPT plugin was updated in place to the matching 0.3.0 release while retaining its USER/PRIVATE backend, connected Mac Safe Files dependency, and private bridge root. Two fresh actual ChatGPT Web conversations visibly selected the plugin. The first performed read-only offline discovery and local PDF study before saving one complete contextual Layer Normalization annotation; fresh native readback and the actual reader confirmed its passage, body, and deep link. The second surfaced the owned ResNet v1/v2 ambiguity, wrote only to the explicitly chosen v1 PDF, and showed that no first-conversation target leaked. Missing and metadata-only targets stopped without acquisition or mutation; after an owned manual PDF addition, fresh Web discovery and local PDF reading continued.

Direct-local checks against the installed adapter separately proved exact append preservation and stale manual-edit conflict protection. Ordinary private-plugin Uninstall/Install and Zotero remove/restart/install/restart retained the operation journal and all tested annotations. Fresh session `c846fc1e865a2513d1f1e832e2a1af85` reported enabled 0.3.0, Zotero 10.0.6, and all 15 operations. The 215-record store was byte-identical before new checks. Exact replay of historical create `s2-save-261023-e1` returned the byte-identical recorded result without adding an operation or native annotation.

Actual acceptance is complete for the explicitly selected local-study workflow. Automatic invocation remains an optional convenience rather than a completion gate. Direct-local evidence is labeled separately from Web evidence, and public distribution, a public Mac connection installer, and ChatGPT Work parity remain outside the accepted surface.

## Historical 0.2.2 evidence

At source `c46bc78`, `npm run verify` passed strict type checking, 272 tests, compilation, deterministic packaging, and package validation. Integrated source `20cc1d7` later passed the same command with 273 tests, including the independently reviewed temporary host diagnostic; production archive hashes were unchanged. A clean detached checkout of `c46bc78` with `npm ci` reproduced both archives and all 18 client files exactly. The installed Zotero 0.2.2 XPI matches SHA-256 `c1be45b8acac70e918db80c8612e91a9121673b1415e5fc3e91e27da4a129d5d`; the portable plugin ZIP is `eecff4f37bb97367261146754ab7e1360a4ea77c83002ffc9122e4312bae58c3`.

Actual production Zotero obtained concrete-version arXiv metadata and imported Layer Normalization 1607.06450v1 into personal My Library root. Its locally parsed 14-page PDF has SHA-256 `c464f839fb8d59f7fde92f9b4caa67c2d1f2f196b88f93fb60502249df0aaef7`. A separate direct local-client inspect/ensure reused the same parent and PDF; subsequent reads preserved the sole annotation and manual content.

The owned reader displayed the full Korean proof, mathematical notation, questions, and references beside page 4 Equation (6). On 0.2.2, a precommit terminal-newline test was rejected without changing the record. A newly approved append then stored the complete 7,388-character result exactly in the existing annotation; a fresh read confirmed one record and no overflow note. Direct native UI editing later changed interior whitespace; the extension rejected a stale revision and preserved that entire manually edited body exactly. Historical uncertain operations remain unchanged rather than being retried.

A fresh ordinary 0.2.2 Web conversation after native removal/reinstall still reported no available Zotero integration and dispatched no bridge request. Explicit plugin selection in a separate read-only Web diagnosis did invoke Mac Safe Files and return current Zotero connection status. Normal native restart/removal/reinstall and exact historical import replay were separately observed: the same parent, PDF, and sole manually edited annotation remained without duplication. This implicit-selection failure remains historical evidence and is not the 0.3.0 completion criterion.

A separately reviewed temporary diagnostic exercised two controlled faults in actual Zotero. An injected pre-attachment failure retained one confirmed native parent as `failed/item_only`, with no attachment. Closing a separate diagnostic access gate across an awaited in-memory acquisition returned `rejected/permission_denied` without a native item. Both used fixed owned synthetic identities and the repository PDF fixture; neither establishes real network failure or the production settings-toggle path. Their separate durable journal preserves the exact operation identities. The diagnostic add-on was normally removed, its commands disappeared, and only the owned retained parent was moved to Trash. Fresh status still confirmed the unchanged production 0.2.2 installation.

The private ChatGPT plugin also passed normal Uninstall/Install through its account UI, separately from Delete plugin. The same owned backend, current 0.2.2 release, private root configuration, enabled state, and connected Mac dependency were restored without deleting the plugin or creating a new release. A subsequent bounded fresh ordinary Web conversation studied the absent exact Batch Normalization `1502.03167v1` and submitted one natural Korean save request. The response prepared the full comment but reported storage incomplete; no plugin tool, bridge request, import, or annotation followed. No further unchanged routing attempts are planned.

## Approved 0.1.0 baseline

Research Companion 0.1.0 searches and reads local papers, resolves actual PDF passages, creates native highlights or anchored note annotations, updates identified comments with revision checks, and supports explicitly requested item notes. The default study destination remains the PDF reader, including long Korean explanations and mathematical proofs.

Actual ChatGPT Web with the existing Mac Safe Files connection read Huginn, saved an approved study comment on an owned copy, rejected a stale edit after a native manual change, appended separately approved questions, and freshly read back all content. Strict formatted-reader verification passed after a normal Zotero restart. Direct Codex local files completed an independent native append and reader check without MCP.

Automated verification at source 97d75df passed 160 tests, strict type checking, build, and package validation. A fresh source extraction at 5675e2b with npm ci passed all 160 tests and reproduced the final installed XPI SHA-256 exactly. Actual optional-note creation preserved a reference, equation, and table; append preserved its existing body, and aggregate-size rejection left both notes and annotations unchanged.

Normal packaged disable/remove/reinstall retained study records, stopped new dispatch, did not execute old pending-session writes, and replayed a historical operation without duplication. Commit-boundary fault injection reconciled a real committed native note; this was not a forced application crash.

## Baseline reader lifecycle validation

A reproduced dead unrelated reader no longer aborts healthy reader synchronization. Independent tests confirmed removed and retained dead-reader isolation plus best-effort cleanup without weakening strict viewer checks. The installed final package passed native storage and formatted viewer confirmation immediately after update. Actual Web read-only requests independently confirmed the complete 1,906-character comment and strict formatted preview on that same final artifact.

## Future scope beyond this extension

1. Independently verify ChatGPT Work local-file access before claiming that route or its account availability. Codex is the approved verified no-MCP alternative.
2. Establish an owner-supported public Mac Safe Files installation procedure or another approved transport before promising easy setup to users without that connection.
3. Decide the project's distribution license and public release channel; no public publication has occurred.
4. Extend approved cross-paper study workflows and optional whole-paper analysis with adjustable density. These are future capabilities, not background save authority.
5. Evaluate additional transports and desktop platforms with their own actual access and native-reader validation.

No fixed annotation count or separate study notebook is a product goal.
