# Personal ChatGPT plugin connection preflight

Validated on 2026-10-22 against the authenticated personal ChatGPT Web account and the actual macOS Zotero 10.0.6 host. This preflight is **blocked**: the account supports private plugin creation, installation, update, dependency binding, and private per-instance configuration, and the Zotero host passed the bounded native item, attachment, abstract-page, and PDF checks, but the required fixed arXiv API metadata request failed in the Zotero process. Its detailed network cause was not established.

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

## Installation cleanup

The reviewed diagnostic was installed through Zotero **Tools → Plugins → Install Plugin From File**. After the result was written, Zotero's Plugins Manager showed **T1 Zotero Native Read-Only Probe 0.0.1** enabled beside the unchanged production **Zotero AI Research Companion 0.1.0**. The diagnostic was removed through its normal **More Options → Remove** flow. The UI reported `T1 Zotero Native Read-Only Probe has been removed.` A normal restart completed removal of its profile XPI. The production extension remained installed, and the temporary diagnostic no longer appeared in the profile.

No Zotero library mutation, PDF-byte change, user-paper import, third-party installation, public plugin publication, credential change, shared connection change, or production source change was performed.

## Verification record

All commands below ran from the repository root unless stated otherwise.

| Command or observation | Result |
| --- | --- |
| `pwd` and `git branch --show-current` | Exit 0; expected repository and `codex/conversational-save-arxiv`. |
| `node --check .local/validation/t1-native-probe/bootstrap.js` | Exit 0. |
| `python3 -m json.tool .local/validation/t1-native-probe/manifest.json` | Exit 0. |
| Mutation-call `rg` over the diagnostic source | Exit 1 with no matches, the expected no-match result. |
| `zip -X -FS t1-native-probe.xpi manifest.json bootstrap.js README.md` | Exit 0; archive contained exactly those three reviewed files. |
| `python3 -m json.tool .local/validation/t1-native-probe/result.json` | Exit 0; values recorded in the table above. |
| `unzip -t .local/validation/chatgpt-plugin-download/zotero-save-flow-probe-t1-v0.1.1.zip` | Exit 0; no archive errors. |
| Private resource sanitized inspection | Exit 0; `bridgeRoot` was the only key and matched the selected private root without printing it. |
| Portable-skill sanitized inspection | Exit 0; selected private path absent; private resource, Mac Safe Files, fresh session/profile discovery, and no-write rules present. |
| Post-restart absence check for the diagnostic profile XPI | Exit 0. |
| Post-restart presence check for the production profile XPI | Exit 0. |

## Blocking decision

The personal ChatGPT plugin lifecycle and one-time private configuration mechanism are feasible in this account. Native Zotero item and attachment reads, the requested versioned abstract-page route, and bounded PDF retrieval are also feasible on this host. The HTML substring check did not independently prove the response metadata version.

The fixed arXiv API metadata endpoint is not yet feasible evidence: its Zotero-host request failed with an unresolved cause. Production work must not treat the abstract HTML or an operating-system request as a silent replacement. Resolve the required metadata source or the host access failure before approving this preflight. Independently, T7 must still prove implicit activation and the normal save behavior in a fresh ordinary Web chat.
