# Connection validation

Status: **PASSED for the approved T1 scope — both the connected MCP route and the direct Codex local fallback completed bounded real-file round trips.**

This record covers T1 preflight evidence collected on 2026-10-21. It distinguishes the surface that performed each action. A successful call from Codex to a connected MCP server is not evidence that the same tool is installed or usable in ChatGPT Web. A direct Codex local file test is likewise not evidence of independent ChatGPT Work availability.

The approved execution-route amendment for this cycle accepts either real Codex local execution or Work local execution for the no-MCP fallback. The user accepted Codex or Work for this purpose, and the Codex route was available and tested. Work remains unverified and is no longer a T1 gate for this cycle.

## Evidence matrix

| Real surface | Version or identity | Date | Action | Observed response | MCP or Work | Permission prompt |
| --- | --- | --- | --- | --- | --- | --- |
| Codex desktop agent → connected **Mac Safe Files** server | Server reported `direct-macos`, first-party local Node structured tools, Node `v26.5.0`; transport reported outbound OpenAI Secure MCP Tunnel | 2026-10-21 | Read server policy and host information | Allowed root `/Users/USER`; canonical-path enforcement; UTF-8 text operations and bounded file sizes; no shell, GUI, browser, or network tools. Host reported macOS 15.7.9 build 24G830 on arm64. | MCP | None appeared in this Codex call. The server policy says the ChatGPT app should remain **Always ask**. |
| Codex desktop agent → connected **Mac Safe Files** server | Same connection | 2026-10-21 | Create the dedicated probe directory, write one 88-byte text file, read it, stat it, delete it, confirm the directory empty, and remove the owned empty directory | Read content matched exactly. SHA-256 was `01340a02d49f058ea4b91b79dfb8907737ca0888e2a8c2ee46d5af80d6af2ac3`; canonical file path was `/Users/USER/Desktop/ZoteroWithGPT/.dryforge/connection-probe/t1-roundtrip-20261021.txt`; stat reported 88 bytes and mtime `2026-10-21T07:54:23.166Z`. Delete succeeded; final directory listing was empty; directory removal succeeded. | MCP | None appeared. This proves the Codex-originated MCP round trip only. |
| Codex desktop local task → macOS filesystem through `exec_command` | zsh 5.9 on macOS 15.7.9 arm64 | 2026-10-21 | Create a dedicated directory; write and read `request.json`; write and read `result.json`; assert both exact readbacks; record canonical paths, byte counts, and SHA-256 values; delete both owned files and the directory | `request.json` was 51 bytes with SHA-256 `b9a3af155ec695c47d9f9b7b90bd84cd242b03318decec64947f413c786eb3c0`. `result.json` was 127 bytes with SHA-256 `4d8c5339b8f7c2c8c9f39b0ce50731c04eed1b0fc5d2affbec0d43ea580454dd`. Both exact-content assertions passed; cleanup was confirmed. | Neither MCP nor Work; direct Codex local route | None appeared. This satisfies the approved no-MCP fallback for this cycle. |
| Codex → plugin permission inspector | Installed app identity **Mac Safe Files** | 2026-10-21 | Read current app permission policy | Global default was `Allow low-risk actions`; the app-specific override was `Allow all actions`. | Neither Work nor the file MCP action; connector metadata read | None appeared because this was a read-only inspection. The observed override conflicts with the server policy requirement that ChatGPT remain **Always ask**. |
| Local macOS shell → installed Zotero application | Zotero 10.0.6, build ID `20261007113827`, Gecko compatibility 140.0–140.99.*; macOS 15.7.9 arm64 | 2026-10-21 | Read application metadata and list running processes | `/Applications/Zotero.app` reported bundle versions 10.0.6; the Zotero main process and plugin container were running. | Neither | None; read-only local inspection. |
| ChatGPT Work local task without Mac Safe Files | Not observed | 2026-10-21 | Optional future parity test using a dedicated `request.json` / `result.json` pair | No Work-originated files or result exist in the evidence available to this task. Work support remains unverified and is not claimed. | Work | Unknown until a real Work run. |
| ChatGPT Web study → installed plugin → Zotero viewer | No plugin package exists yet | 2026-10-21 | End-to-end study/comment delivery | Not run. This belongs to the later end-to-end gate after the plugin exists; it is not substituted by the Codex MCP probe. | Intended MCP/Web path | Unknown until that later run. |

No credentials, API keys, tunnel keys, profile contents, or Zotero local API authorization tokens were read or recorded.

## Bounded MCP round trip

The probe file contained only:

```text
T1 bounded Mac MCP round-trip probe
Date: 2026-10-21
Nonce: zotero-with-gpt-t1-4f4fc72b
```

The server exposed `policy_status`, `fs_stat`, `fs_list`, `fs_read_text`, `fs_write_text`, `fs_mkdir`, `fs_move`, `fs_delete`, `system_info`, and `process_list`. Its reported rules restrict access to canonical paths under `/Users/USER`, deny sensitive locations and names, cap operation sizes, and use atomic writes. It explicitly exposes no shell, GUI, browser, or network operation. The backend reported `codex: false`: the server itself does not use a Codex process, Codex authentication, or Codex credits.

The file and its dedicated empty directory were deleted after verification. This leaves no retained probe artifact in the main project.

## Direct Codex local round trip

The no-MCP fallback used direct Codex local filesystem execution in `/Users/USER/Desktop/ZoteroWithGPT/.dryforge/local-connection-probe`. The command first required the directory not to exist, created it with a restrictive umask, and wrote these exact one-line JSON documents:

```json
{"probe":"zotero-with-gpt-t1","date":"2026-10-21"}
```

```json
{"request":{"probe":"zotero-with-gpt-t1","date":"2026-10-21"},"executionSurface":"Codex local exec","permissionPrompt":"none"}
```

`cat` readback matched both in-memory expected strings. `request.json` resolved to `/Users/USER/Desktop/ZoteroWithGPT/.dryforge/local-connection-probe/request.json` and measured 51 bytes; `result.json` resolved to `/Users/USER/Desktop/ZoteroWithGPT/.dryforge/local-connection-probe/result.json` and measured 127 bytes. The hashes are recorded in the evidence matrix. Both files and the owned directory were deleted, and a final absence assertion passed.

This proves that the accepted Codex local alternative can use the dedicated request/result file convention. It does not prove that ChatGPT Work can use the files, and it does not substitute for the later ChatGPT Web-to-plugin-to-Zotero viewer test.

## Later host-access check

The native-app inventory lists Zotero as running. Three attempts to bind its
window through the computer-use tool timed out (`timeoutReached -10005`), while
the same tool successfully read Finder. Opening the installed Zotero app through
Finder did not resolve the binding failure. A loopback connector ping on port
23119 returned connection refused; this alone does not establish why the service
is unavailable. No process was force-quit and no preference was changed.

The running plugin-container process reports parent build `20260922124338`,
whereas the application on disk reports `20261007113827`. The installed version
and a running process are insufficient to identify the running application's
version. Native integration must query the actual host version once access is
available, and required an ordinary restart.

With the user’s authorization, Activity Monitor’s **Quit** action terminated the
old Zotero process (PID 34560); its absence was confirmed. Reopening Zotero
through the computer-use tool succeeded and exposed the paper reader and
annotation sidebar. No **Force Quit** action was used. The reopened application’s **About Zotero**
window visibly reported **10.0.6**. Plugin startup, native API behavior and
annotation display still require a loaded development build.

## Setup and removal evidence

OpenAI's [Secure MCP Tunnel setup documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#set-up-tunnel-client) supports this reproducible path without copying another user's secrets:

1. Obtain the tunnel client from the Platform tunnel settings or the official public release.
2. Create a new named stdio profile for the user's own tunnel ID and local MCP server command, or an HTTP profile for the user's own MCP URL.
3. Run the documented `doctor` check, then start the profile and use its local `/ui` health page to confirm readiness and connection.
4. Follow OpenAI's [ChatGPT connection steps](https://developers.openai.com/plugins/deploy/connect-chatgpt#prepare-the-endpoint): enable Developer mode under **Settings → Security and login**, add a plugin through the Plugins page, choose **Tunnel**, supply the complete tunnel ID, and select **No authentication** for this server. The tunnel runtime key belongs only in the local tunnel client; it must not be pasted into the ChatGPT plugin form.
5. Test from ChatGPT itself. A direct Codex MCP configuration is a different surface and cannot validate the ChatGPT plugin.

The current evidence does not establish a public release or install package for the custom **Mac Safe Files** server. It was absent from the public plugin search, and dependency inspection returned `plugin_not_found`. Another user therefore also needs a non-secret, versioned server package and owner runbook; copying the present machine's profile, runtime key, or credential files is not an acceptable setup method.

For removal, disconnect or remove the installed ChatGPT plugin through plugin management, stop and remove that user's named tunnel-client profile, and verify that the tools no longer appear. Do not delete raw credential files or shared organization tunnel material. The exact uninstall command for the custom local server is not evidenced and must come from its versioned owner runbook.

Before production use, the owner or administrator must reconcile the observed **Allow all actions** override with the server's stated **Always ask** requirement. This preflight deliberately did not change account, plugin, MCP, or organization permissions.

## Optional future Work verification

Work parity can be established later with a real user-started Work local task. Use this non-secret prompt verbatim:

> Use only direct local file access (no Mac MCP, no shell network, no Zotero writes). In `/Users/USER/Desktop/ZoteroWithGPT/.dryforge/work-connection-probe` create `request.json` containing `{"probe":"zotero-with-gpt-t1","date":"2026-10-21"}`; read it back; write `result.json` with the exact request object plus your execution surface and whether any permission prompt appeared; then read `result.json` and report both canonical paths and byte counts. Do not inspect other files or credentials. Leave both files for verification.

Any future Work claim requires inspecting the two files from the project host and recording the Work response's real surface, action, observed result, and permission-prompt behavior. The run must use Work's direct local file capability without Mac Safe Files. If Work cannot create the files, record the exact error and prompt behavior. The successful Codex test satisfies the amended cycle scope but must continue to be labeled as Codex rather than Work.

OpenAI's [Work local security documentation](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security#files-and-device-access) explains that local tasks can access supported local files and authorized systems within the user's existing privileges and configured controls. It does not establish that this account has the capability. Until a real Work run succeeds, Work compatibility with this request/result convention remains unverified.
