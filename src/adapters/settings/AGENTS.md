# Local connection settings

Owned preferences, directory picker, readiness display, enable/disable/reconnect. No library mutation, credential installation, or public endpoint configuration.

Directory selection alone must not enable processing. Require an existing dedicated absolute directory and make enabled/session state visible. Disable revokes runtime authority before cleanup. Failed or superseded starts must not report Ready. Removal owns only exact companion settings.

Test selection cancellation, missing directory, failed start/stop, repeat enable/disable, reconnect status, and lifecycle cleanup. Verify actual native picker and Plugins Manager behavior.
