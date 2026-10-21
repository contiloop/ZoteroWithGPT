# Boundary interfaces

Typed replaceable Zotero, anchor, rendering, execution, transport, digest, and persistence contracts. No concrete adapter registration or runtime globals.

Describe observable semantics, especially storage versus viewer evidence, current revisions, durable identity, and failure classification. Do not smuggle arbitrary callbacks, executable request strings, or concrete Gecko objects into the wire protocol.

A changed interface requires checking each implementing adapter and its consumer. Preserve independent fake implementations for core tests and actual-host validation for native claims.
