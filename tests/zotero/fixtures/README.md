# Owned native fixture

This one-page PDF is original development test material. It contains a unique
sentence, an intentionally repeated sentence, a recurrence expression and an
ownership statement. It contains no user paper or personal information.

Run from the repository root:

```sh
node tests/zotero/fixtures/prepare-fixture.mjs
```

Import the reported RIS file through Zotero's ordinary File > Import interface,
using a separate collection and copying attachments into Zotero storage. The
script only creates a local import file; it does not modify Zotero. An existing
output is never overwritten. Pass another output filename if required.

The generated attachment URL refers to this checkout, so moving or reinstalling
the project does not require editing a retained developer path. The imported
marker note identifies test ownership. Discover the new item, attachment and note
keys through normal library reads; never reuse another installation's keys.

The fixture PDF SHA-256 is
`c2fbe4c5d2d2a372492278542b9aa4008dbf8407f8bc54335a3aaf30b990e336`.
Before mutation tests, verify the ownership marker and obtain explicit approval
for the isolated fixture. Keep real-environment results distinct from unit tests.
