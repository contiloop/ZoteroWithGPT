# Zotero Study Save personal plugin

This portable source lets a selected ChatGPT plugin study a PDF already saved
in Zotero and later save approved discussion beside its source passage. It uses
the existing Mac Safe Files app. It does not contain a server, credential,
developer path, Zotero profile, live session, paper target, or study history.
The Zotero XPI, its matching client kit, and this ChatGPT plugin remain separate
installable components.

## Private one-time setup

1. Install the matching Zotero AI Research Companion XPI and client kit. In
   Zotero, select one dedicated bridge root, enable it, and require **Ready**.
   Before starting a study conversation, manually save the paper and PDF in Zotero.
2. Approve that exact dedicated root in Mac Safe Files using the platform and
   macOS prompts. Do not broaden access to a home directory, Desktop, Zotero
   data directory, or shared research directory.
3. Create a private personal plugin from the matching portable archive and keep
   its declared Mac Safe Files dependency. In the personal plugin instance
   only, edit
   `skills/zotero-study-save/resources/personal-config.json` so `bridgeRoot`
   contains the exact root displayed by Zotero. The portable source keeps this
   value `null`; do not add profile IDs, session IDs, request/result paths,
   operation IDs, credentials, or study material to that resource.
4. Start a new ChatGPT conversation, select Zotero Study Save, provide one
   official arXiv abstract or PDF link, and ask, for example, “이 논문을 Zotero에
   저장된 PDF로 읽고 함께 공부해 줘.” The selection establishes the workflow;
   later turns in that conversation do not need another selection chip or the
   same URL again.

On each use, the skill discovers the current descriptor, status, profile,
session, relative paths, limits, and capabilities internally. The user does not
provide a connection phrase, root, request file, profile, or native key. A
configured root does not authorize a write. The current user's save request or
acceptance of an exact proposal supplies mutation intent, while Mac Safe Files
and macOS prompts remain authoritative for file access.

If the personal resource is unset or Mac Safe Files is unavailable, the skill
gives a short setup action and stops. If the companion does not advertise
`find_local_arxiv`, it gives a concise compatibility message and stops. It does
not repeat this full guide on each failed request.

## Local study and later saves

The selected plugin first performs read-only connection checks, looks up the
official arXiv identity across all eligible Zotero libraries, and reads the
actual local PDF. It briefly confirms the paper title, PDF attachment, and
known or unknown version evidence. A Web abstract or parent item metadata does
not substitute for reading local pages, and the plugin does not claim to have
read pages it did not request.

This workflow never downloads or imports a paper. If Zotero has no matching
item, has only metadata, has multiple plausible parents or PDFs, or cannot read
the attachment, the plugin asks a focused question or asks the user to save,
attach, or restore the PDF manually. It waits and performs a fresh lookup after
the user finishes. It does not move an item, change its collection placement,
or choose the first candidate.

A PDF attachment with no current fingerprint has inaccessible or unverified
local bytes. The plugin stops before `read_pdf`, asks the user to restore the
file or attachment path manually in Zotero, and waits. It performs a fresh
lookup after restoration and does not use another read as an automatic repair.

The established target remains in the accessible conversation. A later request
such as “방금 질문과 설명을 해당 구절 옆에 저장해 줘” does not require the URL,
page, quote, or native key again when they are inferable. Comparing another
paper does not switch the save destination. An explicit switch requires a new
lookup and local read; if that fails, a later save asks which paper should
receive it instead of falling back to the old destination.

Reading and studying are read-only. An annotation or note write requires the
current user's explicit save request or acceptance of an exact proposal. The
plugin preserves the complete requested Korean question, proof, explanation,
equations, and real reference links beside the relevant passage. It does not
truncate, summarize, split, or divert long content to an overflow note.

## Update or reinstall

Update the Zotero XPI, matching client kit, and portable ChatGPT plugin together
at the same release version. Account plugin releases are versioned: update the
existing personal plugin with a strictly greater semantic version so its owned
identity and Mac Safe Files binding remain stable. Keep the personalized
`personal-config.json` when the update flow supports partial file overlays;
otherwise restore only its `bridgeRoot` value after the update. A reinstall
follows the same one-value restore. No secret is involved.

Do not copy a descriptor, profile ID, session ID, operation ID, pending request,
result path, or historical result into the plugin package. Zotero publishes a
fresh session after enable or reconnect, and the workflow performs a new
descriptor/status/descriptor and `connection_status` check.

An archive downloaded back from the authenticated account may include a
platform-generated `.codex-plugin/plugin.json` and account-owned author
metadata. That configured archive also contains the personal `bridgeRoot`.
Treat it as private account state; use the versioned portable release archive,
whose `bridgeRoot` is null, for distribution or clean setup.

## Remove

Remove the personal **Zotero Study Save** plugin through ChatGPT's plugin
management. This does not remove Mac Safe Files, the Zotero XPI, its dedicated
bridge directory, or its operation journal, and it does not delete native Zotero records.
Use the separate Zotero uninstall guide when removing the XPI. Ordinary removal
preserves papers, PDFs, annotations, notes, and operation history.

## Final package layout

The portable archive contains one plugin at its root:

```text
plugin.json
.app.json
README.md
skills/zotero-study-save/SKILL.md
skills/zotero-study-save/agents/openai.yaml
skills/zotero-study-save/resources/personal-config.json
skills/zotero-study-save/resources/workflow.md
skills/zotero-study-save/resources/client-v1/README.md
skills/zotero-study-save/resources/client-v1/docs/install.md
skills/zotero-study-save/resources/client-v1/docs/uninstall.md
skills/zotero-study-save/resources/client-v1/docs/troubleshooting.md
skills/zotero-study-save/resources/client-v1/protocol/v1.md
skills/zotero-study-save/resources/client-v1/protocol/v1-request.schema.json
skills/zotero-study-save/resources/client-v1/protocol/v1-response.schema.json
skills/zotero-study-save/resources/client-v1/protocol/examples/*.json
```

The final-package integration renders
`scripts/package/assets/client/README.md` with the matching package version and
copy it to the resource `client-v1/README.md`. It must copy `docs/install.md`,
`docs/uninstall.md`, `docs/troubleshooting.md`, and `docs/protocol/v1.md` to the
listed client resource paths. It must also copy both authoritative schemas and
every shipped example from `scripts/package/assets/protocol/`; it must not
rewrite, summarize, or fork that protocol material. The archive excludes
`AGENTS.md`, local tests, repository scripts, build output, and personalized
configuration. The resource path
`client-v1/protocol/v1-request.schema.json` is therefore stable for the skill.
The root package, XPI, client kit, and ChatGPT plugin manifest must carry the
same semantic version, and final packaging verifies that equality.

Run the local source gate before staging the final archive:

```sh
node integration/chatgpt-plugin/tests/validate-package.mjs
```

That gate validates package structure and documented scenario decisions. It is
not evidence that ChatGPT honored the selected workflow, that Mac Safe Files
exposed its tools, or that a local PDF was read. Those claims require an actual
private-account conversation. Only an actual Zotero reader run can establish
native storage and viewer behavior.
