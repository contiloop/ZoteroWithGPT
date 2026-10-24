# Zotero Study Save

Study a manually saved Zotero PDF in ChatGPT Web, then ask to save a particular
question, explanation, proof, reference, or highlight beside its passage.

## Portable source

This source and its release ZIP are deliberately **UNCONFIGURED**. They contain
five allowlisted files: manifest, README, skill, agent metadata, and selected
workflow. There is no `.app.json`, account/app ID, bridge root,
`personal-config.json`, or bundled generic `client-v1`. Installing this archive
alone does not connect ChatGPT to Zotero.

Follow [installation](../../docs/install.md) to install the matching Zotero
extension and locked MCP server, start its separately owned private tunnel
runtime, and create a 0600 account-specific archive with a verified real app ID.
The server artifact carries the helper for artifact-only reinstall. It preserves
the existing account interface and compatibility manifest and does not copy the
rest of the account source. Retain the configured archive, its deletion report,
and the pre-update account source as private recovery material.

After private configuration, manually save the paper and PDF in Zotero. In a
new ChatGPT conversation, select Zotero Study Save and give its arXiv link.
Later save requests reuse that conversation's paper without requiring another
selection or URL.

Instructions live in `skills/zotero/resources/workflow.md`. The
selected workflow calls the dedicated 14-tool MCP contract. Shared protocol
schemas ship with the server; the source-only generic file workflow remains in
`fallback/` and is excluded from the selected package. Private configuration
must not contain session IDs, paper state, credentials, or study history.

## Update

Update all four portable artifacts together, then configure the existing private
plugin from its two account manifests. Preserve plugin identity, presentation,
and default-prompt value/type/order. Apply every exact obsolete-file deletion
reported by the helper. Account updates reject lower versions and may bump an
unchanged version. A configured archive is private and must not be distributed.

## Remove

Uninstall Zotero Study Save in ChatGPT. This does not remove the tunnel/runtime,
bridge history, or native Zotero records. Remove the owned runtime and Zotero
extension separately using [removal](../../docs/uninstall.md). Preserve bridge
sessions and the operation journal through reinstall so historical saves cannot
duplicate.

Local package validation checks structure and examples; it cannot prove model
behavior or actual reader display. See [status](../../docs/tracking/status.md)
for observed capabilities and remaining limits.
