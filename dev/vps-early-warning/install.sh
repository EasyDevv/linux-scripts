#!/bin/bash
# Idempotent ovh-vps early-warning install. Run as root. Never print secrets.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
SRC_DIR=$ROOT/files
if [[ ! -d $SRC_DIR ]]; then
  echo "missing $SRC_DIR" >&2
  exit 1
fi
if [[ $(id -u) -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi
if [[ ! -f /etc/vps-alert/discord.env ]]; then
  echo "missing /etc/vps-alert/discord.env" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
install -d -m 0750 /etc/vps-alert /var/lib/vps-alert
install -d -m 0755 /usr/local/sbin
install -m 0755 "$SRC_DIR/vps-alert" /usr/local/sbin/vps-alert
install -m 0755 "$SRC_DIR/vps-audit-plugin" /usr/local/sbin/vps-audit-plugin
install -m 0755 "$SRC_DIR/vps-journal-watch" /usr/local/sbin/vps-journal-watch
install -m 0755 "$SRC_DIR/vps-falco-alert" /usr/local/sbin/vps-falco-alert
install -m 0755 "$SRC_DIR/vps-crowdsec-nft-drop" /usr/local/sbin/vps-crowdsec-nft-drop
install -m 0755 "$SRC_DIR/vps-caddy-rollback" /usr/local/sbin/vps-caddy-rollback
install -m 0644 "$SRC_DIR/vps-journal-watch.service" /etc/systemd/system/vps-journal-watch.service
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 "$SRC_DIR/journald-vps-early-warning.conf" /etc/systemd/journald.conf.d/vps-early-warning.conf
touch /etc/vps-alert/watch-test
chmod 644 /etc/vps-alert/watch-test
chmod 640 /etc/vps-alert/discord.env
chown root:root /etc/vps-alert/discord.env

# Caddy access log + directory that the caddy user can traverse.
install -d -o caddy -g caddy -m 0755 /var/log/caddy
chown root:caddy /etc/caddy
chmod 750 /etc/caddy
python3 - <<'PY'
from pathlib import Path
path = Path("/etc/caddy/Caddyfile")
text = path.read_text(encoding="utf-8")
if "access.log" not in text:
    marker = "\treverse_proxy /* 127.0.0.1:8080\n"
    if marker not in text:
        raise SystemExit("caddy marker missing")
    backup = path.with_suffix(".bak-early-warning")
    if not backup.exists():
        backup.write_text(text, encoding="utf-8")
    path.write_text(
        text.replace(
            marker,
            marker
            + """
	log {
		output file /var/log/caddy/access.log {
			roll_size 20mb
			roll_keep 5
		}
		format json
	}
""",
            1,
        ),
        encoding="utf-8",
    )
    print("caddy_log_added")
else:
    print("caddy_log_present")
PY
chmod 644 /etc/caddy/Caddyfile

apt-get update -qq
apt-get install -y debian-archive-keyring curl gnupg apt-transport-https auditd audispd-plugins
install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/crowdsec_crowdsec-archive-keyring.gpg ]]; then
  curl -fsSL https://packagecloud.io/crowdsec/crowdsec/gpgkey \
    | gpg --dearmor >/etc/apt/keyrings/crowdsec_crowdsec-archive-keyring.gpg
  chmod 644 /etc/apt/keyrings/crowdsec_crowdsec-archive-keyring.gpg
fi
cat >/etc/apt/sources.list.d/crowdsec_crowdsec.list <<'EOF'
deb [signed-by=/etc/apt/keyrings/crowdsec_crowdsec-archive-keyring.gpg] https://packagecloud.io/crowdsec/crowdsec/any any main
EOF
install -m 0644 "$SRC_DIR/apt-preferences-crowdsec" /etc/apt/preferences.d/crowdsec
apt-get update -qq
candidate=$(apt-cache policy crowdsec | awk '/Candidate:/ {print $2}')
case $candidate in
  1.4.*|"")
    echo "crowdsec candidate is $candidate, refusing Debian 1.4 package" >&2
    exit 1
    ;;
esac
apt-get install -y crowdsec crowdsec-firewall-bouncer-nftables

python3 - <<'PY'
from pathlib import Path
import os
import subprocess

OLD, NEW = "127.0.0.1:8080", "127.0.0.1:8180"
for rel in ("/etc/crowdsec/config.yaml", "/etc/crowdsec/local_api_credentials.yaml"):
    path = Path(rel)
    text = path.read_text(encoding="utf-8")
    if OLD in text:
        path.write_text(text.replace(OLD, NEW), encoding="utf-8")
        print(f"lapi_port_moved {path.name}")

webhook = ""
for raw in Path("/etc/vps-alert/discord.env").read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if line.startswith("DISCORD_WEBHOOK="):
        webhook = line.split("=", 1)[1].strip().strip("'").strip('"')
if not webhook.startswith("https://"):
    raise SystemExit("webhook missing")
notify = Path("/etc/crowdsec/notifications/vps-discord.yaml")
notify.write_text(
    """type: http
name: vps_discord
log_level: info
format: |
  {"content": "[crowdsec] {{range .}}{{range .Decisions}}{{.Scenario}} {{.Type}} {{.Duration}} {{.Value}} {{end}}{{end}}"}
url: %s
method: POST
headers:
  Content-Type: application/json
group_wait: 30s
group_threshold: 5
timeout: 10s
"""
    % webhook,
    encoding="utf-8",
)
os.chmod(notify, 0o640)

profiles = Path("/etc/crowdsec/profiles.yaml")
body = profiles.read_text(encoding="utf-8")
if "vps_discord" not in body:
    old = "# notifications:\n#   - slack_default  # Set the webhook in /etc/crowdsec/notifications/slack.yaml before enabling this.\n#   - splunk_default # Set the splunk url and token in /etc/crowdsec/notifications/splunk.yaml before enabling this.\n#   - http_default   # Set the required http parameters in /etc/crowdsec/notifications/http.yaml before enabling this.\n#   - email_default  # Set the required email parameters in /etc/crowdsec/notifications/email.yaml before enabling this."
    new = "notifications:\n  - vps_discord"
    if old not in body:
        raise SystemExit("profiles.yaml notifications marker missing")
    backup = profiles.with_suffix(".yaml.bak-early-warning")
    if not backup.exists():
        backup.write_text(body, encoding="utf-8")
    profiles.write_text(body.replace(old, new, 1), encoding="utf-8")
    print("crowdsec_notify_enabled")

local = Path("/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml.local")
local.write_text("api_url: http://127.0.0.1:8180/\ndeny_action: DROP\n", encoding="utf-8")
os.chmod(local, 0o640)
bouncer = Path("/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml")
if bouncer.exists() and OLD in bouncer.read_text(encoding="utf-8"):
    bouncer.write_text(bouncer.read_text(encoding="utf-8").replace(OLD, NEW), encoding="utf-8")
PY

rm -f /etc/crowdsec/acquis.d/vps-early-warning.yaml
install -m 0644 "$SRC_DIR/acquis.d-appsec.yaml" /etc/crowdsec/acquis.d/appsec.yaml
cscli hub update
cscli collections install crowdsecurity/linux crowdsecurity/sshd crowdsecurity/caddy \
  crowdsecurity/appsec-virtual-patching crowdsecurity/appsec-generic-rules || true

if ! cscli allowlists list -o raw | grep -q '^vps-local'; then
  cscli allowlists create vps-local -d "loopback overlay podman self"
fi
cscli allowlists add vps-local 127.0.0.1 ::1 100.85.0.0/16 10.89.0.0/24 15.204.121.190 >/dev/null || true

install -m 0640 "$SRC_DIR/10-vps-early-warning.rules" /etc/audit/rules.d/10-vps-early-warning.rules
install -m 0640 "$SRC_DIR/vps-audit-plugin.conf" /etc/audit/plugins.d/vps-alert.conf
install -d /etc/systemd/system/crowdsec-firewall-bouncer.service.d
printf '%s\n' '[Service]' 'ExecStartPost=/usr/local/sbin/vps-crowdsec-nft-drop' \
  >/etc/systemd/system/crowdsec-firewall-bouncer.service.d/nft-drop.conf

systemctl daemon-reload
systemctl enable --now auditd crowdsec crowdsec-firewall-bouncer vps-journal-watch
augenrules --load || true
systemctl restart auditd crowdsec crowdsec-firewall-bouncer
/usr/local/sbin/vps-crowdsec-nft-drop || true

# Falco
if [[ ! -f /usr/share/keyrings/falco-archive-keyring.gpg ]]; then
  curl -fsSL https://falco.org/repo/falcosecurity-packages.asc \
    | gpg --dearmor >/usr/share/keyrings/falco-archive-keyring.gpg
fi
echo "deb [signed-by=/usr/share/keyrings/falco-archive-keyring.gpg] https://download.falco.org/packages/deb stable main" \
  >/etc/apt/sources.list.d/falcosecurity.list
apt-get update -qq
FALCO_FRONTEND=noninteractive FALCO_DRIVER_CHOICE=modern_ebpf apt-get install -y falco
install -m 0644 "$SRC_DIR/falco-vps-early-warning.yaml" /etc/falco/config.d/vps-early-warning.yaml
install -m 0644 "$SRC_DIR/falco_rules.local.yaml" /etc/falco/falco_rules.local.yaml
systemctl enable --now falco-modern-bpf
systemctl restart falco-modern-bpf

# Custom Caddy with CrowdSec AppSec
if ! /usr/local/bin/caddy list-modules 2>/dev/null | grep -q 'http.handlers.appsec'; then
  mkdir -p /home/debian/caddy-build
  podman run --rm -v /home/debian/caddy-build:/src -w /src docker.io/caddy:2-builder \
    xcaddy build \
    --with github.com/hslatman/caddy-crowdsec-bouncer/http \
    --with github.com/hslatman/caddy-crowdsec-bouncer/appsec
  install -m 0755 /home/debian/caddy-build/caddy /usr/local/bin/caddy
  setcap cap_net_bind_service=+ep /usr/local/bin/caddy || true
fi

python3 - <<'PY'
import os
import subprocess
from pathlib import Path

env = Path("/etc/caddy/crowdsec.env")
if not env.exists() or "CADDY_CROWDSEC_KEY=" not in env.read_text(encoding="utf-8"):
    key = subprocess.check_output(["cscli", "bouncers", "add", "caddy-ovh-vps", "-o", "raw"], text=True).strip()
    env.write_text(f"CADDY_CROWDSEC_KEY={key}\n", encoding="utf-8")
    print("caddy_bouncer_created")
os.chmod(env, 0o640)
os.system("chown root:caddy /etc/caddy/crowdsec.env")

src = Path("/etc/caddy/Caddyfile")
text = src.read_text(encoding="utf-8")
bak = Path("/etc/caddy/Caddyfile.bak-stock")
if not bak.exists():
    bak.write_text(text, encoding="utf-8")
if "appsec_url" not in text:
    text = text.replace(
        "\tservers {\n\t\tprotocols h1 h2\n\t}\n",
        "\tservers {\n\t\tprotocols h1 h2\n\t}\n"
        "\torder crowdsec first\n"
        "\torder appsec after crowdsec\n"
        "\tcrowdsec {\n"
        "\t\tapi_url http://127.0.0.1:8180\n"
        "\t\tapi_key {$CADDY_CROWDSEC_KEY}\n"
        "\t\tticker_interval 15s\n"
        "\t\tappsec_url http://127.0.0.1:7422\n"
        "\t\tappsec_fail_open\n"
        "\t}\n",
        1,
    )
    old = "\t@grpc header Content-Type application/grpc*\n\treverse_proxy @grpc h2c://127.0.0.1:8081\n\n\t@backend path /relay* /ws-proxy/* /api/* /oauth2/*\n\treverse_proxy @backend 127.0.0.1:8081\n\n\treverse_proxy /* 127.0.0.1:8080\n"
    new = (
        "\troute {\n"
        "\t\tcrowdsec\n"
        "\t\tappsec\n"
        "\t\t@grpc header Content-Type application/grpc*\n"
        "\t\treverse_proxy @grpc h2c://127.0.0.1:8081\n"
        "\t\t@backend path /relay* /ws-proxy* /api* /oauth2*\n"
        "\t\treverse_proxy @backend 127.0.0.1:8081\n"
        "\t\trespond 404\n"
        "\t}\n"
    )
    if old not in text:
        raise SystemExit("caddy site marker missing")
    src.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("caddyfile_appsec_added")
PY
python3 - <<'PY'
from pathlib import Path

src = Path("/etc/caddy/Caddyfile")
text = src.read_text(encoding="utf-8")
if "http://100.85.0.82 {" in text:
    print("caddyfile_dashboard_wt0_present")
else:
    needle = (
        "\t\treverse_proxy @backend 127.0.0.1:8081\n"
        "\t\treverse_proxy /* 127.0.0.1:8080\n"
    )
    # Fresh template already uses respond 404; still add overlay site.
    if needle in text:
        text = text.replace(
            needle,
            "\t\treverse_proxy @backend 127.0.0.1:8081\n\t\trespond 404\n",
            1,
        )
        text = text.replace(
            "@backend path /relay* /ws-proxy/* /api/* /oauth2/*",
            "@backend path /relay* /ws-proxy* /api* /oauth2*",
            1,
        )
    elif "respond 404" not in text:
        raise SystemExit("caddy dashboard catch-all missing")
    if "bind 15.204.121.190" not in text:
        text = text.replace(
            "vps-a851fbbf.vps.ovh.us {\n",
            "vps-a851fbbf.vps.ovh.us {\n\tbind 15.204.121.190 127.0.0.1\n",
            1,
        )
    text = text.rstrip() + """

http://100.85.0.82 {
	bind 100.85.0.82
	redir https://100.85.0.82{uri} 308
}

https://100.85.0.82 {
	bind 100.85.0.82
	tls internal
	encode zstd gzip

	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	route {
		crowdsec
		appsec
		@grpc header Content-Type application/grpc*
		reverse_proxy @grpc h2c://127.0.0.1:8081
		@backend path /relay* /ws-proxy* /api* /oauth2*
		reverse_proxy @backend 127.0.0.1:8081
		reverse_proxy /* 127.0.0.1:8080
	}

	log {
		output file /var/log/caddy/access.log {
			roll_size 20mb
			roll_keep 5
		}
		format json
	}
}
"""
    src.write_text(text, encoding="utf-8")
    print("caddyfile_dashboard_wt0")
PY
chmod 644 /etc/caddy/Caddyfile
chown root:caddy /etc/caddy
chmod 750 /etc/caddy

install -d /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/crowdsec-bin.conf <<'UNIT'
[Service]
EnvironmentFile=/etc/caddy/crowdsec.env
ExecStart=
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
UNIT
systemctl daemon-reload
set -a
# shellcheck disable=SC1091
. /etc/caddy/crowdsec.env
set +a
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
if ! systemctl is-active --quiet caddy; then
  echo "caddy failed; check /etc/caddy mode 750 root:caddy" >&2
  exit 1
fi

if systemctl is-active --quiet fail2ban; then
  systemctl disable --now fail2ban
fi
nft delete table inet f2b-table 2>/dev/null || true
apt-get remove -y fail2ban >/dev/null 2>&1 || true

echo "early-warning-installed"
