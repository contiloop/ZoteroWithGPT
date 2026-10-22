# Open limitations

## Independent Work execution

A direct Codex local-file client has completed the native study flow, but a distinct ChatGPT Work task has not been run. This matters only when offering Work as a tested replacement for Mac MCP. Account/tool availability and real local permissions cannot be established from Codex evidence. Validate on an actual user-started Work surface before advertising parity or usage behavior.

## Public Mac connection setup

The existing authenticated Mac Safe Files connection works for the validation user. Its public installer and supported distribution runbook are not available in this repository. A new user's end-to-end setup therefore cannot yet be promised from the XPI alone. Resolve with the connection owner or evaluate a separately approved transport; do not distribute private tunnel state.

## Same-user filesystem race

Gecko IOUtils does not expose a no-follow directory-handle read. A same-user attacker could replace a checked path before its open despite pre/post checks. This affects deployments that share the bridge with untrusted local processes. The current private-directory trust model excludes those attackers; stronger isolation requires another host filesystem primitive or process boundary, not a claim that the checks eliminate the race.

## Public distribution decision

Bundled dependencies have evaluated notices, but the project's own license and publication channel have not been selected. Public publication needs that decision and authorization. Local packaging and installation are available without asserting a public redistribution license.

## arXiv metadata verification deferred

The actual Zotero 10.0.6 metadata request to the fixed arXiv Atom endpoint returned HTTP 429 in the 2026-10-22 preflight. The bounded read-only PDF request succeeded, but that does not prove concrete-version metadata retrieval. The user explicitly approved continuing implementation with this external verification deferred. Respect request limits; do not silently substitute HTML metadata or another transport. Real metadata and end-to-end native/Web acceptance remain completion requirements. See [the preflight record](../plugin-connection-validation.md).
