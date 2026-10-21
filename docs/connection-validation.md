# Connection validation

Status: **BLOCKED — the required ChatGPT Work local file test has not yet run.**

This record covers T1 preflight evidence collected on 2026-10-21. It distinguishes the surface that performed each action. A successful call from Codex to a connected MCP server is not evidence that the same tool is installed or usable in ChatGPT Web or that a Work local task can access the same files.

## Evidence matrix

| Real surface | Version or identity | Date | Action | Observed response | MCP or Work | Permission prompt |
| --- | --- | --- | --- | --- | --- | --- |
| Codex desktop agent → connected **Mac Safe Files** server | Server reported `direct-macos`, first-party local Node structured tools, Node `v26.5.0`; transport reported outbound OpenAI Secure MCP Tunnel | 2026-10-21 | Read server policy and host information | Allowed root `/Users/USER`; canonical-path enforcement; UTF-8 text operations and bounded file sizes; no shell, GUI, browser, or network tools. Host reported macOS 15.7.9 build 24G830 on arm64. | MCP | None appeared in this Codex call. The server policy says the ChatGPT app should remain **Always ask**. |
| Codex desktop agent → connected **Mac Safe Files** server | Same connection | 2026-10-21 | Create the dedicated probe directory, write one 88-byte text file, read it, stat it, delete it, confirm the directory empty, and remove the owned empty directory | Read content matched exactly. SHA-256 was `01340a02d49f058ea4b91b79dfb8907737ca0888e2a8c2ee46d5af80d6af2ac3`; canonical file path was `/Users/USER/Desktop/ZoteroWithGPT/.dryforge/connection-probe/t1-roundtrip-20261021.txt`; stat reported 88 bytes and mtime `2026-10-21T07:54:23.166Z`. Delete succeeded; final directory listing was empty; directory removal succeeded. | MCP | None appeared. This proves the Codex-originated MCP round trip only. |
| Codex → plugin permission inspector | Installed app identity **Mac Safe Files** | 2026-10-21 | Read current app permission policy | Global default was `Allow low-risk actions`; the app-specific override was `Allow all actions`. | Neither Work nor the file MCP action; connector metadata read | None appeared because this was a read-only inspection. The observed override conflicts with the server policy requirement that ChatGPT remain **Always ask**. |
| Local macOS shell → installed Zotero application | Zotero 10.0.6, build ID `20261007113827`, Gecko compatibility 140.0–140.99.*; macOS 15.7.9 arm64 | 2026-10-21 | Read application metadata and list running processes | `/Applications/Zotero.app` reported bundle versions 10.0.6; the Zotero main process and plugin container were running. | Neither | None; read-only local inspection. |
| ChatGPT Work local task without Mac Safe Files | Not yet observed | 2026-10-21 | Use direct local file access to create, read, and report a dedicated `request.json` / `result.json` pair | **Pending. No Work-originated files or result exist in the evidence available to this task.** | Work | Unknown until the real run. |
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

## Required Work local test

The remaining T1 gate is a real user-started Work local task. Use this non-secret prompt verbatim:

> Use only direct local file access (no Mac MCP, no shell network, no Zotero writes). In `/Users/USER/Desktop/ZoteroWithGPT/.dryforge/work-connection-probe` create `request.json` containing `{"probe":"zotero-with-gpt-t1","date":"2026-10-21"}`; read it back; write `result.json` with the exact request object plus your execution surface and whether any permission prompt appeared; then read `result.json` and report both canonical paths and byte counts. Do not inspect other files or credentials. Leave both files for verification.

T1 can pass this gate only after the two files are inspected from the project host and the Work response records the real surface, action, observed result, and permission-prompt behavior. The run must use Work's direct local file capability without Mac Safe Files. If Work cannot create the files, record the exact error and prompt behavior; a Codex run or mock files do not replace this evidence.

OpenAI's [Work local security documentation](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security#files-and-device-access) explains that local tasks can access supported local files and authorized systems within the user's existing privileges and configured controls. It does not establish that this account has the capability, so the real run remains necessary. If it succeeds, the same dedicated request/result file convention is supported for the Work fallback. Until then, that compatibility is unverified.

