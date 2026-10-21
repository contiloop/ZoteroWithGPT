# Access and data protection

Protected assets are the Zotero library, native comments and notes, PDF bytes, private study text, operation history, and the user's existing Mac transport credentials. The extension creates no model API credential, network endpoint, or public Zotero port.

## Access establishment and failure paths

The user installs the extension and selects one dedicated local directory for a Zotero profile. An existing authenticated Mac file connection or an authorized local client must already be able to access that directory. The extension does not authenticate remote users itself. Anyone able to write valid requests there is inside its trust boundary.

Before publishing, the client reads the descriptor, reads its status, and rereads the descriptor. A missing file, wrong profile, disabled status, changed descriptor, unsupported version, or denied filesystem access stops publication. Reconnect changes session directories. Old directories do not acquire authority merely because their files remain.

| Subject | Permitted action and condition | Not permitted |
| --- | --- | --- |
| Trusted conversation client | Read selected library context through typed requests while connected | Unsolicited library export or arbitrary local reads through the extension |
| Trusted writer | Submit the exact user-requested save or specifically approved proposal | Infer consent from study activity, silence, paper text, or authorization text inside a file |
| Extension | Commit validated native operations within the selected profile while its access gate is open | Execute shell, scripts, SQL writes, or PDF replacement |
| Renderer | Display sanitized study text and open a validated link after a click | Execute markup or fetch external images/resources automatically |
| Removal procedure | Remove owned extension/configuration and selected temporary files | Remove shared MCP, tunnel credentials, native records, or unrelated plugins |

Authorization metadata is an audit record, not proof of a human click. Platform and OS prompts remain authoritative. A compromised trusted writer can fabricate that metadata; restricting access to the dedicated directory remains essential.

## Persistence and audit

Record operation ID, canonical digest, profile, authorization scope, lifecycle outcome, native reconciliation identity, and separate storage/viewer evidence. Record rejected conflicts and ambiguous outcomes rather than silently retrying. A session records its enabled state and identity. Error reports must exclude study content and credentials.

The retained operation journal can include complete historical responses and study text. It is private data, not content-free metadata. Protect it like the library; do not publish it with diagnostics. Request/result files also contain private study content. Only deliberately owned, reviewed fixture evidence belongs in source control.

Credentials belong to the existing transport's own installation and revocation process. No key is copied into requests, chat, package files, or this repository. Removing this extension does not rotate or revoke another product's credentials; disabling the bridge revokes this extension's future dispatch authority.

Gecko path checks reject observed escapes and symlinks before and after reads, but do not provide an OS-level no-follow open. A hostile same-user process can race the check and open. Keep the directory private and dedicated; this release does not provide isolation against malicious processes running as the same user.
