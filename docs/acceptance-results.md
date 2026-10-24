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

## 0.5.0 package verification, 2026-10-24

At source revision `c790056`, `npm run verify` passed 271 tests, including all
nested MCP tests exactly once, plus root and nested type checks, builds, package
validation, and the unconfigured plugin validator. The release contains 30 XPI
files, 15 generic-client files, five portable-plugin files, and 35 locked server
files. Verification extracted the server to a relocated path, ran
`npm ci --omit=dev --ignore-scripts`, then used the official MCP SDK stdio
client to initialize it and discover the exact 14-tool inventory.

Two independent clean Git-tree exports each ran the root and nested locked
installs and built all four artifacts. Their archive inventories and bytes
matched; the two client directories also matched file for file. The reviewed
artifact SHA-256 values were:

```text
6fc8fa6f16bfdd48f1621e0277525bd55f62e2f9058738bb7898deec1c82cd9f  zotero-ai-research-companion-0.5.0.xpi
13fbeb6bf75ed1b35d72bb239a2d525a8932c960be59e0aee0850ba20156bef1  zotero-study-save-0.5.0.zip
eb472970d8b020ffa1abff4a77e1562d411ff26de8d4d62d495161ab2c8982c4  zotero-mcp-server-0.5.0.zip
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

The private tunnel preflight created a separate Zotero tunnel in the same
account and workspace, then confirmed that the existing protected `file:`
credential could use it. It did not replace the shared Mac catalog, rotate or
copy the credential, or start a competing client under the old tunnel identity.

## Live acceptance, 2026-10-24

Three selected-plugin study/save pairs ran through the installed 0.4 Mac route
before any account update. Afterward, the verified 0.5 server was installed in
its private runtime root, the verified extension was installed in Zotero, and a
separately named ChatGPT custom MCP connection exposed the packaged 14 tools.
The temporary 0.5 account plugin release depended only on that dedicated
connection. Three further selected-plugin study/save pairs used its visible
`zotero_` tool cards and the dedicated runtime.

Each study turn read the owned local PDF and made no Zotero write. Each save
turn created exactly one requested passage-linked native annotation. Native
readback matched the prepared body, and the active Zotero reader showed the
highlight, passage, and body boundaries. The six saved bodies ranged from
2,480 to 8,729 characters. Content maps checked the requested question,
explanation, proof or derivation, comparison, and supported references rather
than relying on a storage hash alone. In the bounded third dedicated trial, the
stored question block exactly matched the 460-character submitted question;
an apparent early ending in Zotero accessibility output was display truncation.
The LayerNorm, ResNet, and owned synthetic-fixture PDF hashes did not change.

The paired timings were mixed:

| Route and phase | Runs | UI “Worked for” median (range) | Observed wall upper bound median (range) | Write approval |
| --- | ---: | ---: | ---: | --- |
| Existing Mac 0.4 study | 3 | 122 s (84–160) | 177 s (155–271) | none |
| Dedicated 0.5 study | 3 | 94 s (85–106) | 179 s (103–252) | none |
| Existing Mac 0.4 save | 3 | 196 s (131–442) | 225 s (157–490) | none |
| Dedicated 0.5 save | 3 | 226 s (218–280) | 253 s (241–327) | one “Allow once” per run |

The wall endpoint is the next periodic final observation, so it includes
polling uncertainty. Body size, model work, and approval behavior also differed.
With three runs per route, these observations do not establish a speedup.

Fresh Web conversations also refused a save without a retained target, exposed
three ambiguous ResNet candidates for explicit choice, and suspended the old
implicit target after both an invalid arXiv identifier and a valid-but-missing
paper. No fallback write followed those failures. The dedicated runtime then
passed an ordinary stop/remove/reinstall/start cycle with
`processRunning=true`, `healthy=true`, and `ready=true`. Its configuration was
unchanged. The extension passed a normal disable/remove/restart/install/restart
cycle, and the account plugin passed **Uninstall** and reinstall while retaining
the same backend identity. The original successful operation remained
readable through its original connection after all three reinstall cycles.
All 329 pre-lifecycle journal records retained their canonical digests; two
later records were read-only connection-status observations.

One owned synthetic-fixture create remains unresolved. ChatGPT displayed a
model-authored summary that the call had been blocked, but the raw tool
arguments and raw error were not available, the tunnel runtime log contained no
payload evidence, and the inspected active bridge session retained no request
under that operation ID. A bounded annotation listing did not show the proposed
new annotation. Those observations do not prove that the service never received
or executed the call. The operation was not reissued under the same or a new
ID, and an older annotation was not used as a substitute. Consequently
original-ID result recovery remains unresolved, and the fixture-dependent
append, manual-edit conflict, deletion, and historical replay tests were not
live-accepted in this run.

Because the latency comparison was inconclusive, the selected account plugin
was restored to the prior shared Mac route as version 0.5.1 using the preserved
old content. Its identity, private audience, presentation, and default prompts
were retained. A fresh selected-plugin chat then completed Mac Safe Files
policy status, file stat, and file read calls with no write. The dedicated
Zotero connection, tunnel, and healthy 0.5 runtime remain available separately;
the shared Mac app itself was not modified.

Private live evidence is retained in the local validation tree and must not be
distributed. It includes study text, request/result records, account
observations, and native library identifiers.
