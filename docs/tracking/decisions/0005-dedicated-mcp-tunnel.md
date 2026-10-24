# Dedicated MCP and tunnel

The selected ChatGPT workflow needs typed tools without exposing generic local
filesystem access or coupling account routing to the native Zotero executor.
Use one dedicated stdio MCP adapter with fourteen fixed contracts over the
existing protocol-v1 bridge port. Keep Zotero as the sole native writer and
journal owner.

A shared tool registry would make unrelated tools and credentials part of this
workflow's trust and release surface. Extending the generic file workflow would
also duplicate descriptor/session policy in model instructions. The dedicated
adapter centralizes that policy in replaceable code, while the source-only
generic workflow remains available as a separately configured fallback.

Run the adapter through its own existing private tunnel ID, fixed local
alias/profile, protected credential reference, and fenced install root. Do not
modify the older shared runtime, catalog, plugin backend, or credentials. This
separation costs another managed local process and private account binding, but
it gives removal, rollback, status, packaging, and disclosure boundaries that
can be verified without affecting unrelated tools.

The account plugin stays unconfigured in portable source. Private configuration
adds a verified app ID while preserving account presentation. Public hosting,
authenticated multi-user/profile routing, and end-user installation remain
future distribution work rather than implied properties of the private route.
