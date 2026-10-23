# R12 controlled native fault acceptance

This temporary Zotero add-on exercises two fixed production importer boundaries in the real Zotero host. It is an acceptance aid, not part of the distributed extension. Installation and startup only register two Tools menu commands. The add-on exposes no bridge, request input, URL input, evaluator, network client, SQL, or automatic write.

An independent reviewer must inspect the source and exact XPI before the sole host-test owner installs it. Building or installing the add-on does not establish an acceptance pass. Only the bounded result produced by the reviewed action in Zotero can do that.

## Controlled fixtures

Both sources are syntactically valid protocol identities that deliberately do not represent verified arXiv records:

- Case A: `0001.99999v1`, operation `r12-native-fault-parent-item-only-v1`, title begins `[CONTROLLED R12 FIXTURE - NOT A VERIFIED ARXIV SOURCE]`.
- Case B: `0001.99998v1`, operation `r12-native-fault-disable-during-await-v1`, title begins `[CONTROLLED R12 FIXTURE - NOT A VERIFIED ARXIV SOURCE]`.

The acquisition port returns the owned repository fixture `tests/zotero/fixtures/research-companion.pdf` from embedded memory only. Its expected evidence is:

- SHA-256: `c2fbe4c5d2d2a372492278542b9aa4008dbf8407f8bc54335a3aaf30b990e336`
- Bytes: `900`
- Pages: `1`

The canonical-looking `arxiv.org` fields exist only because the production native adapter requires its exact typed `ArxivSource` shape. The diagnostic never requests those URLs and reports `synthetic_fixture_not_network_verified`.

The fixed operation identities are retained in a separate journal resolved from the active host profile:

```text
<Zotero profile>/zotero-ai-r12-native-fault-acceptance-v1/operations-v1.json
```

Ordinary add-on removal leaves this journal in place. A repeated command returns or reconciles the fixed historical operation and does not run a blind replacement mutation.

## Offline build and review

From the repository root:

```sh
node tests/host/native-fault-acceptance/build.mjs
node --test tests/host/native-fault-acceptance/build.test.mjs
npm run verify
```

The builder writes the ignored artifact to:

```text
.cache/native-fault-acceptance/r12-native-fault-acceptance-v1.xpi
```

It prints the exact XPI SHA-256, bundle SHA-256, byte count, archive member allowlist, and controlled fixture evidence. Rebuild twice and require identical hashes. Review these five archive members before installation:

```text
BUILD_METADATA.json
README.md
bootstrap.js
diagnostic.js
manifest.json
```

The package test also runs the diagnostic TypeScript boundary check, rejects unexpected dependencies and private paths, and scans the bundle for evaluation, network fetch, direct SQL, and child-process surfaces.

## Reviewed host run

Only the assigned host-test owner performs these steps after independent review. Do not run either case against a profile where either synthetic identity already exists without the retained diagnostic journal. The diagnostic refuses a fresh operation when it sees an occupied source identity.

1. Install the exact reviewed XPI through Zotero's normal Add-ons UI. Its distinct add-on ID is `r12-native-fault-acceptance@zoterowithgpt.local`.
2. In Zotero's Tools menu, choose **R12 controlled check A - retained parent** and read the complete confirmation before continuing.
3. Capture the bounded PASS or FAIL report. A fresh PASS requires one real native parent create/readback, one injected fault before attachment creation, a terminal `failed` / `storage_error` / `item_only` result with confirmed storage, one parent marker, no attachment marker or record, no installed PDF, and discarded in-memory staging.
4. Choose **R12 controlled check B - disable during await** and read the complete confirmation before continuing.
5. Capture the bounded PASS or FAIL report. A fresh PASS requires a real timer await in the controlled acquisition, disabling the separate diagnostic gate, a terminal `rejected` / `permission_denied` result, no native checkpoint or marker, no source candidate, and no plan/create/install native call.
6. Preserve only the bounded reports and exact reviewed artifact hash in private acceptance evidence. Do not treat synthetic metadata as source identity proof.
7. Remove the temporary add-on through Zotero's normal Add-ons UI. After the result is captured, remove the clearly titled controlled Case A parent through Zotero's normal item UI. Do not remove it before readback is complete, and do not alter the diagnostic journal to make a second attempt.

Case A follows the production order: controlled PDF acquisition and in-memory staging occur before the parent commit. The injected fault is at the subsequent attachment-create boundary, so the confirmed parent is retained as `item_only`. It does not claim that a network download occurs after the parent.

Case B changes only a separate `MutableZoteroAccessGate` owned by this diagnostic. It validates the production fence across an actual awaited in-memory acquisition. It does not exercise or change the production settings toggle.

These checks do not validate arXiv network acquisition, ordinary ChatGPT Web activation, actual attachment file installation, the production file bridge, or user-paper metadata. Those remain separate acceptance evidence.
