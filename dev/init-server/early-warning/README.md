# ovh-vps early-warning profile

Integrated host-security phase of `init-vps`. Discord is the production alert channel, and each delivered event is a Rich Embed with a title, severity color, detector/host/event fields, and a code-blocked log body. Routine INFO/NOTICE/WARNING events are dropped; ERROR and CRITICAL events notify. SSH preauth denials are aggregated and only a burst is sent. Immediate events include successful logins, CrowdSec decisions, authorized_keys/sshd/nftables changes, and simultaneous SSH/NetBird recovery failure. CrowdSec bans are NOTICE (defense succeeded), not ERROR. ERROR and above can mention a configured Discord user so the channel can use @mentions-only notifications. Individual SSH preauth denials are dropped; a five-minute window alerts only at 5+ distinct sources or 20+ attempts, with a ten-minute burst cooldown. Falco WARNING and routine unit INFO/NOTICE/WARNING events stay silent; ERROR+ follows the standard severity policy. Prefer `init-vps --apply`; it copies the webhook and runs this profile after host join. Manual apply remains valid for repairs. Public SSH is closed; use the NetBird alias `ovh-vps-nb`.

Policy and Discord layout can be verified on the workstation without applying:

```bash
SCRIPT_DIR=~/.local/share/scripts/dev/init-server
(cd "$SCRIPT_DIR" && python3 -m unittest tests.test_alert_policy tests.test_send_test)
python3 "$SCRIPT_DIR/early-warning/send-test.py"
python3 "$SCRIPT_DIR/early-warning/send-test.py" --send \
  --env ~/.local/share/scripts/dev/.env.sender
```

```bash
python3 "$SCRIPT_DIR/early-warning/copy-sender.py" \
  --target ovh-vps-nb \
  --source ~/.local/share/scripts/dev/.env.sender
python3 "$SCRIPT_DIR/early-warning/apply.py" ovh-vps-nb
```

On the host:

```bash
sudo bash /home/debian/vps-early-warning/install.sh
sudo bash /home/debian/vps-early-warning/verify.sh
```

Public Caddy serves NetBird management only. Dashboard is `https://OVERLAY_IP/` on `wt0`.

Caddy rollback: `sudo /usr/local/sbin/vps-caddy-rollback`

Do not `nft -f /etc/nftables.conf`. CrowdSec LAPI stays on `127.0.0.1:8180`.
