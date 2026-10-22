# Zotero Study Save personal plugin

This portable source adds the Zotero study-save workflow to ordinary ChatGPT
conversations and connects it to the existing Mac Safe Files app. It does not
contain a server, credential, developer path, Zotero profile, live session, or
study history. The Zotero XPI, its matching client kit, and this ChatGPT plugin
remain separate installable components.

## Private one-time setup

1. Install the matching Zotero AI Research Companion XPI and client kit. In
   Zotero, select one dedicated bridge root, enable it, and require **Ready**.
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
4. Start a new conversation and use a normal save request such as “Save the
   proof you just explained and my question to Zotero.” A plugin `@` mention is
   optional for diagnosis and is not part of the normal workflow.

On each use, the skill discovers the current descriptor, status, profile,
session, relative paths, limits, and capabilities again. A configured root does
not authorize a write by itself. The current user's save request or acceptance
of an exact proposal supplies the mutation intent, while Mac Safe Files and
macOS prompts remain authoritative for file access.

If the personal resource is unset or Mac Safe Files is unavailable, the skill
gives a short setup action and stops. It does not repeat this full guide on each
failed request.

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
preserves imported papers, PDFs, annotations, notes, and duplicate-prevention
history.

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

That gate validates package structure and documented scenario decisions. Only
an actual private-account installation in a fresh ChatGPT conversation can
establish implicit activation and app-tool availability. Only an actual Zotero
reader run can establish native storage and viewer behavior.
