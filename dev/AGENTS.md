# Sensitive Configuration

- Never commit secrets or production/deployment identifiers to tracked `dev/` files (keys, tokens, passwords, private keys, webhooks, real domains/IPs, addresses, or peer names).
- Load required runtime values only from ignored local config or environment; fail closed when absent. Keep credential contents outside the repository with restrictive permissions; paths may be documented.
- Templates, tests, and docs use redacted placeholders only (`example.invalid`, RFC 5737 IPs, placeholder UUIDs/names), never production values.
