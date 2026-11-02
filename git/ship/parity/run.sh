#!/usr/bin/env bash
# Parity harness: run the TS original (git/ship-ts/ship.ts) and the Go port (git/ship)
# on identical fresh fixtures and diff stdout, stderr, exit code, and the
# fixture's post-state.
#
# Isolation:
#   - every fixture is a fresh temp directory named .../repo (same basename),
#   - HOME and GIT_CONFIG_GLOBAL point into the temp tree, with user.name/email
#     and fixed commit dates so hashes are identical,
#   - https://github.com/ is rewritten to a local bare repository per run, so
#     no push ever reaches a real remote,
#   - a fake `gh` first on PATH logs its arguments and answers `api user`,
#     `repo view`, and `repo create`.
#
# Usage: git/ship/parity/run.sh [case ...]
# Exit: 0 all cases identical; 1 a case differs (diff printed); 2 missing tool.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
module_dir=$(dirname "$script_dir")           # .../git/ship
scripts_root=$(cd "$module_dir/../.." && pwd) # .../.local/share/scripts
original_rev=66e3183 # last commit with the TS original (git/ship-ts/)

# Bun disables/colors its own output when it sniffs an agent environment;
# drop the markers so both implementations see the same plain env.
unset AI_AGENT PI_CODING_AGENT CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true

for tool in git bun; do
  command -v "$tool" >/dev/null 2>&1 || { echo "parity: $tool is required" >&2; exit 2; }
done

work=$(mktemp -d "${TMPDIR:-/tmp}/ship-parity.XXXXXX") || exit 2
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home" "$work/logs" "$work/fakebin" "$work/orig"
for f in ship.ts picker.ts; do
  git -C "$scripts_root" show "$original_rev:git/ship-ts/$f" > "$work/orig/$f" || { echo "parity: cannot restore $f from $original_rev" >&2; exit 2; }
done
original="$work/orig/ship.ts"

go build -C "$module_dir" -o "$work/ship" . || { echo "parity: go build failed" >&2; exit 2; }

cat > "$work/fakebin/gh" <<'FAKE'
#!/usr/bin/env bash
# Fake gh: logs argv, answers api user / repo view / repo create.
set -uo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
case "${1:-} ${2:-}" in
  "api user")
    printf '%s\n' "${GH_LOGIN:-octocat}"
    ;;
  "repo view")
    full=${3:-}
    if grep -qxF "$full" "$GH_STATE_DIR/existing" 2>/dev/null; then
      printf 'https://github.com/%s\n' "$full"
    else
      echo "GraphQL: Could not resolve to a Repository with the name '$full'" >&2
      exit 1
    fi
    ;;
  "repo create")
    full=${3:-}
    printf '%s\n' "$full" >> "$GH_STATE_DIR/existing"
    printf 'Created repository %s on GitHub\n' "$full"
    ;;
  *)
    echo "fake gh: unhandled invocation: $*" >&2
    exit 1
    ;;
esac
FAKE
chmod +x "$work/fakebin/gh"
export PATH="$work/fakebin:$PATH"
export GIT_AUTHOR_DATE="2001-02-03T04:05:06 +0000"
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
export GIT_AUTHOR_NAME="Ship Test" GIT_AUTHOR_EMAIL="ship@example.test"
export GIT_COMMITTER_NAME="Ship Test" GIT_COMMITTER_EMAIL="ship@example.test"
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false
export GIT_PAGER=cat PAGER=cat GIT_EDITOR=true
export NO_COLOR=1

# --- fixture helpers -------------------------------------------------------

make_repo() {
  git init -q -b main .
  printf 'base\n' > base.txt
  git add base.txt
  git commit -q -m init
}

add_origin() { # $1 = bare repo name under $REMOTES
  git init -q --bare -b main "$REMOTES/$1.git"
  git remote add origin "file://$REMOTES/$1.git"
}

add_github_bare() { # $1 = owner/name, target of the https rewrite
  git init -q --bare -b main "$REMOTES/$1"
}

append_base() { printf 'change %s\n' "$1" >> base.txt; }

# --- setups ----------------------------------------------------------------

setup_empty() { :; }

setup_repo() { make_repo; }

setup_seven() {
  make_repo
  add_origin app
  local n=10 i=0 names=(alpha bravo charlie delta echo foxtrot golf)
  for name in "${names[@]}"; do
    if [[ $i -ge 5 ]]; then n=$((7 - i)); fi
    seq 1 "$n" > "$name.txt"
    i=$((i + 1))
  done
}

setup_binary() {
  make_repo
  add_origin app
  printf '\000\001\002binary\n' > blob.bin
}

setup_message() {
  make_repo
  add_origin app
  append_base one
}

setup_no_push() {
  make_repo
  add_origin app
  append_base one
}

setup_clean_unpushed() {
  make_repo
  add_origin app
  git push -q -u origin main
  append_base one
  git add base.txt
  git commit -q -m second
  append_base two
  git add base.txt
  git commit -q -m third
}

setup_push_no_upstream() {
  make_repo
  add_origin app
  append_base one
}

setup_clean_noop() {
  make_repo
  add_origin app
  git push -q -u origin main
}

setup_no_remote() { make_repo; }

setup_repo_flag_new() {
  make_repo
  add_github_bare octocat/repo
}

setup_repo_flag_public() {
  make_repo
  add_github_bare octocat/app2
}

setup_repo_sub_public() {
  make_repo
  add_github_bare octocat/my-app
}

setup_repo_existing() {
  make_repo
  add_github_bare octocat/repo
  git remote add origin https://github.com/octocat/repo
  printf 'octocat/repo\n' > "$GH_STATE_DIR/existing"
}

setup_repo_sub_extra() { make_repo; }

setup_db_ok() {
  make_repo
  add_origin app
  cat > package.json <<'JSON'
{
  "name": "fixture",
  "scripts": {
    "db:snapshot": "exit 0"
  }
}
JSON
  append_base one
}

setup_db_fail() {
  make_repo
  add_origin app
  cat > package.json <<'JSON'
{
  "name": "fixture",
  "scripts": {
    "db:snapshot": "exit 1"
  }
}
JSON
  append_base one
}

# --- env + run -------------------------------------------------------------

prepare_env() { # $1 impl, $2 case
  local impl=$1 case_name=$2 home
  home="$work/home/$impl"
  mkdir -p "$home"
  cat > "$home/.gitconfig" <<EOF
[user]
	name = Ship Test
	email = ship@example.test
[init]
	defaultBranch = main
[commit]
	gpgsign = false
[url "file://$work/remotes/$case_name/$impl/"]
	insteadOf = https://github.com/
[protocol]
	allow = always
[push]
	default = simple
[advice]
	detachedHead = false
EOF
  export HOME="$home"
  export GIT_CONFIG_GLOBAL="$home/.gitconfig"
  export REMOTES="$work/remotes/$case_name/$impl"
  export GH_STATE_DIR="$work/ghstate/$case_name/$impl"
  export GH_LOG="$work/logs/$case_name/$impl.gh"
  mkdir -p "$REMOTES" "$GH_STATE_DIR"
  : > "$GH_LOG"
}

run_bin() { # $1 impl, rest args
  local impl=$1
  shift
  case "$impl" in
    orig) bun "$original" "$@" ;;
    go) "$work/ship" "$@" ;;
  esac
}

normalize() { # $1 case, $2 impl, stdin -> stdout
  local case_name=$1 impl=$2
  sed -E \
    -e "s|$work/fix/$case_name/$impl|<FIX>|g" \
    -e "s|$work/remotes/$case_name/$impl|<REMOTES>|g" \
    -e "s|$work/ghstate/$case_name/$impl|<GHSTATE>|g" \
    -e "s|$work/home/$impl|<HOME>|g" \
    -e "s|$work/logs/$case_name/$impl|<LOGS>|g" \
    -e "s|$work|<WORK>|g" \
    -e "s|$scripts_root|<SCRIPTS>|g"
}

capture_state() { # $1 impl, $2 case, $3 fixture dir
  local impl=$1 case_name=$2 fix=$3 bare
  {
    echo "== head subject"
    git -C "$fix" log -1 --format='%s' 2>/dev/null || echo '(no commit)'
    echo "== status"
    git -C "$fix" status --porcelain 2>/dev/null || true
    echo "== remotes"
    git -C "$fix" remote -v 2>/dev/null || true
    echo "== gh argv"
    cat "$GH_LOG"
    echo "== bare refs"
    for bare in "$REMOTES"/*.git "$REMOTES"/octocat/*; do
      [[ -d $bare ]] || continue
      echo "-- ${bare#"$REMOTES"/}"
      git -C "$bare" for-each-ref --format='%(refname) %(objectname) %(subject)' 2>/dev/null || true
    done
  }
}

failures=0
declare -a table=()

run_case() { # $1 case name, $2 setup fn, rest args
  local case_name=$1 setup=$2 impl
  shift 2
  local args=("$@")
  local logs="$work/logs/$case_name"
  mkdir -p "$logs" "$work/fix/$case_name"
  for impl in orig go; do
    prepare_env "$impl" "$case_name"
    local fix="$work/fix/$case_name/$impl/repo"
    rm -rf "$fix"
    mkdir -p "$fix"
    ( cd "$fix" && "$setup" ) > "$logs/$impl.setup" 2>&1
    ( cd "$fix" && run_bin "$impl" "${args[@]}" ) > "$logs/$impl.out" 2> "$logs/$impl.err"
    echo "$?" > "$logs/$impl.code"
    capture_state "$impl" "$case_name" "$fix" > "$logs/$impl.state" 2>&1
  done

  local status=same stream detail
  for stream in out err code state; do
    normalize "$case_name" orig < "$logs/orig.$stream" > "$logs/orig.$stream.norm"
    normalize "$case_name" go < "$logs/go.$stream" > "$logs/go.$stream.norm"
    if ! diff -q "$logs/orig.$stream.norm" "$logs/go.$stream.norm" >/dev/null; then
      status=diff
      detail="$logs/$case_name.diff"
      {
        echo "### $case_name: $stream differs"
        diff -u --label "orig.$stream" --label "go.$stream" \
          "$logs/orig.$stream.norm" "$logs/go.$stream.norm" || true
      } >> "$detail"
    fi
  done
  if [[ $status == same ]]; then
    printf '%-24s same   (exit %s)\n' "$case_name" "$(cat "$logs/orig.code")"
  else
    failures=$((failures + 1))
    printf '%-24s DIFF   (orig exit %s, go exit %s)\n' \
      "$case_name" "$(cat "$logs/orig.code")" "$(cat "$logs/go.code")"
    sed -n '1,12p' "$logs/$case_name.diff" | sed 's/^/    /'
  fi
}

# --- cases -----------------------------------------------------------------

wanted=("$@")

selected() { # $1 case name
  local c
  [[ ${#wanted[@]} -eq 0 ]] && return 0
  for c in "${wanted[@]}"; do [[ $c == "$1" ]] && return 0; done
  return 1
}

run() { # $1 case, $2 setup, rest args; honors the optional case filter
  selected "$1" || return 0
  run_case "$@"
}

echo "== ship parity (original: git/ship-ts/ship.ts, port: git/ship) =="
run help_nocolor             setup_empty          --help
run unknown_flag             setup_empty          --bogus
run exclusive_visibilities   setup_repo           --public --private
run extra_positional         setup_repo           extra
run positional_sub_extra     setup_repo_sub_extra repo a b
run not_a_repo               setup_empty
run commit_seven             setup_seven
run binary_only              setup_binary
run message_flag             setup_message        -m "Custom subject"
run no_push                  setup_no_push        --no-push
run clean_unpushed           setup_clean_unpushed
run push_no_upstream         setup_push_no_upstream
run clean_noop               setup_clean_noop
run no_remote_nontty         setup_no_remote
run repo_flag_new            setup_repo_flag_new  --repo
run repo_flag_public         setup_repo_flag_public --repo app2 --public
run repo_sub_public          setup_repo_sub_public repo my-app --public
run repo_flag_existing       setup_repo_existing  --repo
run db_snapshot_ok           setup_db_ok
run db_snapshot_fail         setup_db_fail

# --- semantic checks: the original really did what the case claims -------

subject_of() { sed -n '/^== head subject$/{n;p;}' "$work/logs/$1/orig.state"; }

check() { # label, got, want
  if [[ $2 != "$3" ]]; then
    printf 'CHECK FAILED %-16s got %q, want %q\n' "$1" "$2" "$3"
    failures=$((failures + 1))
  else
    printf 'check %-21s ok (%s)\n' "$1" "$3"
  fi
}

if selected commit_seven; then
  check commit_seven_subject "$(subject_of commit_seven)" \
    "alpha.txt, bravo.txt, charlie.txt, delta.txt, echo.txt and 2 others"
fi
if selected message_flag; then
  check message_flag_subject "$(subject_of message_flag)" "Custom subject"
fi
if selected binary_only; then
  check binary_only_subject "$(subject_of binary_only)" "init"
fi
if selected db_snapshot_fail; then
  check db_fail_subject "$(subject_of db_snapshot_fail)" "init"
fi
if selected no_push; then
  refs=$(git -C "$work/remotes/no_push/orig/app.git" for-each-ref 2>/dev/null | wc -l)
  check no_push_remote_refs "$refs" "0"
fi
if selected clean_unpushed; then
  if grep -q '2 unpushed commits' "$work/logs/clean_unpushed/orig.out"; then
    check clean_unpushed_count ok ok
  else
    check clean_unpushed_count missing "2 unpushed commits"
  fi
fi

# Colored help under a real PTY: both streams are terminals, NO_COLOR unset.
pty_help() {
  local impl=$1 cmd
  case "$impl" in
    orig) cmd="env -u NO_COLOR bun $(printf '%q' "$original") --help" ;;
    go) cmd="env -u NO_COLOR $(printf '%q' "$work/ship") --help" ;;
  esac
  env -u NO_COLOR script -qec "$cmd" /dev/null 2>/dev/null | tr -d '\r'
}
if command -v script >/dev/null 2>&1; then
  pty_help orig > "$work/logs/pty_help.orig" 2>&1
  pty_help go > "$work/logs/pty_help.go" 2>&1
  if diff -q "$work/logs/pty_help.orig" "$work/logs/pty_help.go" >/dev/null; then
    printf '%-24s same   (colored --help on a PTY)\n' help_tty_color
  elif ! selected help_tty_color; then
    :
  else
    failures=$((failures + 1))
    printf '%-24s DIFF   (colored --help on a PTY)\n' help_tty_color
    diff -u --label orig --label go "$work/logs/pty_help.orig" "$work/logs/pty_help.go" | sed -n '1,12p' | sed 's/^/    /'
  fi
fi

echo
if [[ $failures -eq 0 ]]; then
  echo "all cases identical"
  exit 0
fi
echo "$failures case(s) differ; expected differences belong in git/ship/README.md (Changelog)"
echo "artifacts kept for inspection: $work/logs"
trap - EXIT
exit 1
