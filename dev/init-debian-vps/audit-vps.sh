#!/usr/bin/env bash
set -Eeuo pipefail

target=${1:?Usage: audit-vps.sh SSH_TARGET}
script_dir=$(dirname "$(readlink -f "$0")")

ssh -o BatchMode=yes "$target" 'sudo bash -s' <<'REMOTE'
set -u

section() { printf '\n== %s ==\n' "$1"; }
check_service() {
    if systemctl is-active --quiet "$1"; then
        printf 'PASS service active: %s\n' "$1"
    else
        printf 'WARN service inactive: %s\n' "$1"
    fi
}
sshd_value() {
    local key=$1 line
    while IFS= read -r line; do
        case "$line" in
            "$key "*) printf '%s\n' "$line"; return ;;
        esac
    done < <(sshd -T)
}

section Identity
printf 'host=%s kernel=%s uptime=%s\n' "$(hostname -f)" "$(uname -r)" "$(uptime -p)"
if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    printf 'os=%s version=%s\n' "${ID:-unknown}" "${VERSION_ID:-unknown}"
fi

section Resources
df -h /
free -h

section SSH
for key in permitrootlogin passwordauthentication kbdinteractiveauthentication pubkeyauthentication x11forwarding disableforwarding maxauthtries allowusers; do
    sshd_value "$key"
done

section Listeners
ss -tulpn

section Firewall
if command -v nft >/dev/null; then
    nft list ruleset
else
    printf 'WARN nftables not installed\n'
fi

section Services
for unit in ssh nftables fail2ban caddy netbird-podman; do
    check_service "$unit"
done
systemctl --failed --no-pager

section Updates
systemctl is-enabled apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
if [[ -e /run/reboot-required ]]; then
    printf 'WARN reboot required\n'
else
    printf 'PASS reboot not required\n'
fi

section Containers
if command -v podman >/dev/null; then
    podman ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
else
    printf 'INFO Podman not installed\n'
fi

section SharedTemp
for path in /tmp /var/tmp; do
    stat -c '%a %U:%G %n' "$path"
    mode=$(stat -c '%a' "$path")
    owner=$(stat -c '%U:%G' "$path")
    if [[ $mode == 1777 && $owner == root:root ]]; then
        printf 'PASS %s is sticky world-writable\n' "$path"
    else
        printf 'WARN %s is %s %s (need 1777 root:root for rootless users)\n' "$path" "$mode" "$owner"
    fi
done

section DomainUsers
for user in svc-public svc-internal; do
    if id "$user" >/dev/null 2>&1; then
        groups=$(id -nG "$user")
        linger=$(loginctl show-user "$user" -p Linger --value 2>/dev/null || printf missing)
        if printf '%s\n' $groups | grep -qx sudo; then
            printf 'FAIL %s is in sudo\n' "$user"
        else
            printf 'PASS user %s uid=%s linger=%s groups=%s\n' "$user" "$(id -u "$user")" "$linger" "$groups"
        fi
    else
        printf 'INFO user %s not created yet\n' "$user"
    fi
done

section NetBirdClient
if command -v netbird >/dev/null; then
    netbird status 2>/dev/null | awk '/Management:|Signal:|FQDN:|NetBird IP:|Peers count/' || printf 'INFO netbird installed, status unavailable\n'
    ip -br addr show wt0 2>/dev/null || printf 'INFO no wt0\n'
else
    printf 'INFO netbird client not installed\n'
fi

section SensitiveFiles
for path in /opt/netbird/config.yaml /opt/netbird/dashboard.env /opt/netbird/docker-compose.yml; do
    if [[ -e $path ]]; then
        stat -c '%a %U:%G %n' "$path"
    fi
done

section SetupChangeLog
if [[ -s /var/lib/vps-setup/current-log ]]; then
    log=$(</var/lib/vps-setup/current-log)
    printf 'current=%s\n' "$log"
    if [[ -r $log ]]; then
        printf '%s\n' '--- managed changes ---'
        while IFS= read -r line; do printf '%s\n' "$line"; done <"$log"
    fi
else
    printf 'INFO no VPS setup change log found\n'
fi

section Backup
printf 'INFO Verify an encrypted off-host backup and restore test manually.\n'
REMOTE

"${script_dir}/sync-vps-setup-log.sh" "$target"
