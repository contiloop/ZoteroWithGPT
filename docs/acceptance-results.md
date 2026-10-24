# Acceptance evidence

## Baseline: actual Web and Zotero

0.3.1 selected-plugin conversations read owned LayerNorm and ResNet PDFs, then
created native passage-linked highlights/comments. Fresh native readback matched
the submitted body and the Zotero reader displayed the comments. Ambiguous
ResNet candidates required an explicit choice; targets did not cross chats.

Earlier unchanged native runtime checks covered requested append, stale-revision
rejection after manual editing, ordinary component reinstall, and immutable
replay without duplicate creation. Private evidence is retained under
`.local/validation/local-study/` and `.local/validation/local-study-0.3.1/`.
Do not distribute those folders: requests/results contain study content.

## Scope correction

A separate test required byte-identical copying of complete Web conversation
blocks. One 0.3.1 run changed formatting and omitted UI/status text before
submission; it still stored and displayed the submitted comment. This additional
criterion does not determine whether requested notes/highlights work. An older
0.3.0 run did omit empirical study details before submission; that remains a
real content-quality failure, not a storage failure.

The product follows the requested form and scope. It must preserve a requested
proof's meaning and conditions, but need not archive plugin labels, tool status,
or unrelated turns. Verbatim comparison applies when verbatim copying is asked.

## Current cut

`npm run verify` passed on the 0.4.0 cut: 213 tests, type checking, build,
deterministic package checks, 30 XPI members, 15 client files, and 22 portable
plugin files. All 22 conversation scenarios are specifications, not model runs.
A separate unused-symbol check passed, and source comparison confirmed all
40 surviving native adapter methods unchanged. Baseline observations remain
labeled by their original versions.

On 2026-10-23, the private account plugin, installed XPI, and configured client
kit were updated to 0.4.0. The XPI SHA-256 matched the reviewed package
(`e6066e2e9b84b9abb0768756043461d0906cc44b9e0fc1b574be3a476783f614`);
the journal was byte-identical across installation. Account identity, private
root, Mac dependency, and existing default prompt were preserved; five obsolete
import examples were removed. Runtime status advertised 13 active operations.

A fresh explicitly selected ChatGPT Web conversation read pages 1–3 of the
owned LayerNorm v1 fixture without writing annotations. A later request, without
repeating the link, created one yellow highlight with a two-sentence Korean
comment beside page 2 equation (3). The submitted and stored bodies matched.
The first viewer check failed while another page was active; selecting the new
annotation showed the source highlight and complete comment. A fresh read-only
verification then confirmed both storage and viewer. No second create was sent,
and the PDF SHA-256 remained unchanged. Private evidence and conversation URL
are in `.local/validation/core-cut/live/summary.json` and its protocol folder.

## Latency diagnosis, 2026-10-24

Original bridge request/result file birth times from the 0.4.0 Web run show
254 ms for connection status, 285 ms for discovery, 684 ms for PDF reading,
219 ms for anchor resolution, and 1,160 ms for annotation creation. These
intervals include scanner waiting and result publication. Consecutive save
requests arrived 54–56 seconds apart; those gaps do not isolate model time,
transport, and approval interaction.

A fresh read-only probe through the actual Mac Safe Files connector in Codex
measured 7,828 ms for policy status; 3,434/3,239/4,011 ms for the
descriptor/status/descriptor gate; 4,941 ms for request creation; and 6,968 ms
for result reading. The bridge request-to-result interval was 379 ms. This
is a Codex connector sample, not a ChatGPT Web latency benchmark. Its operation
ID is `latency-read-1792768512669` in the existing private bridge session.
No annotations were created by this probe.

Source workflow changes reuse policy within a turn and connection capabilities
within an unchanged session, read result files without a preliminary stat, and
reserve viewer verification for requested visibility checks. Every publication
still validates descriptor/status/descriptor; writes still require current PDF
evidence and complete saved-body comparison. Plugin validation passed (22
scenario specifications, no model execution). The installed 0.4.0 plugin is
unchanged; post-change Web latency has not been measured.

## 0.5.0 package and lifecycle verification, 2026-10-24

`npm run verify` passed with 269 tests, including all nested MCP tests exactly
once, plus root and nested type checks, builds, package validation, and the
unconfigured plugin validator. The release contains 30 XPI files, 15
generic-client files, five portable-plugin files, and 35 locked server files.
Package verification extracted
the server to a relocated path, ran `npm ci --omit=dev --ignore-scripts`, then
used the official MCP SDK stdio client to initialize it and discover the exact
14-tool inventory.

Two independent clean Git-tree exports each ran the root and nested locked
installs and built all four artifacts. Their archive inventories and bytes
matched; the two client directories also matched file for file. The resulting
SHA-256 values were:

```text
ccc74643414a2b19806622cfa4e758e400c5eb1fe3a9134d000dd97747f0e415  zotero-ai-research-companion-0.5.0.xpi
13fbeb6bf75ed1b35d72bb239a2d525a8932c960be59e0aee0850ba20156bef1  zotero-study-save-0.5.0.zip
8f669470027bcbfe608e035a117a4cc1ef3e32bdf90d1ae06914dc7f8f8b66f9  zotero-mcp-server-0.5.0.zip
```

Controlled temporary fixtures verified owned install, start/status/stop/remove,
same-version repair, reinstall with bridge/native history outside the install
root, stopped rollback, exact obsolete-account-file derivation, and diagnostic
redaction. Follow-up cases reject symlink ancestors on every private path,
install/bridge overlap with the pinned tunnel-client control root, and unknown
dependency or managed-profile entries before any remove command. They also
confirm every child tunnel command receives that pinned root and unrelated
shared control-state files survive lifecycle removal. Portable scans found no
account app ID, credential pattern, private user path, session directory,
operation journal, or validation history.

These are package and fixture results. T1 had separately observed creation of a
private tunnel identity and use of its protected credential reference while
preserving the old Mac route. T4 made no live account, tunnel, credential,
Zotero, bridge-history, native-write, or reader-display change. Production
polling and ChatGPT custom MCP discovery remain pending T5 live acceptance.
