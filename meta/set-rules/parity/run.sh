#!/usr/bin/env bash
# Parity harness: run the Python original (meta/set-rules.py) and the Go port
# (meta/set-rules) on identical fresh fixtures and diff stdout, stderr, exit
# code, and the project's post-state.
#
# Isolation:
#   - every fixture is a fresh temp tree; HOME points into it, so the rule
#     source is <home>/.agents/rules-optional and nothing touches the real
#     home. The original hardcodes SKILL_SOURCE_ROOT=/home/easydev/.agents/
#     skills-optional; that path is read-only for both.
#   - the original is copied to <temp>/orig/set-rules so argv[0]'s base name
#     matches the Go binary's (`Usage: set-rules ...`).
#   - interactive cases run under `script` (a real PTY) with keys piped in;
#     only the summary block, the abort line, the exit code, and the project
#     tree are compared, since Bubble Tea's frame bytes differ by design.
#
# Usage: meta/set-rules/parity/run.sh
# Exit: 0 all cases identical; 1 a case differs (diff printed); 2 missing tool.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
module_dir=$(dirname "$script_dir")           # .../meta/set-rules
scripts_root=$(cd "$module_dir/../.." && pwd) # .../.local/share/scripts
original="$scripts_root/meta/set-rules.py"

# Agent markers change nothing here, but both implementations must see the
# same plain environment.
unset AI_AGENT PI_CODING_AGENT CLAUDECODE CLAUDE_CODE_ENTRYPOINT NO_COLOR 2>/dev/null || true

for tool in python3 go; do
  command -v "$tool" >/dev/null 2>&1 || { echo "parity: $tool is required" >&2; exit 2; }
done
[[ -f "$original" ]] || { echo "parity: missing $original" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/set-rules-parity.XXXXXX") || exit 2
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/orig" "$work/cases" "$work/logs"
cp "$original" "$work/orig/set-rules" || exit 2

go build -C "$module_dir" -o "$work/set-rules" . || { echo "parity: go build failed" >&2; exit 2; }

# --- fixtures --------------------------------------------------------------

rules_fixture="$work/fixtures/rules"
mkdir -p "$rules_fixture/nested"
printf -- '---\ndescription: Alpha rule\n---\nbody\n' > "$rules_fixture/alpha.md"
printf -- '# no frontmatter\n' > "$rules_fixture/plain.md"
printf -- '---\ndescription: Svelte stack\n---\n' > "$rules_fixture/stack-svelte.md"
printf -- '---\ndescription: Tauri stack\n---\n' > "$rules_fixture/stack-tauri.md"
printf -- '---\ndescription: Always loaded\nload: always\n---\n' > "$rules_fixture/load-always.md"
printf -- '---\ndescription: Nested rule\n---\n' > "$rules_fixture/nested/beta.md"
empty_fixture="$work/fixtures/empty"
mkdir -p "$empty_fixture"

export NO_COLOR=1
export COLUMNS=100 LINES=24 # shutil.get_terminal_size reads these

failures=0
pass_case() { printf '%-28s same\n' "$1"; }
fail_case() { # name, files...
  failures=$((failures + 1))
  printf '%-28s DIFF\n' "$1"
  shift
  local f
  for f in "$@"; do
    echo "    --- $f"
    diff -u "$f.orig" "$f.go" 2>/dev/null | sed -n '1,20p' | sed 's/^/    /'
  done
}

# --- environment per case --------------------------------------------------

make_home() { # $1 dir, $2 fixture
  mkdir -p "$1/.agents"
  case "$2" in
    rules) cp -a "$rules_fixture" "$1/.agents/rules-optional" ;;
    empty) mkdir -p "$1/.agents/rules-optional" ;;
    none) : ;;
  esac
}

setup_project() { # $1 setup name, $2 project dir, $3 home
  mkdir -p "$2"
  case "$1" in
    plain) : ;;
    linked)
      mkdir -p "$2/.agents/rules-routed"
      ln -s "$3/.agents/rules-optional/alpha.md" "$2/.agents/rules-routed/alpha.md"
      ;;
    linked-always)
      mkdir -p "$2/.agents/rules"
      ln -s "$3/.agents/rules-optional/stack-svelte.md" "$2/.agents/rules/stack-svelte.md"
      ;;
    conflict)
      mkdir -p "$2/.agents/rules-routed"
      printf 'real file\n' > "$2/.agents/rules-routed/alpha.md"
      ;;
    file) printf 'not a directory\n' > "$2/../projects-file" ;;
  esac
}

args_for() { # $1 case, $2 project dir
  case "$1" in
    help) printf '%s\n' --help ;;
    help_short) printf '%s\n' -h ;;
    two_args) printf '%s\n' a b ;;
    missing_project) printf '%s\n' /nonexistent/set-rules-parity-proj ;;
    tilde) printf '%s\n' '~/proj' ;;
    project_is_file) printf '%s\n' "$2/../projects-file" ;;
    *) printf '%s\n' "$2" ;;
  esac
}

normalize() { # $1 text file, $2 root
  sed -e "s|$2|@ROOT@|g" -e "s|$work/fixtures/rules|@RULES@|g" "$1"
}

snapshot() { # $1 project dir
  ( cd "$1" 2>/dev/null || exit 0
    find . -mindepth 1 \
      \( -type l -printf 'L %p -> %l\n' \) -o \
      \( -type d -printf 'D %p\n' \) -o \
      \( -type f -printf 'F %p\n' \) 2>/dev/null | LC_ALL=C sort
  )
}

# --- non-interactive cases -------------------------------------------------

run_case() { # $1 case, $2 fixture, $3 setup
  local case_name=$1 fixture=$2 setup=$3 impl root args_file
  for impl in orig go; do
    root="$work/cases/$case_name/$impl"
    rm -rf "$root"
    mkdir -p "$root"
    root=$(cd "$root" && pwd)
    make_home "$root/home" "$fixture"
    setup_project "$setup" "$root/proj" "$root/home"
    mapfile -t args < <(args_for "$case_name" "$root/proj")
    local cmd
    if [[ $impl == orig ]]; then
      cmd=(python3 -I "$work/orig/set-rules")
    else
      cmd=("$work/set-rules")
    fi
    ( cd "$root/proj" && env HOME="$root/home" "${cmd[@]}" "${args[@]}" ) \
      > "$root/out" 2> "$root/err"
    echo $? > "$root/code"
    snapshot "$root/proj" > "$root/state"
    for stream in out err code state; do
      normalize "$root/$stream" "$root" > "$root/$stream.norm"
    done
  done

  local same=1
  for stream in out err code state; do
    if ! diff -q "$work/cases/$case_name/orig/$stream.norm" "$work/cases/$case_name/go/$stream.norm" >/dev/null 2>&1; then
      same=0
      cp "$work/cases/$case_name/orig/$stream.norm" "$work/logs/$case_name.$stream.orig"
      cp "$work/cases/$case_name/go/$stream.norm" "$work/logs/$case_name.$stream.go"
    fi
  done
  if [[ $same -eq 1 ]]; then
    pass_case "$case_name"
  else
    fail_case "$case_name" \
      "$work/logs/$case_name.out.orig" "$work/logs/$case_name.out.go" \
      "$work/logs/$case_name.err.orig" "$work/logs/$case_name.err.go" \
      "$work/logs/$case_name.code.orig" "$work/logs/$case_name.code.go" \
      "$work/logs/$case_name.state.orig" "$work/logs/$case_name.state.go"
  fi
}

run_case help rules plain
run_case help_short rules plain
run_case two_args rules plain
run_case missing_project rules plain
run_case project_is_file rules plain
run_case no_tty_plain rules plain
run_case no_tty_linked rules linked
run_case tilde rules plain
run_case missing_rule_root none plain
run_case empty_rule_root empty plain
run_case conflict_project rules conflict

# --- interactive cases (real PTY) -----------------------------------------

clean_stream() { # $1 output file: drop CR and the renderer's escape codes
  perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g; s/\e[()][A-Za-z0-9]//g; s/\r//g' "$1"
}

summary_of() { # $1 output file
  clean_stream "$1" | awk '/Target project: /{found=1} found' |
    sed -e 's/[[:space:]]*$//'
}

signature_of() { # $1 output file
  local summary
  summary=$(summary_of "$1")
  if [[ -n $summary ]]; then
    printf '%s\n' "$summary"
  elif clean_stream "$1" | grep -q '^Cancelled\.$'; then
    printf 'CANCELLED\n'
  else
    printf 'NONE\n'
  fi
}

run_pty_case() { # $1 case, $2 fixture, $3 setup, $4 keys
  local case_name=$1 fixture=$2 setup=$3 keys=$4 impl root
  for impl in orig go; do
    root="$work/cases/$case_name/$impl"
    rm -rf "$root"
    mkdir -p "$root"
    root=$(cd "$root" && pwd)
    make_home "$root/home" "$fixture"
    setup_project "$setup" "$root/proj" "$root/home"
    local cmd
    if [[ $impl == orig ]]; then
      cmd="env HOME=$(printf '%q' "$root/home") python3 -I $(printf '%q' "$work/orig/set-rules") $(printf '%q' "$root/proj")"
    else
      cmd="env HOME=$(printf '%q' "$root/home") $(printf '%q' "$work/set-rules") $(printf '%q' "$root/proj")"
    fi
    { sleep 0.4; printf '%b' "$keys"; } |
      timeout 30 script -qec "$cmd" /dev/null > "$root/raw" 2>&1
    echo $? > "$root/code"
    signature_of "$root/raw" | normalize /dev/stdin "$root" > "$root/sig"
    snapshot "$root/proj" | normalize /dev/stdin "$root" > "$root/state"
  done

  local same=1 stream
  for stream in sig code state; do
    if ! diff -q "$work/cases/$case_name/orig/$stream" "$work/cases/$case_name/go/$stream" >/dev/null 2>&1; then
      same=0
      cp "$work/cases/$case_name/orig/$stream" "$work/logs/$case_name.$stream.orig"
      cp "$work/cases/$case_name/go/$stream" "$work/logs/$case_name.$stream.go"
    fi
  done
  if [[ $same -eq 1 ]]; then
    pass_case "$case_name"
  else
    fail_case "$case_name" \
      "$work/logs/$case_name.sig.orig" "$work/logs/$case_name.sig.go" \
      "$work/logs/$case_name.code.orig" "$work/logs/$case_name.code.go" \
      "$work/logs/$case_name.state.orig" "$work/logs/$case_name.state.go"
  fi
}

if command -v script >/dev/null 2>&1; then
  run_pty_case pty_apply linked_unchanged linked '\r'
  run_pty_case pty_abort linked linked 'q'
  run_pty_case pty_toggle_all rules plain 'a\r'
  run_pty_case pty_toggle_one rules plain 'j \r'
  run_pty_case pty_mode_move linked_always linked-always 'jm\r'
else
  echo "script(1) missing: interactive cases skipped" >&2
fi

echo
if [[ $failures -eq 0 ]]; then
  echo "all cases identical"
  exit 0
fi
echo "$failures case(s) differ; expected differences belong in meta/set-rules/README.md (Changelog)"
echo "artifacts kept: $work/logs"
trap - EXIT
exit 1
