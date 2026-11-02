#!/usr/bin/env bash
# Parity harness: run the Python original (dev/netbird/netbird-setup.py) and the
# Go port (dev/netbird/go) on identical temp fixtures and diff stdout, stderr,
# exit code, and the files each run produced.
#
# Isolation (nothing real is touched):
#   - every invocation runs as `timeout 20 <cmd> ... </dev/null`, so a prompt
#     that appears where the original would read a name cannot hang the run;
#     the two interactive cases run under `script` (a real PTY) with keys piped
#     in, also under `timeout 20`,
#   - each implementation gets its own copy of the module directory inside
#     $work, so SCRIPT_DIR / KEYS_PATH / .data never point at the real tree,
#   - HOME and XDG_* point into $work; NETBIRD_SETUP_ROOT points at the copy;
#     NETBIRD_API_KEY is a dummy PAT, so no real token or setup key is read,
#   - the management API is a local stdlib fake on 127.0.0.1 that logs every
#     request (method, path, headers, body) and mints a deterministic key, so
#     both sides see the same answer and the wire format is compared,
#   - https_proxy points at a closed port and no_proxy covers 127.0.0.1, so the
#     MSI download always fails locally and neither implementation reaches
#     pkgs.netbird.io; nothing is written outside $work, and --dest always
#     points at a temp directory (never a block device).
#
# The original has no API-URL flag: it takes NETBIRD_MANAGEMENT_URL from the
# environment (or dev/.env.netbird), so both sides are pointed at the fake with
# that variable and no source change on either side.
#
# Usage: dev/netbird/go/parity/run.sh [case ...]
# Exit: 0 all cases identical; 1 a case differs (diff printed); 2 missing tool.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
module_dir=$(dirname "$script_dir")             # .../dev/netbird/go
netbird_dir=$(dirname "$module_dir")            # .../dev/netbird
original_py="$netbird_dir/netbird-setup.py"

# An agent environment changes nothing here, but ship's harness drops the
# markers too; keep both implementations on the same plain env.
unset AI_AGENT PI_CODING_AGENT CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true

for tool in python3 go; do
  command -v "$tool" >/dev/null 2>&1 || { echo "parity: $tool is required" >&2; exit 2; }
done
[[ -f $original_py ]] || { echo "parity: missing $original_py" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/netbird-parity.XXXXXX") || exit 2
cleanup() {
  [[ -n ${server_pid:-} ]] && kill "$server_pid" 2>/dev/null
  rm -rf "${work:-}"
}
trap cleanup EXIT
mkdir -p "$work/logs" "$work/home"

go build -C "$module_dir" -o "$work/netbird-setup" . || { echo "parity: go build failed" >&2; exit 2; }

# --- fake management API ---------------------------------------------------

cat > "$work/fake_api.py" <<'FAKE'
import json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

log_path = sys.argv[1]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def record(self, body):
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "method": self.command,
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "accept": self.headers.get("Accept"),
                "accept_encoding": self.headers.get("Accept-Encoding"),
                "connection": self.headers.get("Connection"),
                "user_agent": self.headers.get("User-Agent"),
                "content_type": self.headers.get("Content-Type"),
                "body": body.decode() if body else None,
            }, sort_keys=True) + "\n")

    def reply(self, payload, status=200):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.record(b"")
        if self.path.startswith("/api/groups"):
            if self.headers.get("Authorization") == "Token bad":
                self.reply({"message": "unauthorized"}, 401)
                return
            self.reply([{"id": "grp1", "name": "employees"}])
            return
        self.reply({"message": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        self.record(body)
        if self.path == "/api/setup-keys":
            name = json.loads(body).get("name", "KEY")
            self.reply({"key": "minted-secret-%s" % name, "name": name}, 201)
            return
        self.reply({"message": "not found"}, 404)


server = HTTPServer(("127.0.0.1", 0), Handler)
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write(str(server.server_address[1]))
threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Event().wait()
FAKE

python3 -I "$work/fake_api.py" "$work/api.log" "$work/api.port" &
server_pid=$!
for _ in $(seq 1 100); do
  [[ -s $work/api.port ]] && break
  sleep 0.05
done
if [[ ! -s $work/api.port ]]; then
  echo "parity: fake API did not start" >&2
  exit 2
fi
api_url="http://127.0.0.1:$(cat "$work/api.port")"

# --- fixtures --------------------------------------------------------------

prepare_env() { # $1 impl
  local impl=$1 root="$work/fix/$1/netbird"
  mkdir -p "$root" "$work/home/$impl"
  cp "$original_py" "$root/netbird-setup.py"
  cp -r "$netbird_dir/windows" "$root/windows"
  cp "$netbird_dir/README.md" "$root/README.md"
  export HOME="$work/home/$impl"
  export XDG_CONFIG_HOME="$work/home/$impl/.config"
  export NETBIRD_SETUP_ROOT="$root"
  export NETBIRD_MANAGEMENT_URL="$api_url"
  export NETBIRD_API_KEY="pat-test"
  export https_proxy="http://127.0.0.1:1" HTTPS_PROXY="http://127.0.0.1:1"
  export http_proxy="http://127.0.0.1:1" HTTP_PROXY="http://127.0.0.1:1"
  export no_proxy="127.0.0.1,localhost" NO_PROXY="127.0.0.1,localhost"
  export NO_COLOR=1
  : > "$work/api.log"
}

# run_bin: one non-TTY invocation, always bounded and never waiting on input.
run_bin() { # $1 impl, rest args
  local impl=$1
  shift
  case "$impl" in
    orig) timeout 20 python3 -I "$work/fix/orig/netbird/netbird-setup.py" "$@" </dev/null ;;
    go) timeout 20 "$work/netbird-setup" "$@" </dev/null ;;
  esac
}

# run_pty: one PTY invocation. $1 impl, $2 keys to type, rest args.
run_pty() { # $1 impl, $2 keys, rest args
  local impl=$1 keys=$2 cmd
  shift 2
  case "$impl" in
    orig)
      cmd="env -u NO_COLOR python3 -I $(printf '%q' "$work/fix/orig/netbird/netbird-setup.py")"
      ;;
    go)
      cmd="env -u NO_COLOR $(printf '%q' "$work/netbird-setup")"
      ;;
  esac
  local arg
  for arg in "$@"; do
    cmd+=" $(printf '%q' "$arg")"
  done
  { sleep 0.7; printf '%b' "$keys"; } |
    timeout 20 script -qec "$cmd" /dev/null 2>&1
}

seed() { # $1 impl, $2 keys text
  local keys="$work/fix/$1/netbird/.env.netbird.setup.keys"
  printf '%s' "$2" > "$keys"
  chmod 600 "$keys"
}

normalize() { # $1 impl, stdin -> stdout
  sed -E \
    -e "s|$work/fix/$1/netbird|<MODULE>|g" \
    -e "s|$work/home/$1|<HOME>|g" \
    -e "s|$api_url|<API>|g" \
    -e "s|$work|<WORK>|g"
}

# normalize_pty keeps only the result lines of a terminal transcript: the
# picker frames and prompts of the two implementations differ by design
# (raw-mode redraw vs Bubble Tea), the outcome must not.
normalize_pty() { # $1 impl, stdin -> stdout
  sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' -e 's/\x1b\][^\x07]*\x07//g' -e 's/\r//g' |
    grep -aoE '(issued|error|PASS|PLAN|CHANGE|wrote|warning|no setup keys).*' |
    normalize "$1"
}

capture_state() { # $1 impl
  local root="$work/fix/$1/netbird"
  {
    echo "== keys"
    sed -e 's/^\([A-Z][A-Z0-9_]*\)=.*/\1=<VALUE>/' "$root/.env.netbird.setup.keys" 2>/dev/null || echo '(none)'
    echo "== employees env"
    sed -e 's/^\([A-Z][A-Z0-9_]*\)=.*/\1=<VALUE>/' "$root/employees.env" 2>/dev/null || echo '(none)'
    echo "== keys mode"
    stat -c '%a' "$root/.env.netbird.setup.keys" 2>/dev/null || echo '(none)'
    echo "== payload"
    for name in .env.netbird.setup.keys install-netbird.ps1 install-netbird.cmd README.md \
      netbird_installer_windows_amd64.msi; do
      for dir in "$root"/usb/netbird-setup "$root"/usb2/netbird-setup; do
        [[ -f $dir/$name ]] || continue
        printf '%s %s\n' "${dir#$root/}/$name" "$(sha256sum "$dir/$name" | cut -d' ' -f1)"
      done
    done
    echo "== api log"
    sed -e 's/"authorization": "Token [^"]*"/"authorization": "Token <TOKEN>"/' \
      -e 's/"authorization": null/"authorization": <NONE>/' \
      -e 's/"user_agent": "[^"]*"/"user_agent": "<UA>"/' \
      -e 's/"user_agent": null/"user_agent": <NONE>/' "$work/api.log" 2>/dev/null
  }
}

failures=0

# tell_case reports one case on one line and prints the diffs under it.
tell_case() { # $1 case, $2 status, $3 exit code, rest differing streams
  local case_name=$1 status=$2 code=$3 stream
  shift 3
  if [[ $status == same ]]; then
    printf '%-28s same   (exit %s)\n' "$case_name" "$code"
    return
  fi
  printf '%-28s DIFF   (exit %s; %s)\n' "$case_name" "$code" "$*"
  for stream in "$@"; do
    diff -u --label "orig.$stream" --label "go.$stream" \
      "$work/logs/$case_name/orig.$stream.norm" "$work/logs/$case_name/go.$stream.norm" |
      sed -n '1,12p' | sed 's/^/    /'
  done
}

mkdir -p "$work/logs"

# run_case reads/writes per-case logs; give each case its own directory.
# $1 case, $2 seed text or -, $3 setup (none|msi_cache|payload_dir|bad_roster|
# roster_not_object), rest args (@DEST@, @ROSTER@, @PAYLOADDEST@ placeholders).
run_case() {
  local case_name=$1 seed_text=$2 setup=$3 impl stream
  shift 3
  [[ $seed_text == - ]] && seed_text=""
  mkdir -p "$work/logs/$case_name"
  for impl in orig go; do
    prepare_env "$impl"
    local root="$work/fix/$impl/netbird"
    rm -rf "$root/usb" "$root/usb2"
    mkdir -p "$root/usb" "$root/usb2"
    [[ -n $seed_text ]] && seed "$impl" "$seed_text"
    cat > "$root/roster.json" <<JSON
{"keys_path": "employees.env",
 "people": [{"email": "a@example.com", "pc": "GREEN_A_PC", "phone": "GREEN_A_PHONE"},
            {"email": "b@example.com", "pc": "GREEN_B_PC", "phone": "GREEN_B_PHONE"}]}
JSON
    cat > "$root/bad-roster.json" <<'JSON'
{"people": [{"pc": "GREEN_A_PC"}]}
JSON
    cat > "$root/list-roster.json" <<'JSON'
[{"pc": "GREEN_A_PC", "phone": "GREEN_A_PHONE"}]
JSON
    case "$setup" in
      msi_cache)
        # A cached installer must be copied, never downloaded.
        mkdir -p "$root/.data"
        printf 'fake-msi-bytes\n' > "$root/.data/netbird_installer_windows_amd64.msi"
        ;;
      payload_dir)
        mkdir -p "$root/usb/netbird-setup"
        ;;
    esac
    local -a impl_args=()
    local arg
    for arg in "$@"; do
      case "$arg" in
        @DEST@) impl_args+=("$root/usb") ;;
        @PAYLOADDEST@) impl_args+=("$root/usb/netbird-setup") ;;
        @ROSTER@) impl_args+=("$root/roster.json") ;;
        @BADROSTER@) impl_args+=("$root/bad-roster.json") ;;
        @LISTROSTER@) impl_args+=("$root/list-roster.json") ;;
        *) impl_args+=("$arg") ;;
      esac
    done
    ( run_bin "$impl" "${impl_args[@]}" ) > "$work/logs/$case_name/$impl.out" 2> "$work/logs/$case_name/$impl.err"
    echo "$?" > "$work/logs/$case_name/$impl.code"
    capture_state "$impl" > "$work/logs/$case_name/$impl.state" 2>&1
  done
  local -a differing=()
  for stream in out err code state; do
    normalize orig < "$work/logs/$case_name/orig.$stream" > "$work/logs/$case_name/orig.$stream.norm"
    normalize go < "$work/logs/$case_name/go.$stream" > "$work/logs/$case_name/go.$stream.norm"
    if ! diff -q "$work/logs/$case_name/orig.$stream.norm" \
      "$work/logs/$case_name/go.$stream.norm" >/dev/null; then
      differing+=("$stream")
    fi
  done
  if [[ ${#differing[@]} -eq 0 ]]; then
    tell_case "$case_name" same "$(cat "$work/logs/$case_name/orig.code")"
  else
    failures=$((failures + 1))
    tell_case "$case_name" DIFF "$(cat "$work/logs/$case_name/orig.code")" "${differing[@]}"
  fi
}

# run_pty_case compares the result lines, the exit code, and the post-state of
# one terminal session; frames and prompts are not compared.
run_pty_case() { # $1 case, $2 seed text, $3 keys to type, rest args
  local case_name=$1 seed_text=$2 keys=$3 impl stream
  shift 3
  [[ $seed_text == - ]] && seed_text=""
  mkdir -p "$work/logs/$case_name"
  for impl in orig go; do
    prepare_env "$impl"
    local root="$work/fix/$impl/netbird"
    rm -rf "$root/usb" "$root/usb2"
    mkdir -p "$root/usb" "$root/usb2"
    [[ -n $seed_text ]] && seed "$impl" "$seed_text"
    local -a impl_args=()
    local arg
    for arg in "$@"; do
      case "$arg" in
        @DEST@) impl_args+=("$root/usb") ;;
        *) impl_args+=("$arg") ;;
      esac
    done
    run_pty "$impl" "$keys" "${impl_args[@]}" > "$work/logs/$case_name/$impl.out" 2>&1
    echo "$?" > "$work/logs/$case_name/$impl.code"
    normalize_pty "$impl" < "$work/logs/$case_name/$impl.out" > "$work/logs/$case_name/$impl.out.norm"
    capture_state "$impl" > "$work/logs/$case_name/$impl.state" 2>&1
  done
  local -a differing=()
  for stream in out code state; do
    [[ $stream == out ]] && continue
    normalize orig < "$work/logs/$case_name/orig.$stream" > "$work/logs/$case_name/orig.$stream.norm"
    normalize go < "$work/logs/$case_name/go.$stream" > "$work/logs/$case_name/go.$stream.norm"
    if ! diff -q "$work/logs/$case_name/orig.$stream.norm" \
      "$work/logs/$case_name/go.$stream.norm" >/dev/null; then
      differing+=("$stream")
    fi
  done
  if ! diff -q "$work/logs/$case_name/orig.out.norm" "$work/logs/$case_name/go.out.norm" >/dev/null; then
    cp "$work/logs/$case_name/orig.out.norm" "$work/logs/$case_name/orig.result.norm"
    cp "$work/logs/$case_name/go.out.norm" "$work/logs/$case_name/go.result.norm"
    differing+=("result")
  fi
  if [[ ${#differing[@]} -eq 0 ]]; then
    tell_case "$case_name" same "$(cat "$work/logs/$case_name/orig.code")"
  else
    failures=$((failures + 1))
    tell_case "$case_name" DIFF "$(cat "$work/logs/$case_name/orig.code")" "${differing[@]}"
  fi
}

wanted=("$@")
selected() {
  local c
  [[ ${#wanted[@]} -eq 0 ]] && return 0
  for c in "${wanted[@]}"; do [[ $c == "$1" ]] && return 0; done
  return 1
}
run() {
  selected "$1" || return 0
  run_case "$@"
}
run_tty() {
  selected "$1" || return 0
  run_pty_case "$@"
}

echo "== netbird-setup parity (original: dev/netbird/netbird-setup.py, port: dev/netbird/go) =="
run help                  -                  none         --help
run no_command            -                  none
run issue_help            -                  none         issue -h
run usb_help              -                  none         usb -h
run list_help             -                  none         list -h
run employees_help        -                  none         employees -h
run invalid_command       -                  none         bogus
run unknown_flag          -                  none         --bogus
run version_flag          -                  none         --version
run issue_two_positionals -                  none         issue a b
run usb_missing_value     -                  none         usb --dest
run usb_value_is_flag     -                  none         usb --dest -h
run employees_value_flag  -                  none         employees --roster -h
run employees_no_roster   -                  none         employees
run list_empty            -                  none         list
run list_names            "GREEN_USER_01=hidden-secret
GREEN_ADMIN_PC=other
"                         none                         list
run issue_no_name         "GREEN_USER_01=abc
"                         none                         issue
run issue_existing_nontty "GREEN_USER_01=abc
"                         none                         issue GREEN_USER_01
run issue_replace_api     -                  none         issue --replace GREEN_USER_01
run issue_bad_name        -                  none         issue bad-name
run usb_no_dest           "GREEN_USER_01=abc
"                         none                         usb
run usb_dest              "GREEN_USER_01=usb-secret-key
GREEN_ADMIN_PC=other
"                         none                         usb --dest @DEST@
run usb_cached_msi        "GREEN_USER_01=abc
"                         msi_cache                    usb --dest @DEST@
run usb_payload_dir       "GREEN_USER_01=abc
"                         payload_dir                  usb --dest @PAYLOADDEST@
run employees_plan        "GREEN_A_PC=already
"                         none                         employees --roster @ROSTER@
run employees_apply       "GREEN_A_PC=already
"                         none                         employees --roster @ROSTER@ --apply
run employees_missing_field -                bad_roster   employees --roster @BADROSTER@
run employees_not_object  -                  bad_roster   employees --roster @LISTROSTER@
run employees_auto_group  -                  none         employees --roster @ROSTER@ --apply --auto-group staff

if command -v script >/dev/null 2>&1; then
  # A real PTY: the picker confirmation, and the typed key name. Both
  # implementations reach the fake API and write the same keys file; only the
  # drawn frames differ, which is why the result lines are compared.
  run_tty pty_issue_replace_yes "GREEN_USER_01=abc
"                         'j\r' issue GREEN_USER_01
  run_tty pty_issue_typed   "GREEN_USER_01=abc
"                         'GREEN_NEW_PC\r' issue
else
  echo "script(1) missing: the two PTY cases were skipped" >&2
fi

echo
if [[ $failures -eq 0 ]]; then
  echo "all cases identical"
  exit 0
fi
echo "$failures case(s) differ; expected differences belong in dev/netbird/go/README.md (Changelog)"
echo "artifacts kept for inspection: $work/logs"
trap - EXIT
kill "$server_pid" 2>/dev/null
exit 1
