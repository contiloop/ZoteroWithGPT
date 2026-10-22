# Disable, uninstall, and reinstall

The Zotero extension, private ChatGPT plugin, and Mac Safe Files connection are
separate components. Remove or update each through its own product surface.
Removing one component does not authorize deleting another component's files,
connection, credentials, or native Zotero records.

## Disable processing

Choose **Tools → Research Companion Settings…**, then choose **Disable**. The
runtime closes its native access gate before asynchronous bridge cleanup, and
the active session status changes to `"enabled": false`. New requests in that
session are not dispatched after disable.

An operation that already passed the final ownership check may finish. Do not
assume that a missing result means a mutation did not commit. Recover an
uncertain operation only with its exact prior operation ID and payload after
renewed user authorization.

## Remove the plugin

1. Disable the connection and confirm the displayed status.
2. Open **Tools → Plugins**.
3. Find **Zotero AI Research Companion**, open its menu, and choose **Remove**.
4. Confirm that **Research Companion Settings…** no longer appears in the Tools
   menu.

Removing the plugin stops its processing. Native Zotero annotations and notes
remain in the library. The plugin does not delete or rewrite those records.

The profile-local operation identity journal is intentionally retained at:

```text
<ZOTERO_PROFILE>/zotero-ai-research-companion/operations-v1.json
```

Keep this file across ordinary uninstall and reinstall. It records historical
operation identities and prevents the same authorized native mutation from
being executed again. It is safety metadata, not a cache.

## Optional cleanup of owned connection files

After the plugin is disabled and removed, the selected dedicated bridge
directory can contain companion transport data and the copied client kit:

```text
bridge-v1.json
sessions/<session-id>/status-v1.json
sessions/<session-id>/requests/
sessions/<session-id>/results/
client-v1/README.md
client-v1/docs/
client-v1/protocol/
```

If the directory was dedicated to this plugin, move exactly `bridge-v1.json`,
the `sessions` directory, and the copied `client-v1` directory to Trash. Inspect
the directory first and leave any unrecognized file in place. Do not delete the
selected directory itself unless you created it only for the companion and have
confirmed it is empty. The release-bundle client folder outside the bridge is a
separate copy and is not changed by the plugin.

The two owned preferences are:

```text
extensions.zotero-ai-research-companion.enabled
extensions.zotero-ai-research-companion.bridgeDirectory
```

They may be reset through Zotero's Config Editor after removal if a completely
clean local setup is required. Reset only those exact keys. Do not delete the
operation identity journal, Zotero profile, Zotero library data, native
annotations or notes, MCP configuration, tunnel profiles or keys, or files
owned by another plugin.

Removing a Mac Safe Files connection or secure tunnel is a separate product
operation. Follow its owner's runbook. Uninstalling this XPI does not authorize
changes to a shared MCP server, organization connection, or tunnel.

## Remove the private ChatGPT plugin

In ChatGPT plugin management, find the owned private **Zotero Study Save**
plugin and use its normal uninstall or delete action. Verify its exact owned
identity before removal. Leave unrelated plugins and the independently
connected Mac Safe Files app in place.

Removing the ChatGPT plugin stops its workflow from appearing in new chats. It
does not remove the Zotero XPI, dedicated bridge directory, operation identity
journal, imported papers, PDFs, annotations, or notes. An account download of a
configured private plugin can contain the personal `bridgeRoot` and
account-generated metadata; treat it as private and do not redistribute it as
the portable release ZIP.

## Reinstall

Install the versioned XPI through the Plugins Manager, copy the matching client
kit, open **Research Companion Settings…**, select a dedicated existing
directory, and choose **Enable**. Reinstall creates a fresh session and
publishes a new descriptor. Never copy pending request files from an older
session into the new one automatically.

Update the existing private ChatGPT plugin with the matching portable plugin
archive using a strictly greater semantic version. Preserve its owned identity
and Mac Safe Files dependency. Restore only the private `bridgeRoot` if the
account update flow does not retain it. Do not copy a profile ID, session,
descriptor, pending request, result, credential, or study content into the
plugin. Start a fresh ordinary chat after the update; the workflow will
rediscover the current Zotero session internally.

The retained journal preserves the Zotero profile identity and prior operation
results. A client recovering an earlier authorized operation uses the same ID
and identical payload in the current session. A changed target or changed
content requires a new ID and new user authorization.

A terminal `indeterminate` result remains historical unknown evidence across
reinstall. Reinstall must not turn it into a new import or a new save.
