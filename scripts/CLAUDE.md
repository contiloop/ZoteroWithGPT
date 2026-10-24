# Packaging

Portable artifacts must not contain private roots, sessions, study history,
or account-generated metadata. Keep component versions and the reserved
no-service update URL aligned. Fixed metadata and allowlists make packages
reproducible; no native library action belongs in a package build.
Private configuration reads only the portable allowlist and the two account
manifests. Lifecycle removal must prove exact ownership before deleting.
