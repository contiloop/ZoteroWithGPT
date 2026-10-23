# Zotero Study Save

Study a manually saved Zotero PDF in ChatGPT Web, then ask to save a particular
question, explanation, proof, reference, or highlight beside its passage.

## Private one-time setup

1. Install the matching Zotero extension using [installation](../../docs/install.md).
2. Allow its dedicated bridge root in the existing Mac Safe Files connection.
3. Install this portable plugin privately, retaining its Mac Safe Files binding.
   Set only `skills/zotero-study-save/resources/personal-config.json` →
   `bridgeRoot` in the personal instance; distributed source keeps it `null`.
4. Manually save the paper and PDF in Zotero. In a new ChatGPT conversation,
   select Zotero Study Save and give its arXiv link. Later save requests reuse
   that conversation's paper without requiring another selection or URL.

Instructions live in `skills/zotero-study-save/resources/workflow.md`; the
bundled `client-v1/protocol/v1-request.schema.json` and response schema define
file operations. Private configuration must not contain session IDs, paper
state, credentials, or study history.

## Update

Update the existing private plugin and Zotero extension together. Account
updates require a greater semantic version. Preserve the plugin identity, Mac
Safe Files dependency, and private `bridgeRoot`; portable archives never contain
that personal value. An account-exported configured archive is private and
must not be distributed.

## Remove

Uninstall Zotero Study Save in ChatGPT. This does not remove Mac Safe Files and
does not delete native Zotero records. Remove the Zotero extension separately
using [removal](../../docs/uninstall.md). Preserve the operation journal through
reinstall so historical saves cannot duplicate.

Local package validation checks structure and examples; it cannot prove model
behavior or actual reader display. See [status](../../docs/tracking/status.md)
for observed capabilities and remaining limits.
