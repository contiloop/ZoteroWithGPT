# Remove and reinstall

Disable the bridge in **Tools → Research Companion Settings…**, then remove
**Zotero AI Research Companion** in **Tools → Plugins**. Normally quit and reopen
Zotero to complete removal. Native papers, annotations, and notes remain.

Retain this private journal through ordinary reinstall:

```text
<ZOTERO_PROFILE>/zotero-ai-research-companion/operations-v1.json
```

It contains historical outcomes and duplicate-prevention identities, not a
cache. Reinstall never authorizes repeating an uncertain write.

## Optional connection cleanup

After disable/removal, remove only owned `bridge-v1.json`, `sessions/`, and
`client-v1/` in the dedicated root. Leave unrecognized files and shared Mac MCP
configuration intact. To reset local setup, reset only:

```text
extensions.zotero-ai-research-companion.enabled
extensions.zotero-ai-research-companion.bridgeDirectory
```

In ChatGPT, **Uninstall** removes the personal plugin from active use;
**Delete plugin** destroys its owned backend and is not routine reinstall.
Neither removes Mac Safe Files or native Zotero records. Configured account
archives contain the private root and must not be redistributed.

## Reinstall

After the removal-completing restart, install the matching XPI, normally restart
again, copy the matching client kit, and explicitly enable a dedicated root.
Installing before the first restart once appeared enabled but did not persist.
Use the fresh session; never automatically move old pending requests into it.

Update the existing private ChatGPT plugin with a greater semantic version,
keeping its identity, dependency, and private `bridgeRoot`. Restore only that
setting if necessary. Select it in a new chat after updating. Keep terminal
unknown outcomes historical and recover nonterminal writes with their original
identity rather than a replacement ID.
