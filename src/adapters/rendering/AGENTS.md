# Safe study rendering

Bounded Markdown/LaTeX-to-sanitized-HTML conversion and readable fallback. No native persistence, automatic link opening, or reader selection.

Treat all source as untrusted. Disable executable/raw resource markup and remote loads. Validate element-specific MathML semantics and safe reference destinations. Preserve unsupported or over-budget source readably instead of dropping it. Styles affect owned preview nodes only.

Cover malicious HTML/URLs, malformed delimiters, pathological math at body limits, Unicode, lists, cancellation and alignment semantics, safe link clicks, and fallback without formatting.
