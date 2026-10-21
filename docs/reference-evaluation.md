# Reference implementation evaluation

This evaluation records primary-source findings available on 2026-10-21. No candidate plugin or rendering dependency was installed, copied, or modified during T1. The access preflight separately validated the connected MCP and direct Codex local request/result routes under the approved cycle scope; it did not produce ChatGPT Work or ChatGPT Web execution evidence and does not change the compatibility limits below.

## Actual Zotero runtime

The installed application is Zotero 10.0.6 with build ID `20261007113827`, running on macOS 15.7.9 arm64. Its application metadata declares Gecko compatibility 140.0–140.99.*. Better BibTeX 9.0.63 and ZotLit 2.1.4 were active in the inspected profile. The target project plugin, `zotero-annotation-markdown`, and the `cookjohn/zotero-mcp` plugin were not installed.

This proves the target host version and process state. It does not prove runtime compatibility for the new plugin because no installable project package exists yet. Manifest ranges from reference projects are compatibility claims, not acceptance-test results on this host.

Two Codex computer-use attempts to attach to the running Zotero UI, first by display name and then by bundle identifier `org.zotero.zotero`, each returned `timeoutReached -10005` after five seconds. No reader or viewer state was observed. This does not affect the completed file-route preflight, but real plugin and reader acceptance still requires a later accessible Zotero UI surface and may require user assistance.

## Official Zotero interfaces

| Interface | Primary-source evidence | Use and limit |
| --- | --- | --- |
| [Zotero local API](https://www.zotero.org/support/dev/web_api/v3/local_api) | Zotero 10+ exposes the Web API locally at `http://localhost:23119/api`. Writes require a local API key granted by a Zotero confirmation dialog. The response identifies the local server instance, and object versions are local to that instance. | Supported route for authenticated local writes. The port must not be forwarded or exposed. T1 did not request authorization because the returned credential could be exposed by the preflight. Real authorization and write behavior remain for a controlled later test. |
| [Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api) | Privileged client JavaScript can use Zotero's data-layer APIs. The official guide warns that direct SQLite access is more fragile and that parts of the API are incompletely documented. | Appropriate primary route inside a native Zotero plugin. Use Zotero item APIs and transactional saves, then validate against Zotero 10.0.6; avoid coupling the feature to the database schema. |

## Candidate implementations

### `54yyyu/zotero-mcp`

Evaluated commit [`eb016b1b746d183d19ba746249262cd0395f926c`](https://github.com/54yyyu/zotero-mcp/tree/eb016b1b746d183d19ba746249262cd0395f926c).

- [`src/zotero_mcp/client.py`](https://github.com/54yyyu/zotero-mcp/blob/eb016b1b746d183d19ba746249262cd0395f926c/src/zotero_mcp/client.py#L486-L728) probes the local API, obtains the server identity, requests Zotero's authorization dialog, supports single-use and remembered credentials, and constructs a local PyZotero client. This is a useful reference for the official local-write handshake. It must not be used to bypass the user's authorization prompt or to expose the returned key.
- [`src/zotero_mcp/tools/annotations.py`](https://github.com/54yyyu/zotero-mcp/blob/eb016b1b746d183d19ba746249262cd0395f926c/src/zotero_mcp/tools/annotations.py#L1397-L1884) implements text highlights, normalized area rectangles, sticky notes, dry runs, batching, and Zotero annotation payloads containing parent attachment, type, position, comment, color, and tags. This is a strong behavioral reference for native annotation creation.
- [`src/zotero_mcp/pdf_utils.py`](https://github.com/54yyyu/zotero-mcp/blob/eb016b1b746d183d19ba746249262cd0395f926c/src/zotero_mcp/pdf_utils.py#L288-L345) maps PyMuPDF top-left CropBox coordinates to PDF bottom-left MediaBox coordinates. [The serialization path](https://github.com/54yyyu/zotero-mcp/blob/eb016b1b746d183d19ba746249262cd0395f926c/src/zotero_mcp/pdf_utils.py#L906-L1011) handles normalized display coordinates, page rotation, page labels, and sort indexes. These calculations and their tests are valuable geometry references, but their exact dependency and license must not be imported by accident.
- [`src/zotero_mcp/pdf_layout.py`](https://github.com/54yyyu/zotero-mcp/blob/eb016b1b746d183d19ba746249262cd0395f926c/src/zotero_mcp/pdf_layout.py) detects geometric image, vector, table, and caption regions; it does not supply semantic understanding of a paper.

License finding: the root project identifies MIT material, while [`pyproject.toml`](https://github.com/54yyyu/zotero-mcp/blob/eb016b1b746d183d19ba746249262cd0395f926c/pyproject.toml) declares `MIT AND AGPL-3.0-or-later` and includes the bundled plugin license. The bundled Zotero Agent plugin is AGPL-3.0-or-later. Treating the current combined distribution as MIT-only would be incorrect. Use the algorithms and tests as a reference, preserve provenance for any copied material, and do not copy the bundled AGPL plugin unless the project explicitly accepts that license.

The optional PDF path depends on PyMuPDF. Its [official license documentation](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright) states that PyMuPDF and MuPDF are available under AGPL or a commercial license. Do not install or adopt it until the project makes an explicit AGPL or commercial-license decision. A different geometry adapter can be chosen later without changing the request/result file contract.

### `cookjohn/zotero-mcp`

Evaluated commit [`81d0777b49ded0959d197c7610d8b6e5f32c2485`](https://github.com/cookjohn/zotero-mcp/tree/81d0777b49ded0959d197c7610d8b6e5f32c2485), licensed MIT.

- The plugin [`manifest.json`](https://github.com/cookjohn/zotero-mcp/blob/81d0777b49ded0959d197c7610d8b6e5f32c2485/zotero-mcp-plugin/addon/manifest.json) declares Zotero 6.999 through 10.99.99, so Zotero 10.0.6 is inside its declared range. This is not proof that the uninstalled plugin runs correctly on this host.
- [`annotationService.ts`](https://github.com/cookjohn/zotero-mcp/blob/81d0777b49ded0959d197c7610d8b6e5f32c2485/zotero-mcp-plugin/src/modules/annotationService.ts) reads native attachments and annotations through `Zotero.Items`, `getAttachments`, and `getAnnotations`. Its annotation surface is primarily retrieval, not a ready-made implementation for creating annotation comments or PDF geometry.
- [`apiHandlers.ts`](https://github.com/cookjohn/zotero-mcp/blob/81d0777b49ded0959d197c7610d8b6e5f32c2485/zotero-mcp-plugin/src/modules/apiHandlers.ts) and the streamable MCP server use native Zotero item saves, deferred notifier handling, serialized writes, and a write-enabled preference. These are useful references for native write safety and transport lifecycle.
- [`writeOperations.test.ts`](https://github.com/cookjohn/zotero-mcp/blob/81d0777b49ded0959d197c7610d8b6e5f32c2485/zotero-mcp-plugin/test/writeOperations.test.ts) exercises real Zotero creation, serialized writes, safe trash behavior, disabled-write behavior, and refusal of permanent deletion.

Adoption finding: this is the clearest MIT native-plugin reference among the evaluated projects, particularly for Zotero transactions and write gating. Its current annotation API does not remove the need to implement and validate annotation-comment creation and PDF position handling.

### `qrkks/zotero-annotation-markdown`

Evaluated current release v0.16.2 at commit [`05d9029709baa7825670db20b3184b2bf2030e8e`](https://github.com/qrkks/zotero-annotation-markdown/tree/05d9029709baa7825670db20b3184b2bf2030e8e).

- Its manifest declares Zotero 9.0 through 10.0.*, which includes the installed 10.0.6. Project documentation also shows use with Zotero 10.0.6. The plugin was not installed here, so T1 did not independently reproduce that result.
- [`src/markdown-renderer.ts`](https://github.com/qrkks/zotero-annotation-markdown/blob/05d9029709baa7825670db20b3184b2bf2030e8e/src/markdown-renderer.ts) uses Markdown-it with raw HTML disabled, optional KaTeX math, a restricted link policy, DOMPurify sanitization, and escaped-text fallback. This is the strongest evaluated reference for safe rendered comments while preserving source text.
- [`src/plugin.ts`](https://github.com/qrkks/zotero-annotation-markdown/blob/05d9029709baa7825670db20b3184b2bf2030e8e/src/plugin.ts#L546-L632) updates reader annotations through the semi-internal `_annotationManager.updateAnnotations` path with feature detection and fallback. The project documentation warns that the reader sidebar DOM is not a stable public API, so Zotero updates require repeat acceptance testing.
- The documented composition root, registry, reader controller, sidebar adapter, and pure renderer provide a useful separation between lifecycle integration and rendering behavior.

License finding: current v0.16.2 is AGPL-3.0-or-later. The project states that releases through v0.15.4 were MIT and that existing grants remain valid; the v0.15.4 source is pinned at [`f899572eae3214df5096ca5356803b4e1872ee4c`](https://github.com/qrkks/zotero-annotation-markdown/tree/f899572eae3214df5096ca5356803b4e1872ee4c). If code is adapted without accepting AGPL, limit the source baseline to the MIT v0.15.4 tag, retain license and provenance, and independently implement later fixes. Current AGPL code may inform behavior, but copying it changes the licensing obligation.

## Resulting constraints

- Zotero 10.0.6 is the real target runtime; compatibility is not confirmed until the project plugin is packaged, installed with authorization, and exercised in the real reader.
- Native Zotero JavaScript APIs and the authenticated Zotero 10 local API are both viable write mechanisms. Any local API route must preserve the real Zotero authorization prompt and keep its credential local and redacted.
- `cookjohn/zotero-mcp` is the preferred MIT reference for native transactional writes. `54yyyu/zotero-mcp` is the strongest reference for local API authorization and annotation geometry, with mixed-license and PyMuPDF constraints. `qrkks/zotero-annotation-markdown` is the strongest rendering reference, with MIT use limited to v0.15.4 unless AGPL is accepted.
- No AGPL or commercial rendering/geometry dependency may be installed or copied until the license choice is explicit. No reference removes the need for real Zotero 10.0.6 acceptance testing.

## User-requested recheck

On 2026-10-21, the user explicitly requested reconsidering `54yyyu/zotero-mcp` while resuming implementation. `git ls-remote` confirmed its current `main` remains `eb016b1b746d183d19ba746249262cd0395f926c`, the commit evaluated above. Its current README and [getting-started guide](https://github.com/54yyyu/zotero-mcp/blob/eb016b1b746d183d19ba746249262cd0395f926c/docs/getting-started.md) were reread. The annotation geometry, dry-run and local-authorization patterns remain useful references. Its ChatGPT recipe requires a separately exposed HTTP MCP transport and tunnel; that recipe does not establish this account's Web access or replace the approved authenticated file bridge. No additional server, tunnel, credential or reference plugin was installed.

The runtime observations earlier in this document describe the initial preflight. Subsequent development-extension installation and real native-reader results are recorded in [native host validation](native-host-validation.md); they do not constitute acceptance of the reference projects themselves.
