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
if [[ -f /etc/vps-alert/sender.env && ! -f /etc/vps-alert/.env.sender ]]; then
  mv /etc/vps-alert/sender.env /etc/vps-alert/.env.sender
fi
if [[ ! -f /etc/vps-alert/.env.sender ]]; then
  echo "missing /etc/vps-alert/.env.sender" >&2
  exit 1
fi
python3 - <<'PY'
from pathlib import Path

path = Path("/etc/vps-alert/.env.sender")
values = {}
for raw in path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip().strip("'\"")
hook = values.get("DISCORD_WEBHOOK") or values.get("DISCORD_OVH_VPS_WEBHOOK") or ""
if not hook.startswith("https://"):
    raise SystemExit("missing Discord webhook in /etc/vps-alert/.env.sender")
path.write_text(f"DISCORD_WEBHOOK={hook}\n", encoding="utf-8")
PY

progress() { printf ':: %s\n' "$*"; }
export PYTHONUNBUFFERED=1

WT0_IP=$(ip -4 -o addr show dev wt0 | awk '{print $4}' | cut -d/ -f1)
PUBLIC_IP=$(ip -4 -o route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
if [[ -z ${WT0_IP} || -z ${PUBLIC_IP} ]]; then
  echo "missing wt0 or public ipv4" >&2
  exit 1
fi
export WT0_IP PUBLIC_IP

export DEBIAN_FRONTEND=noninteractive
progress "host files"
python3 - <<'PY'
from pathlib import Path
fqdn = Path("/etc/hostname").read_text(encoding="utf-8").strip()
hosts = Path("/etc/hosts")
text = hosts.read_text(encoding="utf-8")
lines = []
changed = False
for line in text.splitlines(True):
    if line.startswith("127.0.1.1") and fqdn in line:
        line = line.replace(fqdn, "").replace("  ", " ")
        changed = True
    lines.append(line)
body = "".join(lines)
if f"127.0.0.1 {fqdn}" not in body and f"127.0.0.1\t{fqdn}" not in body:
    body += f"127.0.0.1 {fqdn}\n"
    changed = True
if changed:
    hosts.write_text(body, encoding="utf-8")
    print("hosts_fqdn_loopback")
PY
install -d -m 0750 /etc/vps-alert /var/lib/vps-alert
install -d -m 0755 /usr/local/sbin
install -m 0755 "$SRC_DIR/vps-alert" /usr/local/sbin/vps-alert
install -m 0755 "$SRC_DIR/vps-audit-plugin" /usr/local/sbin/vps-audit-plugin
install -m 0755 "$SRC_DIR/vps-journal-watch" /usr/local/sbin/vps-journal-watch
install -m 0755 "$SRC_DIR/vps-falco-alert" /usr/local/sbin/vps-falco-alert
install -m 0755 "$SRC_DIR/vps-crowdsec-nft-drop" /usr/local/sbin/vps-crowdsec-nft-drop
install -m 0755 "$SRC_DIR/vps-caddy-rollback" /usr/local/sbin/vps-caddy-rollback
install -m 0755 "$SRC_DIR/vps-caddy-overlay" /usr/local/sbin/vps-caddy-overlay
install -m 0644 "$SRC_DIR/vps-caddy-overlay.service" /etc/systemd/system/vps-caddy-overlay.service
install -m 0644 "$SRC_DIR/vps-journal-watch.service" /etc/systemd/system/vps-journal-watch.service
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 "$SRC_DIR/journald-vps-early-warning.conf" /etc/systemd/journald.conf.d/vps-early-warning.conf
touch /etc/vps-alert/watch-test
chmod 644 /etc/vps-alert/watch-test
chmod 640 /etc/vps-alert/.env.sender
chown root:root /etc/vps-alert/.env.sender

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

progress "apt crowdsec"
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

notify = Path("/etc/crowdsec/notifications/vps-alert.yaml")
notify.write_text(
    """type: http
name: vps_alert
log_level: info
format: |
  {"content": "[crowdsec] {{range .}}{{range .Decisions}}{{.Scenario}} {{.Type}} {{.Duration}} {{.Value}} {{end}}{{end}}"}
url: http://127.0.0.1:8766/
method: POST
headers:
  Content-Type: application/json
group_wait: 1s
group_threshold: 1
timeout: 10s
""",
    encoding="utf-8",
)
os.chmod(notify, 0o640)
Path("/etc/crowdsec/notifications/vps-discord.yaml").unlink(missing_ok=True)

profiles = Path("/etc/crowdsec/profiles.yaml")
body = profiles.read_text(encoding="utf-8")
body = body.replace("vps_discord", "vps_alert")
if "vps_alert" not in body:
    old = "# notifications:\n#   - slack_default  # Set the webhook in /etc/crowdsec/notifications/slack.yaml before enabling this.\n#   - splunk_default # Set the splunk url and token in /etc/crowdsec/notifications/splunk.yaml before enabling this.\n#   - http_default   # Set the required http parameters in /etc/crowdsec/notifications/http.yaml before enabling this.\n#   - email_default  # Set the required email parameters in /etc/crowdsec/notifications/email.yaml before enabling this."
    repl = "notifications:\n  - vps_alert"
    if old not in body:
        raise SystemExit("profiles.yaml notifications marker missing")
    backup = profiles.with_suffix(".yaml.bak-early-warning")
    if not backup.exists():
        backup.write_text(profiles.read_text(encoding="utf-8"), encoding="utf-8")
    body = body.replace(old, repl, 1)
    print("crowdsec_notify_enabled")
profiles.write_text(body, encoding="utf-8")

local = Path("/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml.local")
local.write_text("api_url: http://127.0.0.1:8180/\ndeny_action: DROP\n", encoding="utf-8")
os.chmod(local, 0o640)
bouncer = Path("/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml")
if bouncer.exists() and OLD in bouncer.read_text(encoding="utf-8"):
    bouncer.write_text(bouncer.read_text(encoding="utf-8").replace(OLD, NEW), encoding="utf-8")
PY

systemctl enable crowdsec >/dev/null
systemctl restart crowdsec
for _ in $(seq 1 30); do
  if ss -lnt | grep -q '127.0.0.1:8180'; then
    break
  fi
  sleep 1
done
if ! ss -lnt | grep -q '127.0.0.1:8180'; then
  echo "crowdsec lapi not listening on 8180" >&2
  exit 1
fi

python3 - <<'PY'
import re
import subprocess
from pathlib import Path

bouncer = Path("/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml")
text = bouncer.read_text(encoding="utf-8") if bouncer.exists() else ""
listed = subprocess.check_output(["cscli", "bouncers", "list", "-o", "raw"], text=True)
has_bouncer = any(line.strip() and not line.startswith("name,") for line in listed.splitlines())
placeholder = (not text) or ("api_key: <API_KEY>" in text) or ("api_key:" not in text)
if placeholder or not has_bouncer:
    key = subprocess.check_output(
        ["cscli", "bouncers", "add", "nft-ovh-vps", "-o", "raw"], text=True
    ).strip()
    if not key or key.startswith("<"):
        raise SystemExit("firewall bouncer key missing")
    if "api_key:" in text:
        text = re.sub(r"^api_key:.*$", f"api_key: {key}", text, count=1, flags=re.M)
    else:
        text = text.rstrip() + f"\napi_key: {key}\n"
    bouncer.write_text(text, encoding="utf-8")
    print("firewall_bouncer_registered")
else:
    print("firewall_bouncer_present")
PY

rm -f /etc/crowdsec/acquis.d/vps-early-warning.yaml
install -m 0644 "$SRC_DIR/acquis.d-appsec.yaml" /etc/crowdsec/acquis.d/appsec.yaml
cscli hub update
cscli collections install crowdsecurity/linux crowdsecurity/sshd crowdsecurity/caddy \
  crowdsecurity/appsec-virtual-patching crowdsecurity/appsec-generic-rules || true

if ! cscli allowlists list -o raw | grep -q '^vps-local'; then
  cscli allowlists create vps-local -d "loopback overlay podman self"
fi
cscli allowlists add vps-local 127.0.0.1 ::1 100.85.0.0/16 10.89.0.0/24 $PUBLIC_IP >/dev/null || true

install -m 0640 "$SRC_DIR/10-vps-early-warning.rules" /etc/audit/rules.d/10-vps-early-warning.rules
install -m 0640 "$SRC_DIR/vps-audit-plugin.conf" /etc/audit/plugins.d/vps-alert.conf
install -d /etc/systemd/system/crowdsec-firewall-bouncer.service.d
printf '%s\n' '[Service]' 'ExecStartPost=/usr/local/sbin/vps-crowdsec-nft-drop' \
  >/etc/systemd/system/crowdsec-firewall-bouncer.service.d/nft-drop.conf

progress "crowdsec lapi"
systemctl daemon-reload
systemctl enable --now auditd crowdsec crowdsec-firewall-bouncer vps-journal-watch vps-caddy-overlay
augenrules --load || true
systemctl restart auditd crowdsec crowdsec-firewall-bouncer vps-journal-watch
/usr/local/sbin/vps-crowdsec-nft-drop || true

progress "apt falco"
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

progress "xcaddy appsec"
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

progress "caddyfile"
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
    old_variants = [
        "\t@grpc header Content-Type application/grpc*\n\treverse_proxy @grpc h2c://127.0.0.1:8081\n\n\t@backend path /relay* /ws-proxy/* /api/* /oauth2/*\n\treverse_proxy @backend 127.0.0.1:8081\n\n\treverse_proxy /* 127.0.0.1:8080\n",
        "\t@grpc header Content-Type application/grpc*\n\treverse_proxy @grpc h2c://127.0.0.1:8081\n\t@backend path /relay* /ws-proxy/* /api/* /oauth2/*\n\treverse_proxy @backend 127.0.0.1:8081\n\treverse_proxy /* 127.0.0.1:8080\n",
    ]
    old = next((v for v in old_variants if v in text), None)
    if old is None:
        raise SystemExit("caddy site marker missing")
    new = (
        "\troute {\n"
        "\t\tcrowdsec\n"
        "\t\t@grpc header Content-Type application/grpc*\n"
        "\t\treverse_proxy @grpc h2c://127.0.0.1:8081\n"
        "\t\tappsec\n"
        "\t\t@backend path /relay* /ws-proxy* /api* /oauth2*\n"
        "\t\treverse_proxy @backend 127.0.0.1:8081\n"
        "\t\trespond 404\n"
        "\t}\n"
    )
    src.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("caddyfile_appsec_added")
PY
python3 - <<'PY'
import re
from pathlib import Path

src = Path("/etc/caddy/Caddyfile")
text = src.read_text(encoding="utf-8")
text = re.sub(
    r"\nhttp://100\.\d+\.\d+\.\d+ \{.*?\n\}\n\nhttps://100\.\d+\.\d+\.\d+ \{.*?\n\}\n?",
    "\n",
    text,
    flags=re.S,
)
if "import /etc/caddy/overlay.caddy" not in text:
    text = text.rstrip() + "\n\nimport /etc/caddy/overlay.caddy\n"
    print("caddyfile_overlay_import")
else:
    print("caddyfile_overlay_import_present")
src.write_text(text, encoding="utf-8")
overlay = Path("/etc/caddy/overlay.caddy")
if not overlay.exists():
    overlay.write_text("# filled by vps-caddy-overlay when wt0 exists\n", encoding="utf-8")
PY
chmod 644 /etc/caddy/Caddyfile
chown root:caddy /etc/caddy
chmod 750 /etc/caddy
if [[ ! -f /etc/caddy/netbird-setup-restriction.caddy ]]; then
  python3 - <<'PY'
from pathlib import Path
path = Path("/etc/caddy/Caddyfile")
text = path.read_text(encoding="utf-8")
old = "\timport /etc/caddy/netbird-setup-restriction.caddy\n"
if old in text:
    path.write_text(text.replace(old, "", 1), encoding="utf-8")
    print("caddy_setup_import_removed")
PY
fi

install -d /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/crowdsec-bin.conf <<'UNIT'
[Service]
EnvironmentFile=/etc/caddy/crowdsec.env
Restart=on-failure
RestartSec=3
ExecStart=
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
UNIT
systemctl daemon-reload
set -a
# shellcheck disable=SC1091
. /etc/caddy/crowdsec.env
set +a
progress "caddy validate"
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile
# validate runs as root and may create access.log as root:root 600
chown -R caddy:caddy /var/log/caddy
chmod 755 /var/log/caddy
progress "caddy restart"
if ! systemctl restart caddy; then
  echo "caddy restart failed" >&2
  journalctl -u caddy -n 40 --no-pager >&2 || true
  systemctl status caddy --no-pager -l >&2 || true
  exit 1
fi
if ! systemctl is-active --quiet caddy; then
  echo "caddy inactive after restart" >&2
  journalctl -u caddy -n 40 --no-pager >&2 || true
  exit 1
fi
progress "caddy overlay"
/usr/local/sbin/vps-caddy-overlay || true

echo "early-warning-installed"
