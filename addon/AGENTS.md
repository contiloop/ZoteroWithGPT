# Extension bootstrap

Host startup/shutdown bindings and manifest identity. Concrete operation dispatch belongs to plugin composition, not bootstrap.

Provide sandbox globals deliberately; do not expose evaluation, filesystem paths, or developer credentials as remote operations. Keep the exact manual-update sentinel and declared compatibility consistent with the package validator. Shutdown must release the scope that actually started, even after a later startup supersedes it.

Run bootstrap and package tests. Test start/stop failure and required sandbox globals; archive validity alone does not prove native installation.
