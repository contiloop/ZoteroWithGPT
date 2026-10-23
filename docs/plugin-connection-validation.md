# Personal ChatGPT plugin connection preflight

Validated on 2026-10-22 against the authenticated personal ChatGPT Web account and the actual macOS Zotero 10.0.6 host. This preflight is **blocked**: the account supports private plugin creation, installation, update, dependency binding, and private per-instance configuration, and the Zotero host passed the bounded native item, attachment, abstract-page, and PDF checks, but the required fixed arXiv API metadata request returned HTTP 429 in the Zotero process. The single authorized request did not supply the required concrete source, title, authors, dates, and abstract metadata.

This is account and host evidence. Local Codex installation, plugin-directory discovery, source inspection, and operating-system HTTP results were not treated as substitutes for the observed ChatGPT Web and Zotero behavior.

## Supported product surfaces reviewed

The implementation assumptions were checked against the current official references:

- [Build plugins](https://learn.chatgpt.com/docs/build-plugins)
- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Developer plugin build guide](https://developers.openai.com/plugins/build/plugins)

The authenticated Web account then supplied the authoritative account-specific result. Its Plugins screen showed **Public** and **Personal** tabs, **Manage**, and **Add**. The Add menu exposed **Create plugin**, **Upload plugin archive**, and **Add custom MCP server**. Discovering Plugin Creator was not counted as installation: the official OpenAI Plugin Creator initially appeared as available but not installed. Installing it through the normal UI produced the explicit `Plugin Creator plugin installed` result and exposed its create, submission-preparation, and update skills.

## Private plugin creation and update

Plugin Creator created **Zotero Save Flow Probe T1** as a private personal plugin. The plugin detail surface showed **Your cloud plugin**, version `0.1.1`, one app, one skill, **Manage**, and **Try in chat**. Manage showed the plugin enabled. The sole app dependency was **Mac Safe Files**, and the account UI reported it as **Connected**.

The normal owned-plugin action menu exposed all of the required lifecycle paths:

- **Edit plugin**
- **Download plugin ZIP**
- **Upload new version**
- **Uninstall**
- **Delete plugin**

The initial path-free private plugin was updated through **Edit plugin**. Plugin Creator reported `Updated Zotero Save Flow Probe T1 to v0.1.1 and verified by read-back.` This establishes the supported personal create/install/update route for this account. It does not establish production behavior in a later ordinary chat.

### Downloaded artifact inspection

The configured private `0.1.1` plugin was downloaded through **Download plugin ZIP** and retained only under ignored private validation storage. Its SHA-256 was `fae01044c3c4ed9583bfac064f3c96f1997a882ccbd13339771f2e0024202e66`; `unzip -t` exited 0. The archive contained six files: the two plugin manifests, `.app.json`, one skill, its agent policy, and one private-instance resource.

Direct archive inspection established the following:

- `.app.json` declares exactly one app dependency, Mac Safe Files.
- `references/private-instance.json` contains exactly one key, `bridgeRoot`; it was non-empty and matched the directory selected for this private instance. No other non-null private setting was present.
- The reusable skill text contains no selected personal path. It defines `bridgeRoot: null` for a reusable template and requires resetting the field to null before template export or reuse.
- The skill rereads session and profile state below the configured root for each relevant request. It forbids bridge writes and Zotero mutations and states that reading or studying never writes.
- The agent policy contains `allow_implicit_invocation: true`.

The downloaded configured archive is a private artifact because its private-instance resource contains the selected root. It must not be redistributed as the portable package. Portability requires the documented null reset; the reusable skill and manifests themselves did not contain the selected path.

## Per-instance setup and dependency boundary

The one-time setup mechanism is an owned private plugin resource, not a per-chat prompt, custom GPT, project instruction, or manual connection step. The only persisted value is `bridgeRoot`. Session identifiers, profile identifiers, file contents, credentials, and library selections remain runtime data and are rediscovered beneath that root.

Mac Safe Files policy inspection reported a first-party structured local-file connection with a home-scoped allowlist and protected configuration and tunnel trees. It exposes no shell, GUI, browser, remote-access, or network capability. The private probe further restricts itself to policy status and file stat/list/read operations; it never calls its write, move, directory-create, or permanent-delete operations. No shared Mac connection policy, authentication, tunnel configuration, or unrelated integration was changed.

## Activation boundary

The installed artifact is configured as eligible for implicit invocation in ordinary Chat, and its instructions do not require an `@` mention, a switch to Codex, a pasted root, or a manual connect prompt after onboarding. Configuration eligibility is not proof that host selection will invoke it.

Fresh ordinary-chat implicit activation and the production save workflow remain unverified here. They require the later T7 end-to-end observation. This preflight does not claim that a new conversation automatically invokes the plugin or completes a save.

## Actual Zotero host probe

A temporary extension-owned diagnostic was reviewed before installation. Package SHA-256 was `de01a4c3b3bbe7967e245d2a5b835ced005f6e293959f8fbd2b2c806a39105a8`. It accepted no runtime input and exposed no generic evaluator or HTTP command. It contained no item construction, import, save, erase, field-setting, relation, note, annotation, or PDF mutation call.

The diagnostic used `Zotero.Items.getByLibraryAndKeyAsync` only to read the deliberately owned fixture. It observed the presence, without invocation, of the `Zotero.Item` constructor and `Zotero.Attachments.importFromFile`. Its network code used the host's `Zotero.HTTP.request` with `followRedirects: false`; Zotero 10.0.6's bundled HTTP implementation documents that option, installs its no-follow redirect handler, and treats a stopped redirect as an observable response.

The fixed network scope was limited to these concrete-version resources:

- `https://arxiv.org/abs/1706.03762v7`
- `https://export.arxiv.org/api/query?id_list=1706.03762v7`
- `https://arxiv.org/pdf/1706.03762v7.pdf`

Every request required HTTPS, an exact host and path/query allowlist, at most two redirects, a 10-second request timeout, and a 30-second overall deadline. Metadata responses were capped at 262,144 bytes and the PDF at 3,000,000 bytes. Deadline and shutdown flags prevented a later request from starting, and the active request received cancellation on deadline or shutdown.

The actual private result was:

| Check | Actual result | Interpretation |
| --- | --- | --- |
| Zotero version | `10.0.6` | Expected host version observed. |
| Native API presence | Passed | Item lookup/read APIs, HTTP request, item constructor, and attachment import API were present; constructor and import were not invoked. |
| Owned parent item | Passed | Found, regular, not deleted. |
| Owned PDF attachment | Passed | Found, `application/pdf`, not deleted, with both parent-to-child and child-to-parent relationships confirmed. No file path or paper content was recorded. |
| Concrete-version abstract HTML | Passed | HTTP 200, `text/html`, 44,244 bytes. The title and versionless article ID appeared in the body, and the requested URL named v7; the response metadata did not independently establish the concrete version. |
| Fixed arXiv API metadata query | **Failed** | `get_request_failed`; no status or more specific cause was available in the retained result or focused existing logs. No retry, alternate endpoint, or operating-system result was substituted. |
| Concrete-version PDF retrieval | Passed | HTTP 200, `application/pdf`, 2,215,244 bytes after one observed redirect, within the declared cap. The first five bytes matched `%PDF-`. This is bounded retrieval and a PDF signature check, not proof of full PDF parsing. |
| Overall probe | **Failed** | One required check failed. The result remained failed rather than being widened from the partial successes. |

The result is stored at `.local/validation/t1-native-probe/result.json`. An operating-system HTTP preflight was used only to size the diagnostic limits; it is not evidence that Zotero could reach the same endpoint.

### Fixed API diagnostic repair

The first API observation was insufficient to distinguish a timeout from another transport or HTTP failure. That probe imposed a 10-second request limit and replaced the original exception with `get_request_failed`. The result therefore remains valid only as evidence that the first request failed; it is not used to classify why.

A second reviewed diagnostic repaired only that evidence gap. Its package SHA-256 was `83d07b49696b8a7bf18708e7ecbf40e5a1b1c3d45dc1943240a3ac91d5209635`. It contained one request call for exactly this URL and no HTML, PDF, item, attachment, alternate endpoint, loop, runtime input, or mutation path:

`https://export.arxiv.org/api/query?id_list=1706.03762v7`

The repaired diagnostic used a 60-second request timeout, a 65-second overall deadline measured from diagnostic start, and a 2 MiB response cap. It disabled redirect following and automatic 429/5xx retry through `followRedirects: false`, `successCodes: [200]`, `errorDelayMax: 0`, and `noRetryOnThrottle: true`. A durable `running` result written before the request prevented extension reload or Zotero restart from issuing another attempt. The parser rejected `DOCTYPE` and `ENTITY` declarations before XML parsing.

Zotero 10.0.6's bundled HTTP implementation was checked before the run. It applies the supplied request timeout to the native request, raises `TimeoutException` from its timeout handler, exposes the response status on `UnexpectedStatusException`, implements no-follow redirects, and treats `errorDelayMax: 0` as disabling server-error retry. The result retained only the failure stage, a bounded native exception class name, an integer status when available, and a timeout boolean. It did not retain an exception message, headers, credentials, stack, or response body.

The one authorized execution produced:

| Field | Actual result |
| --- | --- |
| Request attempts | `1` |
| Duration | `15,733 ms` |
| Observed response bytes | `14` |
| Failure stage | `http_response` |
| Exception class | `UnexpectedStatusException` |
| HTTP status | `429` |
| Timed out | `false` |
| Atom entry | Not obtained or parsed |

The repaired result is stored at `.local/validation/t1-native-probe/result-api-repair.json`. HTTP 429 is a specific Zotero-host rate-limit response, so this run is no longer an unexplained timeout or transport failure. The diagnostic did not retain the response body or headers and therefore does not infer the server's more specific reason for returning 429. Per the one-attempt boundary, it was not retried and no alternate endpoint or HTML substitute was used.

## Installation cleanup

The reviewed diagnostics were installed through Zotero **Tools → Plugins → Install Plugin From File**. After the first result was written, Zotero's Plugins Manager showed **T1 Zotero Native Read-Only Probe 0.0.1** enabled beside the unchanged production **Zotero AI Research Companion 0.1.0**. The first diagnostic was removed through its normal **More Options → Remove** flow, and a normal restart completed removal of its profile XPI.

The repaired diagnostic appeared as **T1 arXiv API Read-Only Probe 0.0.2**. After the single result was written, it was removed through the same normal UI flow. The confirmation surface reported `T1 arXiv API Read-Only Probe has been removed.` A normal restart completed removal of the diagnostic profile XPI. The production extension remained installed and enabled; the diagnostic XPI was absent from the profile after restart.

No Zotero library mutation, PDF-byte change, user-paper import, third-party installation, public plugin publication, credential change, shared connection change, or production source change was performed.

## Verification record

All commands below ran from the repository root unless stated otherwise.

| Command or observation | Result |
| --- | --- |
| `pwd` and `git branch --show-current` | Exit 0; expected repository and `codex/conversational-save-arxiv`. |
| `node --check .local/validation/t1-native-probe/bootstrap.js` | Exit 0. |
| `python3 -m json.tool .local/validation/t1-native-probe/manifest.json` | Exit 0. |
| Mutation-call `rg` over the diagnostic source | Exit 1 with no matches, the expected no-match result. |
| `(cd .local/validation/t1-native-probe && zip -X -FS t1-arxiv-api-probe-v2.xpi manifest.json bootstrap.js README.md)` | Exit 0; archive contained exactly those three reviewed files and had SHA-256 `83d07b49696b8a7bf18708e7ecbf40e5a1b1c3d45dc1943240a3ac91d5209635`. |
| `rg -c "Zotero\\.HTTP\\.request" .local/validation/t1-native-probe/bootstrap.js` | Exit 0; count `1`. |
| `python3 -m json.tool .local/validation/t1-native-probe/result.json` | Exit 0; values recorded in the table above. |
| `python3 -m json.tool .local/validation/t1-native-probe/result-api-repair.json` | Exit 0; one attempt ended with HTTP 429 after 15,733 ms and did not time out. |
| `unzip -t .local/validation/chatgpt-plugin-download/zotero-save-flow-probe-t1-v0.1.1.zip` | Exit 0; no archive errors. |
| Private resource sanitized inspection | Exit 0; `bridgeRoot` was the only key and matched the selected private root without printing it. |
| Portable-skill sanitized inspection | Exit 0; selected private path absent; private resource, Mac Safe Files, fresh session/profile discovery, and no-write rules present. |
| Post-restart absence check for the diagnostic profile XPI | Exit 0. |
| Post-restart presence check for the production profile XPI | Exit 0. |

## Blocking decision

The personal ChatGPT plugin lifecycle and one-time private configuration mechanism are feasible in this account. Native Zotero item and attachment reads, the requested versioned abstract-page route, and bounded PDF retrieval are also feasible on this host. The HTML substring check did not independently prove the response metadata version.

The fixed arXiv API metadata endpoint did not provide the required metadata in the one authorized Zotero-host attempt. It returned HTTP 429 before a valid Atom entry could establish the concrete source, title, authors, publication and update dates, and abstract. T1 therefore remains blocked. Production work must not treat the abstract HTML or an operating-system request as a silent replacement, and this diagnostic must not be rerun without a separate decision about the endpoint or access condition. A user decision is pending on whether to keep implementation waiting for real endpoint validation or explicitly defer this gate while allowing implementation to continue without treating T1 as passed. Independently, T7 must still prove implicit activation and the normal save behavior in a fresh ordinary Web chat.

## User-approved verification deferral

On 2026-10-22, after the HTTP 429 observation was reported, the user explicitly approved continuing implementation while deferring the remaining metadata preflight. This changes the order of verification, not its success criterion. T1 metadata remains unverified. Real concrete-version metadata retrieval and production native/Web acceptance remain mandatory before completion. No request-limit bypass, HTML substitution, or public-source success inferred from test doubles is authorized.

## Production plugin follow-up — 2026-10-22–23

This follow-up preserves the preflight and deferral above as historical evidence. Later production Zotero requests obtained matching concrete-version Atom entries for `1706.03762v7`, `1607.06450v1`, and `1512.03385v1`; metadata access is therefore no longer deferred. The earlier HTTP 429 is not reclassified, and no cause is inferred for it.

### Private production installation

The authenticated account created one owned private **Zotero Study Save** plugin and updated that same identity through version 0.2.2. The current portable source is `zotero-study-save-0.2.2.zip`, SHA-256 `eecff4f37bb97367261146754ab7e1360a4ea77c83002ffc9122e4312bae58c3`. Account readback reported personal/private scope, version 0.2.2, the one Zotero study-save skill enabled, and Mac Safe Files connected. The earlier read-only probe remained disabled so it did not compete for activation.

The portable ZIP has 25 files. Account export has one additional platform-generated `.codex-plugin/plugin.json` compatibility manifest and normalized account author/interface metadata. That generated file explains the 26-file account copy. Sanitized path and content comparison found the skill, agent policy, workflow, client resources, schemas, examples, and app dependency unchanged. The only personal workflow setting was the non-null `bridgeRoot` in `personal-config.json`; the portable source kept it null. No profile ID, session ID, pending request, result, credential, study text, or additional executable instruction was added to the portable package.

Source/readback also confirmed `allow_implicit_invocation: true`, no product restriction, and the expected Mac Safe Files application dependency. These declarations establish eligibility and source integrity, not successful selection in a fresh ordinary conversation.

### Actual activation observations

One initial ordinary 0.2.0 conversation selected the production plugin from natural Korean save wording without a path, manual connection step, or plugin mention. It completed connection status and arXiv inspection before the native import ended as the preserved historical unknown described in the acceptance record. This shows that implicit selection occurred once; it is not a successful end-to-end save.

Two fresh ordinary 0.2.1 conversations later returned no available Zotero integration and produced no bridge request. After the exact 0.2.2 account/source readback and a complete Zotero remove/restart/install/restart lifecycle, one bounded fresh ordinary 0.2.2 conversation behaved the same way. Its study-only turn caused no write, and its natural save request dispatched no plugin tool or bridge file. Management still showed the production skill enabled and Mac Safe Files connected. No description, cache, permission, or reinstall cause has been established from the available evidence.

One explicit-selection diagnostic separated tool binding from automatic selection. **Try in chat** displayed a **Zotero Study Save** selection chip. The submitted instruction requested `connection_status` only and explicitly forbade lookup, import, creation, or update. ChatGPT used Mac Safe Files and created exactly one request/result pair: `connection_status`, empty payload, no authorization field, succeeded, plugin 0.2.2, Zotero 10.0.6, enabled, 14 operations. No native record changed. This is positive evidence for installed-plugin binding and dependency access, but explicit selection cannot be counted as the required ordinary-chat flow.

### Current connection conclusion

Private plugin creation, versioned update, source integrity, private root configuration, Mac Safe Files connection, explicit selection, and a real status request all pass on this account. Ordinary implicit selection remains inconsistent and the final 0.2.2 natural save attempt failed before tool dispatch. The two required successful ordinary-Web study/save conversations remain unmet. A mandatory mention, pasted path, manual connection prompt, direct local client, or status-only diagnostic must not be substituted for that product criterion.
