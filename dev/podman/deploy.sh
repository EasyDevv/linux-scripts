#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

usage() {
	cat <<'EOF'
Usage: podman-deploy [options] [project-dir]

Deploy a Podman container project to a Tailscale remote node.
Requires a one-time `podman-deploy --init` on the remote host.

Options:
  -f, --force   Skip no-change detection, force full deploy
  --skip-caddy  Skip remote Caddy snippet sync

 Infrastructure config: $XDG_DATA_HOME/scripts/dev/podman-deploy.conf
  PODMAN_SSH_HOST           (required)
  PODMAN_TAILSCALE_DOMAIN   (required)
  PODMAN_SSH_USER           (default: $USER)
  PODMAN_TAILSCALE_HOST     (default: remote hostname)

Project overrides (<project>/.env):
  PODMAN_PORT               (recommended — fallback: 3000)
  PODMAN_VOLUMES            (default: {name}-data:/app/data)
  PODMAN_EXTRA_ENV          (comma-separated KEY=val pairs)
  PODMAN_STOP_TIMEOUT       (default: 3 seconds)

Auto-derived from project:
  PODMAN_IMAGE_NAME         from package.json .name, else directory name
  PODMAN_BASE_PATH          /{PODMAN_IMAGE_NAME} (Caddy reverse proxy path)
  PODMAN_BIND_ADDR          127.0.0.1 (localhost, for Caddy reverse proxy)
EOF
}

FORCE=""
SKIP_CADDY=""
PROJECT_DIR="."
for arg in "${@}"; do
	case "$arg" in
		-f|--force) FORCE=1 ;;
		--skip-caddy) SKIP_CADDY=1 ;;
		-h|--help)  usage; exit 0 ;;
		-*)         echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
		*)          PROJECT_DIR="$arg" ;;
	esac
done

podman_load_context "$PROJECT_DIR"

PODMAN_PORT="${PODMAN_PORT:-3000}"
if [ "${PODMAN_PORT}" = "3000" ]; then
	echo "  (hint: set PODMAN_PORT in project .env to override default 3000)" >&2
fi

PODMAN_VOLUMES="${PODMAN_VOLUMES:-${PODMAN_IMAGE_NAME}-data:/app/data}"
PODMAN_STOP_TIMEOUT="${PODMAN_STOP_TIMEOUT:-3}"
PODMAN_SERVICE_STOP_TIMEOUT=$((PODMAN_STOP_TIMEOUT + 5))
REMOTE_DIR="~/${PODMAN_IMAGE_NAME}"
REMOTE_OCI_DIR="${REMOTE_DIR}/oci"

# ── Quadlet env lines ──
QUADLET_ENV_LINES="Environment=ORIGIN=${ORIGIN}
Environment=PORT=${PODMAN_PORT}
"
if [ -n "${PODMAN_EXTRA_ENV:-}" ]; then
	IFS=',' read -ra EXTRA_ENVS <<< "$PODMAN_EXTRA_ENV"
	for e in "${EXTRA_ENVS[@]}"; do
		QUADLET_ENV_LINES+="Environment=${e}
"
	done
fi

# ── Quadlet volume lines ──
QUADLET_VOLUME_LINES=""
for v in ${PODMAN_VOLUMES}; do
	QUADLET_VOLUME_LINES+="Volume=${v}:Z
"
done

DESIRED_QUADLET_CONTENT=$(cat <<EOF
[Unit]
Description=${PODMAN_IMAGE_NAME} container
After=network-online.target

[Container]
Image=localhost/${PODMAN_IMAGE_NAME}:latest
ContainerName=${PODMAN_IMAGE_NAME}
PublishPort=${PODMAN_BIND_ADDR}:${PODMAN_PORT}:${PODMAN_PORT}
StopTimeout=${PODMAN_STOP_TIMEOUT}
${QUADLET_VOLUME_LINES}${QUADLET_ENV_LINES}

[Service]
Restart=always
RestartSec=10s
TimeoutStopSec=${PODMAN_SERVICE_STOP_TIMEOUT}s

[Install]
WantedBy=default.target
EOF
)

DESIRED_CADDY_SNIPPET="$(podman_build_caddy_snippet)"

DESIRED_QUADLET_SHA="$(printf '%s\n' "${DESIRED_QUADLET_CONTENT}" | sha256sum | cut -d' ' -f1)"
DESIRED_CADDY_SHA="$(printf '%s\n' "${DESIRED_CADDY_SNIPPET}" | sha256sum | cut -d' ' -f1)"

# ── print summary ──
echo "──────────────────────────────"
echo " project:   $PROJECT_DIR"
echo " image:     $PODMAN_IMAGE_NAME"
echo " port:      $PODMAN_PORT"
echo " remote:    ${PODMAN_SSH_USER}@${PODMAN_SSH_HOST}"
echo " bind:      ${PODMAN_BIND_ADDR}:${PODMAN_PORT}"
echo " origin:    $ORIGIN"
echo " volumes:   $PODMAN_VOLUMES"
echo " stop:      ${PODMAN_STOP_TIMEOUT}s"
echo "──────────────────────────────"

# ── SSH multiplexing ──
podman_init_ssh_transport "$PODMAN_IMAGE_NAME"

OCI_DIR="/tmp/podman-deploy-oci-${PODMAN_IMAGE_NAME}"
REMOTE_STOP_CMD="systemctl --user stop ${PODMAN_IMAGE_NAME}"
REMOTE_LEGACY_STOP_CMD="systemctl --user stop container-${PODMAN_IMAGE_NAME}"
cleanup() {
	podman_close_ssh_transport
	[ -n "${OCI_DIR:-}" ] && rm -rf "$OCI_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── timing ──
ts_ms() {
	local epoch=${EPOCHREALTIME/./}
	printf '%s\n' "$((epoch / 1000))"
}

print_elapsed() {
	local label=$1
	local start_ms=$2
	printf '  %s: %sms\n' "$label" "$(( $(ts_ms) - start_ms ))"
}

TOTAL_T0=$(ts_ms)

# warm up control master (background)
podman_warm_ssh_transport

# ── Phase 1: Build ──
echo "=== Build ==="
PHASE_T0=$(ts_ms)
IMAGE_ID="$(podman build -q --pull=never -t "${PODMAN_IMAGE_NAME}:latest" "$PROJECT_DIR")"
echo "  image: ${IMAGE_ID:0:12}"
print_elapsed "Build" "$PHASE_T0"

NEED_IMAGE_SYNC=1
NEED_CONFIG_SYNC=1

# ── no-change detection: skip only when image + generated config both match ──
if [ -z "$FORCE" ]; then
	REMOTE_ID=$(podman_remote "podman image inspect localhost/${PODMAN_IMAGE_NAME}:latest --format '{{.Id}}' 2>/dev/null || echo ''")
	if [ -n "$IMAGE_ID" ] && [ "$IMAGE_ID" = "$REMOTE_ID" ]; then
		NEED_IMAGE_SYNC=0
	fi

	read -r REMOTE_QUADLET_SHA REMOTE_CADDY_SHA REMOTE_HELPER_PRESENT REMOTE_CADDY_READY <<EOF
$(podman_remote bash -s <<REMOTE_STATE
set -euo pipefail

quadlet_sha=""
caddy_sha=""
helper_present=0
caddy_ready=0

if [ -f "\$HOME/.config/containers/systemd/${PODMAN_IMAGE_NAME}.container" ]; then
	quadlet_sha="\$(sha256sum "\$HOME/.config/containers/systemd/${PODMAN_IMAGE_NAME}.container" | cut -d' ' -f1)"
fi

if [ -x /usr/local/bin/podman-sync-caddy-site ]; then
	helper_present=1
fi

if [ -f "/etc/caddy/conf.d/${PODMAN_IMAGE_NAME}.caddy" ]; then
	caddy_sha="\$(sha256sum "/etc/caddy/conf.d/${PODMAN_IMAGE_NAME}.caddy" | cut -d' ' -f1)"
fi

if systemctl is-active --quiet caddy; then
	caddy_ready=1
fi

printf '%s %s %s %s\n' "\${quadlet_sha}" "\${caddy_sha}" "\${helper_present}" "\${caddy_ready}"
REMOTE_STATE
)
EOF

	if [ -n "$SKIP_CADDY" ]; then
		REMOTE_HELPER_PRESENT=1
		REMOTE_CADDY_READY=1
		REMOTE_CADDY_SHA="$DESIRED_CADDY_SHA"
	fi

	if [ "$REMOTE_QUADLET_SHA" = "$DESIRED_QUADLET_SHA" ] && \
	   [ "$REMOTE_CADDY_SHA" = "$DESIRED_CADDY_SHA" ] && \
	   [ "$REMOTE_HELPER_PRESENT" = "1" ] && \
	   [ "$REMOTE_CADDY_READY" = "1" ]; then
		NEED_CONFIG_SYNC=0
	fi

	if [ "$NEED_IMAGE_SYNC" = "0" ] && [ "$NEED_CONFIG_SYNC" = "0" ]; then
		echo "  (image + generated config already match remote — nothing to deploy)"
		print_elapsed "Total" "$TOTAL_T0"
		exit 0
	fi
fi

if [ "$NEED_IMAGE_SYNC" = "1" ]; then
	# ── Phase 2: Export image to OCI directory (content-addressed blobs) ──
	echo "=== Export OCI ==="
	PHASE_T0=$(ts_ms)
	rm -rf "$OCI_DIR"
	podman push -q "${PODMAN_IMAGE_NAME}:latest" "oci:${OCI_DIR}:latest"
	print_elapsed "Export" "$PHASE_T0"
else
	echo "=== Export OCI ==="
	echo "  skipped: image already on remote"
fi

if [ "$NEED_IMAGE_SYNC" = "1" ]; then
	# ── Phase 3: rsync OCI to remote (only new/changed blobs transferred) ──
	echo "=== Transfer ==="
	PHASE_T0=$(ts_ms)
	rsync -a --delete \
		--rsync-path="mkdir -p ${REMOTE_OCI_DIR} && rsync" \
		-e "ssh -o ControlMaster=auto -o ControlPath=${SSH_CTRL} -o ControlPersist=300 -o ConnectTimeout=5" \
		"${OCI_DIR}/" \
		"${SSH_DEST}:${REMOTE_OCI_DIR}/"
	print_elapsed "Transfer" "$PHASE_T0"
else
	echo "=== Transfer ==="
	echo "  skipped: image already on remote"
fi

# ── Phase 4: Stop old container, load image, write Quadlet, start ──
echo "=== Activate ==="
PHASE_T0=$(ts_ms)
PULLED_ID=$(podman_remote bash -s << REMOTE_CMD
set -euo pipefail

OCI_PATH_REMOTE="\$HOME/${PODMAN_IMAGE_NAME}/oci"

# Stop old Quadlet service first (if exists)
if command -v timeout &>/dev/null; then
	timeout ${PODMAN_SERVICE_STOP_TIMEOUT}s ${REMOTE_STOP_CMD} &>/dev/null || true
	timeout ${PODMAN_SERVICE_STOP_TIMEOUT}s ${REMOTE_LEGACY_STOP_CMD} &>/dev/null || true
else
	${REMOTE_STOP_CMD} &>/dev/null || true
	${REMOTE_LEGACY_STOP_CMD} &>/dev/null || true
fi

# Also clean up old-style systemd unit from pre-Quadlet deploys
podman rm -f -t ${PODMAN_STOP_TIMEOUT} ${PODMAN_IMAGE_NAME} &>/dev/null || true

if [ "${NEED_IMAGE_SYNC}" = "1" ]; then
	PULLED_ID="\$(podman pull -q oci:\${OCI_PATH_REMOTE}:latest)"
	[ -n "\$PULLED_ID" ]
	podman tag "\$PULLED_ID" localhost/${PODMAN_IMAGE_NAME}:latest
else
	PULLED_ID="\$(podman image inspect localhost/${PODMAN_IMAGE_NAME}:latest --format '{{.Id}}')"
	[ -n "\$PULLED_ID" ]
fi

mkdir -p ~/.config/containers/systemd/

cat > ~/.config/containers/systemd/${PODMAN_IMAGE_NAME}.container << 'QUADLET_EOF'
${DESIRED_QUADLET_CONTENT}
QUADLET_EOF

# Clean up old-style systemd unit + broken symlink from pre-Quadlet deploys
rm -f ~/.config/systemd/user/container-${PODMAN_IMAGE_NAME}.service
rm -f ~/.config/systemd/user/default.target.wants/container-${PODMAN_IMAGE_NAME}.service

systemctl --user daemon-reload
systemctl --user start ${PODMAN_IMAGE_NAME}
loginctl enable-linger 2>/dev/null || true

printf '%s\n' "\$PULLED_ID"
REMOTE_CMD
)

if [ -z "$PULLED_ID" ]; then
	echo "ERROR: podman pull oci: failed to extract image ID" >&2
	exit 1
fi
echo "  image: ${PULLED_ID:0:12}"
print_elapsed "Activate" "$PHASE_T0"

echo "=== Sync Caddy ==="
PHASE_T0=$(ts_ms)
if [ -n "$SKIP_CADDY" ]; then
	echo "  skipped: requested by --skip-caddy"
else
	if ! podman_remote sudo -n /usr/local/bin/podman-sync-caddy-site \
		apply \
		"${PODMAN_IMAGE_NAME}" \
		"${PODMAN_BASE_PATH}" \
		"${PODMAN_BIND_ADDR}" \
		"${PODMAN_PORT}"; then
		echo "ERROR: remote Caddy sync failed. Run podman-deploy --init on ${PODMAN_DOMAIN} first." >&2
		exit 1
	fi
fi
print_elapsed "Caddy" "$PHASE_T0"

echo "Done → ${ORIGIN}"
print_elapsed "Total" "$TOTAL_T0"
