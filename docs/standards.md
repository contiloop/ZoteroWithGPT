# Engineering constraints

- Keep the operation core independent of Zotero/Gecko/DOM implementations so
  another file transport cannot change save or retry semantics.
- Reachable operations need strict validation and distributed schema parity.
  Historical schema membership does not imply an executable capability.
- Annotation persistence must preserve the complete prepared body or reject;
  append limits apply after combining existing content and safety encoding.
- Previews derive from native comments and must not manufacture visibility
  evidence from a background reader or successful storage alone.
- Dependency changes need license review and matching bundled notices. Portable
  artifacts exclude private roots, account metadata, credentials, and history.
- Run affected tests after changes and `npm run verify` before presenting a
  package. Native persistence/display/lifecycle changes additionally need real
  Zotero evidence; Web and Work claims require their own observed route.
- Do not broaden a content-save check into whole-conversation archival. Test
  the requested behavior using owned fixtures without touching user papers.
