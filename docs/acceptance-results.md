# Study-session acceptance

Observed on 2026-10-21 with Zotero 10.0.6 on macOS arm64 and the packaged Research Companion 0.1.0. This record separates actual ChatGPT Web actions, direct Codex local actions, native UI observations, and automated checks. Final acceptance remains in progress while the formatted-preview verification defect is investigated.

## Real paper and test ownership

The real paper was *Scaling up Test-Time Compute with Latent Reasoning: A Recurrent Depth Approach* (Geiping et al., 2025). Original item `LT2PF6MC`, attachment `9B6NE4M4`, library `1`, was read only. Its initial and subsequent annotation listings were empty.

To honor the agreed test boundary, a byte-identical PDF was imported through Zotero's normal importer as **Research Companion Acceptance Copy — Huginn: Scaling up Test-Time Compute with Latent Reasoning**, item `L4QBNWND`, attachment `PD27UJ6H`. Ownership note `JT29BG47` identifies this separate test copy. Study writes target only the copy. Both PDFs retain SHA-256 `96f4543683a06a470ccb0b6b0db27a98f283fde9467d175e838f03a629a76c7b`.

## ChatGPT Web study and approval

The actual [test conversation](https://example.invalid/private-chat/2) used the installed Mac Safe Files connection. It read the matching client instructions and published create-only requests after checking descriptor, status, and descriptor again. The production connection reported plugin `0.1.0`, host `10.0.6`, profile `060902e7-34a5-4f7e-b983-2376ecd861db`, and session `639bce80c4f3e258f081804c2af45eae`. No permission prompt appeared during these observed calls; no account policy was changed.

| Operation ID | Actual result |
| --- | --- |
| `web-release-status-1` | Connected production extension, correct profile/version |
| `web-huginn-search-1` | Found the original Huginn paper and PDF |
| `web-huginn-read-1` | Read page indexes 0–2, returning real paper text and location candidates |
| `web-huginn-annotations-1` | Read the original PDF's existing annotations: none |
| `web-copy-read-1` | Read the copy's page index 2 before writing |
| `web-copy-anchor-1` | Resolved the exact selected sentence to two page-local rectangles |
| `web-copy-save-1` | Saved native highlight `WCBZZI8H`, storage confirmed |

Before approval, all four Web requests were read operations. No annotation, annotation update, or item-note request existed. ChatGPT proposed a Korean question and long explanation in conversation; it did not save the proposal. A subsequent explicit approval authorized the one passage-linked comment on the test copy.

The selected sentence on displayed page 3, Section 3.1, is: “This recurrent design is the minimal setup required to learn stable iterative operators.” The saved comment includes the user's question, a distinction between the paper's empirical claim and mathematical convergence, a five-step sufficient-condition explanation using a contraction mapping and fixed point, remaining questions, and paper/model/code reference links. The extra mathematical assumptions are labeled as an explanatory sufficient condition, not a proof about the trained Huginn model. No separate item note was created for the long explanation.

The actual Zotero sidebar showed the comment's Korean paragraphs, numbered steps, inline/display mathematics, and reference text beside the highlighted sentence. Clicking the annotation navigated to page 3 and exposed the correct two-line highlight. The original editable Markdown/LaTeX remained available through **Edit native comment**.

Initial automated viewer checks returned `failed` while storage remained `confirmed`. This included one check with the copy tab active and its formatted content visibly displayed. In native source-edit mode, `local-huginn-source-visible-1` returned both storage and viewer `confirmed`. The discrepancy in formatted-preview verification is under investigation; a screenshot observation is not represented as a successful protocol viewer response.

## Concurrent manual edit

The actual Zotero native comment editor was used to append a Korean manual-edit marker while preserving the whole existing comment. A fresh native listing returned revision `sha256:0dbd9d88a2b1136d45db0c0647a49479435ff70266ca818305f624e10f12dcf7` and exactly one marker.

ChatGPT then submitted `web-copy-stale-update-1` using the earlier saved revision `sha256:12f4cce46678dd2ffb46d23976f1a65194d50c310ce2fa8199d80dac770f416c`. The extension rejected it with `conflict`, `retryable: false`. `web-copy-conflict-read-1` confirmed the manual marker and original explanation remained, and the attempted new question was absent. ChatGPT reported the conflict without automatically retrying with the new revision.

A separately renewed explicit approval authorized `web-copy-approved-append-1` against the freshly read revision. It succeeded, preserving the manual marker and adding the requested question. `web-copy-after-append-1` independently read both back; `web-copy-after-append-verify-1` confirmed storage and the visible native comment editor separately. The actual Web conversation displayed these three successful results. The resulting revision was `sha256:be64c7335d2df801da91545bc7cd5f5b4962c236bef8575733f96c2efb604392`. No new annotation or separate note was created.

## Other acceptance evidence

- A direct Codex local-file client read the real copy and submitted an intentionally nonexistent quoted passage as `local-huginn-unresolved-1`. The resolver returned `unresolved`, no candidates, and no annotation write. A later native listing contained only the intended Web-created highlight.
- Fresh native listings confirmed the original paper still had no annotations and the copy had exactly one highlight plus its ownership item note. SHA-256 assertions passed for the original, copy, and earlier synthetic fixture PDF. The fixture hash remained `c2fbe4c5d2d2a372492278542b9aa4008dbf8407f8bc54335a3aaf30b990e336`.
- Actual production-package removal/reinstall retained the earlier fixture comment, rejected old pending-session execution, and replayed an original successful request without duplicating its annotation. That test used the packaged artifact with SHA-256 `14be160836366dcc9e28defbbe86b1c1d490b6269699c80b457fcd30c169d16c`.
- A real native commit-boundary fault injection during development interrupted result finalization after a native note committed. Recovery reconciled the existing native key without duplication. This was fault injection against real Zotero storage, not a forced application crash.
- A fresh source extraction with `npm ci` and `npm run verify` exited 0 with 135 tests and produced the exact installed package hash. No developer profile or credential was needed to build.

## Direct local execution without Mac MCP

The approved no-MCP alternative was exercised by Codex using local file operations only. `codex-copy-before-1` read the current native annotation. `codex-copy-append-1` appended a Korean measurement idea comparing distances between sampled initial-state trajectories and answer accuracy; `codex-copy-after-1` independently read back all 1,850 characters, including the earlier Web question and manual marker. The copy still had exactly one annotation. Revision: `sha256:2f7b3c146307b1af37864aa93629ade7994341b4dd62af57b801a97b3cda4662`.

The real reader refreshed the formatted content, including the new paragraph. After opening **Edit native comment**, `codex-copy-verify-1` confirmed both storage and the visible native editor. Activating the other owned PDF tab caused `codex-copy-background-verify-1` to report storage `confirmed`, viewer `failed`, demonstrating that a background reader is not accepted as visible evidence.

Independent ChatGPT Work availability and billing remain unverified. No public release, shared MCP reconfiguration, or user-library cleanup was performed.
