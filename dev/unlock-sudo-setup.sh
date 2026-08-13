set -eu

RUNTIME_DIR=/run/temp-sudo
INCLUDE_FILE=/etc/sudoers.d/zz-temp-sudo
POLICY_FILE="$RUNTIME_DIR/policy"
INCLUDE_MARKER='# Managed by dev/unlock-sudo.ts; runtime-only policy.'

command -v findmnt >/dev/null 2>&1 || {
	echo "findmnt is required to verify that /run is temporary" >&2
	exit 1
}
command -v visudo >/dev/null 2>&1 || {
	echo "visudo is required to validate the sudoers policy" >&2
	exit 1
}

run_fstype="$(findmnt -n -o FSTYPE --target /run 2>/dev/null || true)"
[ "$run_fstype" = tmpfs ] || {
	echo "/run is not a tmpfs; refusing to install a policy that may survive reboot" >&2
	exit 1
}

login_user="${SUDO_USER:-}"
[ -n "$login_user" ] || {
	echo "SUDO_USER is unavailable; run this through sudo from the SSH account" >&2
	exit 1
}
login_uid="$(id -u "$login_user")"

cleanup_on_error() {
	if [ "${setup_succeeded:-0}" -ne 1 ]; then
		if [ "${policy_installed:-0}" -eq 1 ]; then
			rm -f -- "$POLICY_FILE"
		fi
		[ -z "${policy_tmp:-}" ] || rm -f -- "$policy_tmp"
		[ -z "${include_tmp:-}" ] || rm -f -- "$include_tmp"
		if [ "${include_created:-0}" -eq 1 ]; then
			rm -f -- "$INCLUDE_FILE"
		fi
	fi
}
trap cleanup_on_error EXIT

install -d -o root -g root -m 0750 "$RUNTIME_DIR"
chmod 0750 "$RUNTIME_DIR"
chown root:root "$RUNTIME_DIR"

policy_tmp="$(mktemp "$RUNTIME_DIR/.policy.XXXXXX")"
printf '#%s ALL=(ALL:ALL) NOPASSWD: ALL\n' "$login_uid" > "$policy_tmp"
chown root:root "$policy_tmp"
chmod 0440 "$policy_tmp"
visudo -cf "$policy_tmp" >/dev/null
install -o root -g root -m 0440 "$policy_tmp" "$POLICY_FILE"
policy_installed=1
rm -f -- "$policy_tmp"
policy_tmp=""

include_tmp="$(mktemp)"
printf '%s\n@includedir %s\n' "$INCLUDE_MARKER" "$RUNTIME_DIR" > "$include_tmp"
chown root:root "$include_tmp"
chmod 0440 "$include_tmp"

include_created=0
if [ -e "$INCLUDE_FILE" ]; then
	cmp -s "$include_tmp" "$INCLUDE_FILE" || {
		echo "refusing to overwrite an existing $INCLUDE_FILE" >&2
		exit 1
	}
else
	install -o root -g root -m 0440 "$include_tmp" "$INCLUDE_FILE"
	include_created=1
fi
rm -f -- "$include_tmp"
include_tmp=""

visudo -cf /etc/sudoers >/dev/null
setup_succeeded=1
