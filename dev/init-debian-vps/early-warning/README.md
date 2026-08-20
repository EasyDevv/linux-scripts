# ovh-vps early-warning profile

Integrated host-security phase of `init-vps`. Discord is the production alert channel, and each delivered event is a Rich Embed with a title, severity color, fixed fields, and a code-blocked log body. Routine INFO/NOTICE/WARNING events are dropped; ERROR and CRITICAL events notify. SSH preauth denials are aggregated and only a burst is sent. Immediate events include successful logins, CrowdSec decisions, authorized_keys/sshd/nftables changes, and simultaneous SSH/NetBird recovery failure. Individual SSH preauth denials are dropped; a five-minute window alerts only at 5+ distinct sources or 20+ attempts, with a ten-minute burst cooldown. Falco WARNING and routine unit INFO/NOTICE/WARNING events stay silent; ERROR+ follows the standard severity policy. Prefer `init-vps --apply`; it copies the webhook and runs this profile after host join. Manual apply remains valid for repairs.

```bash
SCRIPT_DIR=~/.local/share/scripts/dev/init-debian-vps
python3 "$SCRIPT_DIR/early-warning/copy-sender.py" \
  --target ovh-vps \
  --source /path/to/.env.discord
"$SCRIPT_DIR/early-warning/apply.sh" ovh-vps
```

On the host:

```bash
sudo bash /home/debian/vps-early-warning/install.sh
sudo bash /home/debian/vps-early-warning/verify.sh
```

Public Caddy serves NetBird management only. Dashboard is `https://OVERLAY_IP/` on `wt0`.

Caddy rollback: `sudo /usr/local/sbin/vps-caddy-rollback`

Do not `nft -f /etc/nftables.conf`. CrowdSec LAPI stays on `127.0.0.1:8180`.
