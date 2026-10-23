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
40 surviving native adapter methods unchanged. No new live conversation,
native save, account release, or installed-extension update is implied by those
checks. Baseline observations remain labeled by their original versions.
