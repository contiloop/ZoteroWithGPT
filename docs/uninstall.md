# Disable, uninstall, and reinstall

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

## Optional cleanup of owned transient files

After the plugin is disabled and removed, the selected dedicated bridge
directory can contain only companion transport data:

```text
bridge-v1.json
sessions/<session-id>/status-v1.json
sessions/<session-id>/requests/
sessions/<session-id>/results/
```

If the directory was dedicated to this plugin, move exactly `bridge-v1.json`
and the `sessions` directory to Trash. Inspect the directory first and leave
any unrecognized file in place. Do not delete the selected directory itself
unless you created it only for the companion and have confirmed it is empty.

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

## Reinstall

Install the versioned XPI through the Plugins Manager, open **Research
Companion Settings…**, select a dedicated existing directory, and choose
**Enable**. Reinstall creates a fresh session and publishes a new descriptor.
Never copy pending request files from an older session into the new one
automatically.

The retained journal preserves the Zotero profile identity and prior operation
results. A client recovering an earlier authorized operation uses the same ID
and identical payload in the current session. A changed target or changed
content requires a new ID and new user authorization.
