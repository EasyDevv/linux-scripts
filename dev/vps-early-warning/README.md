# ovh-vps early-warning

Unattended host install. Never print Discord or bouncer keys.

```bash
python3 copy-webhook.py
./apply.sh ovh-vps
```

On the host:

```bash
sudo bash /home/debian/vps-early-warning/install.sh
sudo bash /home/debian/vps-early-warning/verify.sh
```

Public Caddy serves NetBird management only. Dashboard is `https://100.85.0.82/` on `wt0`.

Caddy rollback: `sudo /usr/local/sbin/vps-caddy-rollback`

Do not `nft -f /etc/nftables.conf`. CrowdSec LAPI stays on `127.0.0.1:8180`.
