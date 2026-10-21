# Release packaging

Deterministic extension/client-kit build and package policy validation. No personal host state or native library testing belongs in packaging scripts.

Use explicit file allowlists and fixed archive metadata. Package matching client/protocol instructions, licenses, and compatibility metadata. Reject credentials, developer home paths, arbitrary update hosts, and mismatched versions. Package the exact reserved no-service update URL for manual distribution.

Run package build/validation tests, inspect both artifacts, and compare a clean dependency install/build hash against the installed artifact. Keep generated outputs out of source commits.
