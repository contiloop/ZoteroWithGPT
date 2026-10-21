# Native persistence through a local file bridge

## Context

The researcher studies in ChatGPT Web and already has a file-only Mac connection. That connection cannot invoke shell commands or Zotero APIs. The saved research process must remain usable in Zotero after uninstall, and other users need a removable installable component.

## Decision

Use a Zotero XPI to perform native application operations. A dedicated, explicitly enabled request/result directory connects authenticated file clients to the same typed operation core. Keep study content in native annotations and optional notes; retain a separate private operation journal for replay protection.

## Alternatives

A direct remote MCP endpoint would require another connection deployment and verified Web write eligibility. A separate local runner would add installation and process management. Direct database edits bypass Zotero consistency and ownership; PDF flattening loses editable native comment behavior. These approaches do not fit the current file-only transport and removal requirements.

## Consequences

Zotero must run for processing, clients must follow session freshness and atomic publication, and there is no transparent automatic handoff between Web and local clients. The directory writer is trusted; authorization metadata cannot independently authenticate a human. Removing temporary files cannot remove historical deduplication state.
