# db-sync

Two-way SQLite sync with snapshots and conflict resolution.

```sh
db-sync [options] <local-db> <remote>
```

`remote` is `host:path` or another local file.

## Snapshots

After you confirm the write (not on abort or `--dry-run`), both sides write `snapshots/<stem>-<millis>.db` next to the live database (`VACUUM INTO`). Newest `--retention` files are kept (default 5). A `<stem>-latest.db` symlink points at the newest copy.

Compare still uses a temporary copy taken at start. Apply uses that reviewed copy. The snapshot is the rollback point at confirm time. A remote write with `--remote-unit` snapshots after the unit stops.

## Conflict modes

1. Interactive (TTY default): arrow / `j` `k` to move, Enter to select, `q` to abort. Review each conflicting primary key, or take one entire `.db`.
2. `--item-prefer local|remote`: merge both sides; every conflicting row takes that side. Local-only and remote-only rows are unioned.
3. `--prefer local|remote`: ignore the row merge and copy that entire `.db` over the other side.

Non-TTY runs require `--prefer` or `--item-prefer`.

## Remote writes

`--remote-sudo` runs remote file commands with `sudo -n`.  
`--remote-unit NAME` stops/starts that systemd user unit around the remote replace.  
`--remote-machine` defaults to `USER@` when the remote path is under `/home/USER`.

The remote host needs `python3` with stdlib `sqlite3`. The `sqlite3` CLI is not required.

Sensitive columns use `enc:v1:<key-id>:...`. Do not copy a local-only key to production.

`--reencrypt --local-env <file> --remote-env <file>` decrypts with both keys and writes ciphertext under the destination key before apply. Without `--reencrypt`, ciphertext is copied as-is.


## Verify

After a write (and when the files are already in sync), db-sync checks that both sides match.

Default is a sample of up to 10 rows per table, preferring encrypted rows when a table has sensitive columns. Counts are always compared.

`--deep` inspects every row. `--skip-verify` turns the check off.

With `--reencrypt` and both env files, sensitive columns are compared as plaintext and the destination key id is checked. Values are never printed.
