# Remove and reinstall

Ordinary reinstall preserves both private histories:

```text
<BRIDGE_ROOT>/sessions/
<ZOTERO_PROFILE>/zotero-ai-research-companion/operations-v1.json
```

Requests/results can contain study text, and the journal contains historical
outcomes and duplicate-prevention identities. Neither is a cache. Never delete
or migrate them as part of routine reinstall, and never replay pending files.

## Stop or remove the owned MCP runtime

Use the stable controller. `stop` affects only the fixed
`zotero-study-save-mcp` process and retains the installed runtime:

```sh
node "<OWNED_RUNTIME_ROOT>/bin/zotero-mcp-lifecycle.mjs" stop \
  --install-root "<OWNED_RUNTIME_ROOT>"
```

For complete runtime removal, use `remove` directly; it stops the process, asks
`tunnel-client runtimes rm` to remove the same local alias metadata, then removes
only the fenced owned runtime tree:

```sh
node "<OWNED_RUNTIME_ROOT>/bin/zotero-mcp-lifecycle.mjs" remove \
  --install-root "<OWNED_RUNTIME_ROOT>"
```

Removal fails closed if the root marker/config was copied, is a symlink, points
to another root, or the tree contains unknown files. It does not delete the
remote tunnel, credential file, bridge root or sessions, Zotero profile/journal,
native records, shared runtimes, or another plugin.

## Zotero extension

Disable the bridge in **Tools → Research Companion Settings…**, then remove
**Zotero AI Research Companion** in **Tools → Plugins**. Quit and reopen Zotero
to complete removal. Native papers, annotations, and notes remain. To reset only
extension setup, clear these two owned preferences:

```text
extensions.zotero-ai-research-companion.enabled
extensions.zotero-ai-research-companion.bridgeDirectory
```

In ChatGPT, **Uninstall** removes the personal plugin from active use;
**Delete plugin** destroys its owned backend and is not routine reinstall.
Neither removes the dedicated tunnel/runtime nor native Zotero records.
Configured account archives contain a private app binding and must not be
redistributed.

## Reinstall

After the removal-completing restart, install the matching XPI, normally restart
again, and explicitly enable the same dedicated root. Installing before the
first restart once appeared enabled but did not persist. Install the clean
locked MCP package into the same owned runtime root; same-version install
replaces the owned release from its hash inventory and preserves bridge/native
history. Start it and require ready status before updating the account plugin.

Update the existing private ChatGPT plugin with a guarded semantic version,
preserving its identity and presentation. Apply every exact `deletePaths` entry
reported by the configuration helper so overlay updates cannot revive the old
generic client or personal config. Select it in a new chat after updating. Keep
the protected configured archive, configuration result, and pre-update account
source before deleting a checkout. Portable artifacts cannot recreate private
account presentation, route resources, bridge sessions, or native history. Keep
terminal unknown outcomes historical and recover nonterminal writes only with
their original identity.

## Rollback

Runtime rollback stops the owned alias and restores the previous installed
route/config without starting it or replaying work:

```sh
node "<OWNED_RUNTIME_ROOT>/bin/zotero-mcp-lifecycle.mjs" rollback \
  --install-root "<OWNED_RUNTIME_ROOT>"
```

Inspect the restored config, then start explicitly. Account-route rollback is
separate. The account service rejects a lower plugin version, so do not upload
the original 0.4 archive over 0.5. If live acceptance needs the old route, build
from the preserved private old-route content under a newer guarded version and
apply it deliberately. Do not distribute that backup.
