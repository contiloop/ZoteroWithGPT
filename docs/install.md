# Install on macOS

Requires Zotero 10.0.6–10.0.x and an existing authorized Mac Safe Files
connection. No model API key is needed. Obtain matching versions of:

- `zotero-ai-research-companion-<version>.xpi`
- `zotero-ai-research-companion-<version>-client/`
- `zotero-study-save-<version>.zip`

## Zotero

1. **Tools → Plugins → gear → Install Plugin From File…**: select the XPI.
2. Create a dedicated directory outside Zotero's data directory. Anyone allowed
   to write there can request library actions, so do not share it or select a
   broad directory such as Desktop or home.
3. Copy the client folder contents into `<BRIDGE_ROOT>/client-v1`; confirm
   `<BRIDGE_ROOT>/client-v1/README.md` exists.
4. **Tools → Research Companion Settings… → Choose Directory…**: select the
   root, not `client-v1`. Choose **Enable** and require **Ready**.

Keep Zotero running for request processing. Disable before changing roots.
The client discovers current session paths; never copy old pending requests.

## ChatGPT

1. Install the portable ZIP as a private personal plugin, retaining Mac Safe
   Files. Allow only the dedicated root through its normal permission flow.
2. In the personal instance, set
   `skills/zotero-study-save/resources/personal-config.json` → `bridgeRoot` to
   Zotero's displayed root. Distributed source keeps this value `null`.
3. Save your paper and PDF in Zotero. In ChatGPT select **Zotero Study Save**,
   give its arXiv link, and ask to study it. Later request the desired highlight
   or comment; the link need not be repeated in that conversation.

A missing paper/PDF requires manual saving or restoration in Zotero. Selection
and study are read-only; only a requested save writes annotations.

Update all components together. The reserved `.invalid` update URL supplies no
automatic updater. For removal/reinstall ordering see [uninstall](uninstall.md).
Direct local-file clients can use the same kit, but ChatGPT Work access is not
verified. Public Mac Safe Files installation is outside this repository.
