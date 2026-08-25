#!/usr/bin/env bash
set -Eeuo pipefail

apply=false
admin_user=

while (($#)); do
    case "$1" in
        --apply) apply=true ;;
        --admin-user)
            shift
            admin_user=${1:-}
            ;;
        *)
            printf 'Usage: %s --apply --admin-user USER\n' "$0" >&2
            exit 2
            ;;
    esac
    shift
done

if [[ $apply != true || -z $admin_user ]]; then
    printf 'Refusing to change the host without --apply and --admin-user.\n' >&2
    exit 2
fi
if [[ $EUID -ne 0 ]]; then
    printf 'Run as root.\n' >&2
    exit 1
fi
if [[ ! -r /etc/os-release ]]; then
    printf 'Cannot identify the operating system.\n' >&2
    exit 1
fi
. /etc/os-release
if [[ ${ID:-} != debian || ${VERSION_ID:-} != 13 ]]; then
    printf 'This script is validated only for Debian 13. Found %s %s.\n' "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
    exit 1
fi
if ! id "$admin_user" >/dev/null 2>&1; then
    printf 'Admin user does not exist: %s\n' "$admin_user" >&2
    exit 1
fi
if [[ ! -s /home/${admin_user}/.ssh/authorized_keys ]]; then
    printf 'Admin user has no non-empty authorized_keys file: %s\n' "$admin_user" >&2
    exit 1
fi
if command -v podman >/dev/null && [[ -n $(podman ps -q 2>/dev/null) ]]; then
    printf 'Running containers detected. Refusing to flush the live nftables ruleset.\n' >&2
    exit 1
fi

script_dir=$(dirname "$(readlink -f "$0")")
if [[ -r ${script_dir}/setup-log.sh ]]; then
    setup_log_source=${script_dir}/setup-log.sh
elif [[ -r /usr/local/lib/vps-setup/setup-log.sh ]]; then
    setup_log_source=/usr/local/lib/vps-setup/setup-log.sh
else
    printf 'setup-log.sh is required next to this script.\n' >&2
    exit 1
fi
. "$setup_log_source"
setup_log_init new
install -d -o root -g root -m 0755 /usr/local/lib/vps-setup
if [[ $setup_log_source != /usr/local/lib/vps-setup/setup-log.sh ]]; then
    setup_log_before /usr/local/lib/vps-setup/setup-log.sh
    install -o root -g root -m 0644 "$setup_log_source" /usr/local/lib/vps-setup/setup-log.sh
    setup_log_after /usr/local/lib/vps-setup/setup-log.sh
fi

export DEBIAN_FRONTEND=noninteractive
setup_log_action 'APT update, full-upgrade, and required package installation'
apt-get update
apt-get -y full-upgrade
apt-get install -y caddy podman podman-compose podman-docker jq curl openssl ca-certificates nftables unattended-upgrades needrestart iproute2
# CrowdSec/Falco/auditd come from early-warning/.

install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d
setup_log_before /etc/ssh/sshd_config.d/99-vps-hardening.conf
cat >/etc/ssh/sshd_config.d/99-vps-hardening.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
DisableForwarding yes
PermitTunnel no
PermitUserEnvironment no
MaxAuthTries 3
MaxSessions 5
LoginGraceTime 30
AllowUsers ${admin_user}
EOF
setup_log_after /etc/ssh/sshd_config.d/99-vps-hardening.conf
sshd -t

setup_log_before /etc/nftables.conf
# Overlay is not a trusted LAN here. NetBird inserts wt0 passthrough and its own ACL.
cat >/etc/nftables.conf <<'EOF'
#!/usr/sbin/nft -f
flush ruleset
table inet filter {
    chain input {
        type filter hook input priority filter; policy drop;
        ct state invalid drop
        ct state established,related accept
        iifname "lo" accept
        ip protocol icmp accept
        ip6 nexthdr ipv6-icmp accept
        iifname "podman*" meta l4proto { tcp, udp } th dport 53 accept
        meta nfproto ipv4 tcp dport 22 ct state new accept
        tcp dport { 80, 443 } ct state new accept
        meta nfproto ipv4 udp dport 3478 ct state new accept
    }
    chain forward {
        type filter hook forward priority filter; policy accept;
    }
    chain output {
        type filter hook output priority filter; policy accept;
    }
}
EOF
setup_log_after /etc/nftables.conf
nft -c -f /etc/nftables.conf

setup_log_before /etc/sysctl.d/99-vps-hardening.conf
cat >/etc/sysctl.d/99-vps-hardening.conf <<'EOF'
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.unprivileged_bpf_disabled = 1
fs.protected_fifos = 2
fs.protected_regular = 2
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0
EOF
setup_log_after /etc/sysctl.d/99-vps-hardening.conf

install -d -o root -g root -m 0755 /etc/systemd/resolved.conf.d
setup_log_before /etc/systemd/resolved.conf.d/99-vps-hardening.conf
cat >/etc/systemd/resolved.conf.d/99-vps-hardening.conf <<'EOF'
[Resolve]
LLMNR=no
MulticastDNS=no
EOF
setup_log_after /etc/systemd/resolved.conf.d/99-vps-hardening.conf

systemctl reload ssh
systemctl enable --now nftables
systemctl restart systemd-resolved
systemctl enable apt-daily.timer apt-daily-upgrade.timer
sysctl --system

# World-writable sticky /tmp is required for rootless Podman and non-debian users.
# Some images leave /tmp as 0700 debian:debian.
setup_log_before /tmp
chmod 1777 /tmp /var/tmp
chown root:root /tmp /var/tmp
setup_log_after /tmp

create_domain_user() {
    local user="$1"
    local subid="$2"
    local home="/home/${user}"
    if id "$user" >/dev/null 2>&1; then
        if id -nG "$user" | tr ' ' '\n' | grep -qx sudo; then
            printf 'Refusing existing %s because it is in sudo.\n' "$user" >&2
            exit 1
        fi
    else
        useradd --create-home --home-dir "$home" --shell /usr/sbin/nologin --user-group "$user"
    fi
    usermod -L "$user" || true
    loginctl enable-linger "$user"
    systemctl start "user@$(id -u "$user").service" || true
    if ! grep -q "^${user}:" /etc/subuid; then
        echo "${user}:${subid}:65536" >>/etc/subuid
    fi
    if ! grep -q "^${user}:" /etc/subgid; then
        echo "${user}:${subid}:65536" >>/etc/subgid
    fi
    install -d -o "$user" -g "$user" -m 0700 \
        "$home" "$home/.config" "$home/.local" "$home/.local/share" \
        "$home/.cache" "$home/.cache/tmp" \
        "$home/.config/containers" "$home/.config/containers/systemd"
}

setup_log_action 'Create isolated rootless domain users svc-public and svc-internal'
create_domain_user svc-public 231072
create_domain_user svc-internal 165536

printf 'Bootstrap applied. Keep this session open and verify a second SSH connection before continuing.\n'
printf 'Reboot is not automatic. Reboot after workload configuration and verification.\n'
printf 'Change log: %s\n' "$VPS_SETUP_LOG"
