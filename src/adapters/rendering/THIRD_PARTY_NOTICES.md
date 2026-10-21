# Rendering third-party notices

The rendering adapter depends on these pinned packages:

| Package | Version | License used by this project | Upstream |
| --- | ---: | --- | --- |
| Markdown-it | 15.0.3 | MIT | <https://github.com/markdown-it/markdown-it> |
| KaTeX | 0.19.0 | MIT | <https://github.com/KaTeX/KaTeX> |
| DOMPurify | 3.4.17 | Apache License 2.0 | <https://github.com/cure53/DOMPurify> |

DOMPurify is dual-licensed under Apache-2.0 or MPL-2.0. This project selects Apache-2.0. The source
imports the packages as dependencies and does not copy their implementations. A release bundle that
contains their object code must also contain the corresponding complete upstream license texts and
copyright notices. The npm packages pinned by the lockfile contain those canonical `LICENSE` files;
release packaging must carry them into the distributed artifact.

The architecture was informed by the MIT-licensed
[`qrkks/zotero-annotation-markdown` v0.15.4 source](https://github.com/qrkks/zotero-annotation-markdown/tree/f899572eae3214df5096ca5356803b4e1872ee4c).
No source was copied. Later releases of that project are AGPL-3.0-or-later and are not dependencies or
source baselines for this adapter.
