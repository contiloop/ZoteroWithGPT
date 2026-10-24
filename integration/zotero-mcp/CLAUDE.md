# Dedicated Zotero MCP

This stdio adapter wraps protocol v1 through the replaceable bridge port. Keep
the 14 public tool contracts fixed unless the shared protocol changes. Native
authorization, writes, readback, reconciliation, and journals remain in Zotero.

Package only the local import graph, locked production dependencies, and shared
schemas. Install from a clean relocated package. The owned lifecycle may manage
only its stable runtime root and fixed tunnel alias/profile; it must retain the
bridge sessions and Zotero operation journal through ordinary reinstall.
