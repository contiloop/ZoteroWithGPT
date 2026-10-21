# Protocol validation

Versioned request/result shapes, byte limits, canonicalization, and strict validators. No native calls, file publication, or UI authority inference.

Reject unknown fields and non-JSON/nonfinite values. Measure UTF-8 bytes rather than JavaScript character count. Keep reads free of mutation authorization and require a scoped record for writes. Canonical object keys are sorted; array order remains significant. IDs become filenames only after validation.

Cover malformed and unknown input, exact bounds, multibyte content, operation catalog parity, canonical digests, and published schemas/examples.
