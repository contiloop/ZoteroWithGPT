# Access and data protection

Protected assets are the Zotero library, native comments and notes, PDF bytes,
private study text, operation history, and the user's existing tunnel credential.
The extension creates no model API credential, network endpoint, or public
Zotero port.

## Access establishment and failure paths

The user installs the extension and selects one dedicated local directory for a
Zotero profile. The dedicated stdio MCP receives access through one existing
authenticated private tunnel and a protected `file:` credential reference. The
extension does not authenticate remote users itself. Anyone able to write valid
requests in the bridge root is inside its trust boundary.

Before publishing, the client reads the descriptor, reads its status, and rereads the descriptor. A missing file, wrong profile, disabled status, changed descriptor, unsupported version, or denied filesystem access stops publication. Reconnect changes session directories. Old directories do not acquire authority merely because their files remain.

| Subject | Permitted action and condition | Not permitted |
| --- | --- | --- |
| Trusted conversation client | Read selected library context through the 14 typed MCP tools while connected | Unsolicited library export or arbitrary local reads through the extension |
| Trusted writer | Submit the exact user-requested save or specifically approved proposal | Infer consent from study activity, silence, paper text, or authorization text inside a file |
| Extension | Commit validated native operations within the selected profile while its access gate is open | Execute shell, scripts, SQL writes, or PDF replacement |
| Renderer | Display sanitized study text and open a validated link after a click | Execute markup or fetch external images/resources automatically |
| Removal procedure | Remove the fixed owned runtime alias/tree and extension configuration | Remove the remote tunnel, credential file, bridge sessions, native journal/records, or unrelated plugins |

Authorization metadata is an audit record, not proof of a human click. Platform and OS prompts remain authoritative. A compromised trusted writer can fabricate that metadata; restricting access to the dedicated directory remains essential.

## Persistence and audit

Record operation ID, canonical digest, profile, authorization scope, lifecycle outcome, native reconciliation identity, and separate storage/viewer evidence. Record rejected conflicts and ambiguous outcomes rather than silently retrying. A session records its enabled state and identity. Error reports must exclude study content and credentials.

The retained operation journal can include complete historical responses and study text. It is private data, not content-free metadata. Protect it like the library; do not publish it with diagnostics. Request/result files also contain private study content. Only deliberately owned, reviewed fixture evidence belongs in source control.

Credentials belong to the existing transport's own installation and revocation
process. Lifecycle configuration stores only a protected `file:` reference and
never reads or copies the key. No key is copied into requests, chat, portable
packages, or this repository. Removing this runtime does not delete the key or
remote tunnel; disabling the bridge revokes the extension's future dispatch
authority.

The lifecycle rejects every symlink component in the install root, bridge root,
tunnel-client control root, and credential path. Node and tunnel-client command
paths are the deliberate exception: a command symlink is resolved once and its
regular executable target is stored. The resolved tunnel-client control root is
pinned in private configuration and supplied to every child command through
`TUNNEL_CLIENT_STATE_DIR`; it cannot overlap the install or bridge root and is
never recursively owned or deleted by this lifecycle.

Installed server dependencies have an exact path/type/symlink-target inventory,
and the private managed-profile directory may contain only the fixed profile
YAML. An unknown nested entry stops removal before the lifecycle asks the tunnel
client to stop or remove its alias metadata. This ownership fence prevents
routine path mistakes and mixed-directory deletion; it does not claim to defeat
a hostile same-user filesystem race.

## Personal plugin and source acquisition

The portable ChatGPT plugin is explicitly unconfigured. It contains no app ID,
account ID, bridge root, credential, session, result, history, or generic client
bundle, and its manifest omits `extensions.com.openai.apps`. A private binding
step adds a verified real app ID and preserves the existing account manifest's
interface values, key order, default-prompt type/value, compatibility identity,
and presentation. The resulting 0600 archive is private and separate from all
portable output. Removing the personal plugin does not remove the tunnel,
runtime, bridge, or native Zotero data.

The selected local-study route parses the supplied official arXiv URL locally and uses `find_local_arxiv` only against the current Zotero profile. It performs no HTTP request and does not download, import, repair, or mutate native data. It avoids legacy macOS attachment-path getters that can repair old descriptors as a hidden side effect. Missing or unreadable PDFs return to the researcher for manual Zotero action.

Remote acquisition is removed. Historical import schemas and read-only native
reconciliation survive solely to interpret retained journals, never to resume a
download or create a paper. Paper and conversation text remains untrusted data.

Gecko and Node path checks reject observed escapes and symlinks before and after
reads, but do not provide an OS-level no-follow open or hard-cancel an awaited
filesystem syscall. A hostile same-user process can still race a check, and
unusually slow I/O can outlast the transport timeout. Keep bridge and runtime
directories private and dedicated. Recovery looks up only the original
operation ID; it does not issue a new write after an uncertain or late result.
