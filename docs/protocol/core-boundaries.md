# Core boundaries and adapter obligations

The TypeScript contract uses ports so the core has no dependency on Zotero globals, filesystems, shells, networks, transports, or concrete persistence. In-memory implementations are suitable for unit tests only and are not operational evidence.

| Port | Responsibility |
| --- | --- |
| `PayloadDigestPort` | Apply a collision-resistant digest to canonical request bytes. |
| `OperationPersistencePort` | Atomically claim operation IDs, preserve immutable history, and persist optimistic lifecycle transitions across ordinary reinstalls. |
| `MutationSerializationPort` | Run one mutation body and its storage readback at a time for each profile. |
| `OperationRecoveryPort` | Inspect native state for a crash-left `running` identity without invoking a writer. |
| `AnchorResolutionPort` | Resolve quote or inspected-region evidence to a candidate native anchor. |
| `AnchorRevalidationPort` | Check the current PDF fingerprint, target, match evidence, and geometry immediately before a create. |
| `ZoteroReadPort` | Search and read papers, PDFs, annotations, and child notes without mutation. |
| `ZoteroWritePort` | Create or update only the authorized native annotation or child note and enforce revision/fingerprint conditions. |
| `ZoteroStorageReadbackPort` | Read back the saved native object. Its confirmation gates mutation success. |
| `ZoteroViewerVerificationPort` | Obtain evidence from the actual Zotero reader, independently from storage readback. |
| `UntrustedContentRenderingPort` | Render paper, annotation, and note content without executing embedded instructions, scripts, or links. |
| `ProtocolTransportPort` | Carry bytes and describe the transport; parsing and validation remain outside it. |

`OperationCoordinator` implements the pure ordering rules around these ports. It validates connected profile scope, pairs an operation ID with a canonical request digest, returns existing records without executing again, serializes mutations, applies lifecycle transitions, and interprets verification evidence. It does not implement a database or claim crash-safe persistence by itself.

The native execution layer must keep the following sequence inside the per-profile serialized section for a mutation:

1. Load the current target and recheck profile, parent, attachment fingerprint, authorization scope, and expected revision where applicable.
2. For an annotation create, revalidate anchor match evidence against the current attachment. Stop with `unresolved_anchor` or `stale_attachment` rather than choosing geometry.
3. Perform one scoped native Zotero write associated with the durable operation identity.
4. Read the saved native object back from storage and compare its exact location and complete content with the requested write.
5. Return storage verification. Viewer verification may then inspect the actual reader, but a viewer failure does not repeat a storage-confirmed write.

Append behavior belongs in the native adapter because it must read and preserve the current native value. An append must use the request's `expectedRevision`; it must not reconstruct content from an earlier client copy. Conflict handling stops the write and requires a fresh read and new approval.

Recovery uses `OperationRecoveryPort.reconcile` only for a durable record left in `running`. It searches by historical operation identity and returns observed evidence. It does not pass through `ZoteroWritePort`, and it never recreates a missing object for a historical operation.
