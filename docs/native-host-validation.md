# Development native-host validation

These checks ran on 2026-10-21 against the actual macOS Zotero 10.0.6 application,
using a development-only composition of the native and file adapters. They do not
establish release readiness, ChatGPT Web-origin access, or mathematical rendering.
The user approved local extension installation and writes to a separate owned test
PDF. Existing papers were not changed.

## Build and installation

The plugin ID is `research-companion@zoterowithgpt.local`, development version
`0.1.0.1`. It was installed through Zotero's Plugins Manager. Startup reported
Zotero 10.0.6, a durable profile identifier and an enabled file-bridge session.
The bridge is restricted to the disclosed repository-local development directory.
The release must provide directory selection and remove developer-specific paths.

Zotero requires an HTTPS update URL. A reserved `updates.invalid` URL permits this
local test build to load; it provides no update service. Release packaging and the
actual distribution/update strategy remain pending.

## Owned fixture

The ordinary Zotero import interface imported one journal item and copied its PDF
into Zotero attachment storage. The fixture contains a unique sentence, a repeated
sentence and a short recurrent equation. Its marker note identifies test ownership.

| Object | Native key |
| --- | --- |
| Parent item | `5JYKRIIT` |
| PDF attachment | `XI9DWNHS` |
| Ownership marker note | `UXF76RHR` |
| Optional native item-note test | `Y3MW6EDI` |
| Proof-context highlight | `986UN7S4` |

The original PDF SHA-256 is
`c2fbe4c5d2d2a372492278542b9aa4008dbf8407f8bc54335a3aaf30b990e336`.
The native highlight targets page index 0, label 1, the exact text
`Proof context: s(i) = R(e, s(i-1)).`, with native PDF rectangle
`[50, 687.516, 218.37200000000007, 698.616]`.

## Observed behavior

- Mac Safe Files MCP calls originating from Codex published `connection_status`
  and read its successful result. This is not ChatGPT Web-origin evidence.
- Direct Codex file requests searched the fixture, read page 1, and listed native
  annotations and child notes.
- The repeated sentence produced two candidates and an unresolved anchor. It was
  not arbitrarily selected or saved.
- The optional item-note operation `native-fixture-note-create-1` saved a Korean
  question and induction proof, with confirmed native storage readback. This is
  an explicitly tested optional operation, not the default storage destination.
- Mac MCP operation `native-mcp-proof-highlight-1` saved native highlight
  `986UN7S4` with a Korean question, interpretation, stepwise induction example
  and reference URL. Storage readback confirmed the exact content and geometry.
- Actual Zotero reader accessibility inspection showed the highlight in the
  annotations sidebar on page 1. Selecting it exposed the original passage and
  the normal editable Annotation comment field containing the Korean content.
  This establishes native sidebar visibility and editability, not typeset math.
- `native-proof-append-1` appended a question to that annotation. The actual
  reader sidebar refreshed with the appended content.
- An edit made through Zotero's native comment editor changed its revision.
  `native-proof-stale-edit-1` then rejected the earlier revision with `conflict`.
  A fresh annotation list confirmed that the manual content remained and that
  the fixture had one annotation. The manually edited proof was retained.
- A controlled trailing-comment change to the owned stored PDF caused
  `native-real-changed-pdf-1` to reject with `stale_attachment`: the open reader's
  loaded bytes differed from storage. The probe restored the exact original
  bytes and asserted their original SHA-256. No annotation was written by it.
- Against the installed plugin, incomplete staging was ignored; malformed JSON,
  wrong-profile, oversized and symlinked requests were rejected. The actual
  script assertions exited 0. A first check incorrectly expected a nonexistent
  `profile_mismatch` code; the corrected check asserts `permission_denied`.

## Diagnosed host boundaries and remaining checks

The actual PDF worker rejected a caller-realm object with `DataCloneError`.
Cloning its page request into the PDF iframe fixed the actual read. Separately,
`getAnnotationMeta` could not see properties of caller-realm position geometry.
Cloning position into the outer reader iframe fixed actual highlight creation.
Both changes have focused regression tests and independent bounded review.

The earlier unique-sentence operation `native-mcp-highlight-create-1` remains
historically `indeterminate`. Its diagnostic error occurred in metadata lookup
before native save, and subsequent native lists were empty. It was not replayed
or replaced with another identity. The successful proof-context operation has a
different passage and content. Unknown results must not trigger blind retries.

The automated `verify_annotation` check currently reports reader evidence as
failed despite the independently observed native sidebar. Its detection remains
under investigation; storage and UI observations must not be conflated. Crash-
boundary recovery, disable/reconnect and reinstall checks are pending. Later
release checks must also cover rich mathematical rendering, installation cleanup
and a real ChatGPT Web study session.
