<a id="readme-top"></a>

<div align="center">
  <h1>Zotero</h1>
  <p>Study together in ChatGPT. Keep what matters beside the paper.</p>
  <p>
    <a href="docs/install.md"><strong>Explore the installation guide »</strong></a>
  </p>
  <p>
    <a href="#usage">Usage</a> ·
    <a href="https://github.com/contiloop/ZoteroWithGPT/issues/new">Report a bug</a> ·
    <a href="https://github.com/contiloop/ZoteroWithGPT/issues/new">Request a feature</a>
  </p>
</div>

[![Stars][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#about-the-project">About the project</a></li>
    <li><a href="#getting-started">Getting started</a>
      <ul>
        <li><a href="#requirements">Requirements</a></li>
        <li><a href="#installation-and-setup">Installation and setup</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#how-it-works">How it works</a></li>
    <li><a href="#development-and-tests">Development and tests</a></li>
    <li><a href="#licensing">Licensing</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About the project

Study a paper with ChatGPT, then save the parts you want to remember as
highlights and comments beside the relevant passage in your local Zotero PDF.

Ask questions, work through equations, and discuss the paper first. When you
say “highlight this and save your explanation,” Zotero receives the requested
passage-linked annotation. Studying alone never triggers a save.

This self-hosted project has been validated on the maintainer's macOS and
ChatGPT setup. Account setup is manual; see [validation status](docs/tracking/status.md)
for tested behavior and remaining limitations.

### Features

- Read and discuss a PDF you have already saved in Zotero.
- Save requested explanations, questions, proofs, and references beside a passage.
- Choose a highlight color yourself, or let ChatGPT apply the study convention below.
- Keep long explanations attached to their passage instead of moving them to
  an unrelated note. Separate notes require an explicit request.

## Getting started

### Requirements

| Component | Required environment or access |
| --- | --- |
| Operating system | macOS; Windows and Linux are not validated |
| Zotero | 10.0.6–10.0.x |
| Node.js | 24–26 |
| npm | 11.4.2 |
| ChatGPT account | Access to custom MCP apps and the plugin setup used by this project |
| Secure MCP Tunnel | Access to create/use a dedicated tunnel and its runtime credential |
| Tunnel client | The pinned 0.0.14 build in the [installation guide](docs/install.md) |

Confirm account eligibility before installing. ChatGPT Work is not a validated
host for this setup.

### Installation and setup

#### 1. Build the packages

```sh
git clone https://github.com/contiloop/ZoteroWithGPT.git
cd ZoteroWithGPT
npm ci
npm ci --prefix integration/zotero-mcp --ignore-scripts
npm run verify
```

`npm run verify` builds, tests, packages, and validates the artifacts.
`npm run package` rebuilds packages when dependencies are already installed.
Generated files are placed in `artifacts/`:

| Artifact | Purpose |
| --- | --- |
| `zotero-ai-research-companion-<version>.xpi` | Install in Zotero |
| `zotero-mcp-server-<version>.zip` | Install the local MCP server and lifecycle tools |
| `zotero-study-save-<version>.zip` | Portable ChatGPT plugin, initially unconfigured |
| `zotero-ai-research-companion-<version>-client/` | Optional generic-file client fallback |

The historical `zotero-study-save` package identifier is retained; its display
name is **Zotero**. Account plugin releases can have a different version from
the server/extension packages.

#### 2. Connect Zotero and ChatGPT

Follow [Install on macOS](docs/install.md) to:

1. Install the XPI in Zotero and enable its dedicated bridge directory.
2. Install the local MCP server and configure the dedicated tunnel.
3. Register your MCP app as **Zotero Local** in ChatGPT.
4. Configure and install the **Zotero** plugin with that app binding.

The current private configuration
helper expects an existing owned plugin's exported manifests; first-time
account onboarding is not yet automated. The portable ZIP contains no working
account binding or credentials. Never distribute a configured private ZIP,
credential file, bridge history, or operation journal.

[Remove or reinstall](docs/uninstall.md) ·
[Troubleshooting](docs/troubleshooting.md)

## Usage

1. Save the paper and its PDF in Zotero. Keep your Mac and Zotero running while using the connection.
2. After completing setup, select **Zotero** in ChatGPT.
3. Provide the paper's arXiv link and ask to study a section.
4. Ask follow-up questions in the same conversation.
5. Request a save, for example:

   > Highlight that definition and attach the explanation you just gave, verbatim.

The established paper can be reused within the accessible conversation. If the
paper or passage is ambiguous, ChatGPT asks for the missing information.

### Example conversation

A typical flow for a paper already saved in Zotero:

| Step | Your request | What happens |
| --- | --- | --- |
| Study | “Read the abstract of https://arxiv.org/abs/1607.06450 with me. What is the central idea?” | ChatGPT reads the local PDF and explains the idea. |
| Discuss | “Why does it compute statistics within a single training example?” | Continue studying in the same conversation. |
| Save | “Highlight that key definition and attach your explanation verbatim.” | ChatGPT locates the passage and requests a native highlight with the explanation attached. |

Once storage is confirmed, open the returned Zotero link to review the
highlight and its comment. A definition uses yellow by default; you can request
another color. If the target or save outcome is unresolved, the response reports
that instead of claiming success.

### Highlight colors

These are study conventions, not meanings prescribed by Zotero. Explicit user
colors take priority. For a requested new highlight without a color, ChatGPT
selects one based on the passage's role and passes its hex value to the tool.
This is model guidance, not a deterministic classifier; existing highlights
are not automatically recolored.

| Color | Hex | Purpose |
| --- | --- | --- |
| Yellow | `#FFD400` | Core concepts and definitions |
| Red | `#FF6666` | Important problems and limitations |
| Green | `#5FB236` | Research results and advantages |
| Blue | `#2EA8E5` | Methods and equations |
| Purple | `#A28AE5` | Concepts to study further |
| Pink | `#E56EEE` | Striking claims and insights |
| Orange | `#F19837` | Key experiments and supporting evidence |
| Gray | `#AAAAAA` | Supporting explanations and references |

<p align="right"><a href="#readme-top">Back to top</a></p>

## How it works

```text
ChatGPT: Zotero plugin (study and save instructions)
    ↓ typed tool calls
Zotero Local (your connected MCP app)
    ↓ dedicated Secure MCP tunnel
Local Node.js MCP server
    ↓ local request/result files
Zotero extension → native highlights and comments
```

The plugin has one skill, `skills/zotero/`. Its `SKILL.md` loads
`resources/workflow.md`, which describes paper selection, requested saves,
color selection, and result checking. ChatGPT interprets these instructions;
the MCP server handles transport and validation. The native Zotero extension
owns persistence and operation history.

## Development and tests

```text
addon/                    Zotero extension manifest and assets
src/                      Protocol, core logic, and native adapters
integration/chatgpt-plugin/ ChatGPT skill and portable plugin source
integration/zotero-mcp/    MCP server and its tests
scripts/                  Build, packaging, and verification tools
tests/                    Extension and integration tests with owned fixtures
docs/                     Installation, architecture, protocol, and evidence
```

Tests belong in the public source repository so contributors can reproduce
checks. The installable XPI, plugin ZIP, and MCP server ZIP exclude test suites
and private acceptance evidence. Tests also live beside the MCP and plugin
modules, so the root `tests/` directory is not the entire suite.

Run `npm run verify` before proposing a change. Automated tests do not replace
real ChatGPT/Zotero checks for changes to native saving or reader behavior.
Do not commit personal papers, credentials, runtime configuration, or study
history. Local artifacts and private validation directories are ignored by Git.

[Architecture](docs/architecture.md) · [Study rules](docs/business-rules.md) ·
[Protocol](docs/protocol/v1.md) · [Host notes](docs/engineering-notes.md)

## Licensing

A project-wide license has not yet been selected. Public repository visibility
alone does not grant an open-source license. Third-party dependency notices are
provided in `THIRD_PARTY_NOTICES/` and the generated packages.

## Acknowledgments

README layout adapted from
[Best-README-Template](https://github.com/othneildrew/Best-README-Template).
Badges are provided by [Shields.io](https://shields.io/).

<p align="right"><a href="#readme-top">Back to top</a></p>

[stars-shield]: https://img.shields.io/github/stars/contiloop/ZoteroWithGPT?style=for-the-badge
[stars-url]: https://github.com/contiloop/ZoteroWithGPT/stargazers
[issues-shield]: https://img.shields.io/github/issues/contiloop/ZoteroWithGPT?style=for-the-badge
[issues-url]: https://github.com/contiloop/ZoteroWithGPT/issues
