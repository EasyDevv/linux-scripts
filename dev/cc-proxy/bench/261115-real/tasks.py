"""Real tasks from the week of 261108–261115, rebuilt as fixtures with a scripted truth.

Each code task is a module of one of the user's repos at the commit before a real change, with that
change's test file(s) overlaid: the model must make them pass without editing them. Tiers are assigned
before any run from the size and spread of the real source change (lines, files, kind of logic):
quick ≤ ~20 lines in one file or a read-only lookup · standard one file, plain logic · high several files
or tricky state · premium a new module of 100+ lines or interacting rules.

Lookup tasks are read-only: the answer is a set computed by a script over the same fixture.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path

H = Path.home()
ROOT = Path(__file__).parent
FIX = ROOT / "fixtures"

TASKS = [
    # quick
    dict(id="lint-files", tier="quick", repo=H / ".local/share/scripts", fix="2f95d37", copy=["dev/lint"],
         tests=["dev/lint/lint-files.test.ts"], cmd="bun test dev/lint/lint-files.test.ts"),
    dict(id="terminal-title", tier="quick", repo=H / "dev/dashboard", fix="11f2d39",
         copy=["apps/client/src/lib/projects", "apps/client/src/lib/api", "package.json"],
         tests=["tests/terminal-title.test.ts"], cmd="bun test tests/terminal-title.test.ts"),
    dict(id="lookup-env", tier="quick", kind="lookup", repo=H / ".local/share/scripts", fix="HEAD", copy=["dev/cc-proxy"],
         brief="List every environment variable name that the TypeScript source files directly under ./dev/cc-proxy/ in the current directory (not tests, not bench/) read via process.env or Bun.env. Do not change any files. End with one line: ANSWER: NAME1,NAME2,... sorted alphabetically."),
    # standard
    dict(id="learn-fork", tier="standard", repo=H / ".pi/agent", fix="29dd6ca", copy=["extensions/lib", "package.json"],
         tests=["extensions/lib/learn-fork.test.ts"], cmd="node --test --experimental-strip-types extensions/lib/learn-fork.test.ts"),
    dict(id="browser-open", tier="standard", repo=H / ".local/share/scripts", fix="c31481e", copy=["dev/browser"],
         tests=["dev/browser/open.test.ts"], cmd="bun test dev/browser/open.test.ts"),
    dict(id="providers-pace", tier="standard", repo=H / "dev/dashboard", fix="11f2d39",
         copy=["apps/client/src/lib/providers", "apps/client/src/lib/api", "package.json"],
         tests=["tests/providers-pace.test.ts"], cmd="bun test tests/providers-pace.test.ts"),
    dict(id="pi-efforts", tier="quick", repo=H / "dev/dashboard", fix="d9a2677",
         copy=["apps/client/src/lib/projects", "apps/client/src/lib/api", "package.json"],
         tests=["tests/pi-models-efforts.test.ts"], cmd="bun test tests/pi-models-efforts.test.ts"),
    # high
    dict(id="harness-common", tier="high", repo=H / ".pi/agent", fix="9dc34ea", copy=["extensions/easy-harness", "extensions/lib", "package.json"],
         tests=["extensions/easy-harness/prompt.test.ts", "extensions/easy-harness/prompt-family.test.ts"],
         cmd="node --test --experimental-strip-types extensions/easy-harness/prompt.test.ts extensions/easy-harness/prompt-family.test.ts"),
    dict(id="macro-rules", tier="high", repo=H / "dev/private/android-macro", fix="784b506", copy=["src/lib", "package.json"],
         tests=["src/lib/macro/bump-phone.test.ts", "src/lib/macro/rules.test.ts"],
         cmd="bun test src/lib/macro/bump-phone.test.ts src/lib/macro/rules.test.ts"),
    dict(id="proxy-levels", tier="high", repo=H / ".local/share/scripts", fix="1b9f7f9", copy=["dev/cc-proxy", "dev/auth"],
         tests=["dev/cc-proxy/levels.test.ts"], cmd="bun test dev/cc-proxy/levels.test.ts"),
    dict(id="redacted-thinking", tier="high", kind="worktree", repo=H / ".local/share/scripts", copy=["dev/cc-proxy", "dev/auth"],
         revert=["dev/cc-proxy/normalize.ts"], tests=["dev/cc-proxy/normalize.test.ts"], cmd="bun test dev/cc-proxy/normalize.test.ts"),
    # premium
    dict(id="macro-interest", tier="premium", repo=H / "dev/private/android-macro", fix="08bf896", copy=["src/lib", "package.json"],
         tests=["src/lib/macro/bump-phone.test.ts", "src/lib/macro/store.test.ts"],
         cmd="bun test src/lib/macro/bump-phone.test.ts src/lib/macro/store.test.ts"),
    dict(id="quant-screen", tier="premium", repo=H / "dev/private/quant", fix="63c4b50", copy=["apps/client/src/lib/research", "apps/client/package.json", "apps/client/vite.config.ts", "apps/client/tsconfig.json"],
         tests=["apps/client/src/lib/research/screen.test.ts"], cmd="cd apps/client && bunx vitest run src/lib/research/screen.test.ts"),
]

NODE_MODULES = {H / "dev/dashboard": ["node_modules"], H / "dev/private/android-macro": ["node_modules"],
                H / ".pi/agent": ["node_modules"], H / "dev/private/quant": ["apps/client/node_modules", "node_modules"]}


def git(repo, *args, **kw):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, **kw).stdout


def extract(repo, rev, paths, dest):
    """Write `paths` of `repo` at `rev` into dest (rev None = working tree)."""
    for p in paths:
        if rev is None:
            src = repo / p
            if src.is_dir():
                shutil.copytree(src, dest / p, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "bench", ".svelte-kit"))
            elif src.exists():
                (dest / p).parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dest / p)
            continue
        listed = git(repo, "ls-tree", "-r", "--name-only", rev, "--", p, text=True).split()
        for f in listed:
            if "/bench/" in f or "/node_modules/" in f:
                continue
            out = dest / f; out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(git(repo, "show", f"{rev}:{f}"))


def build(task, state):
    """state 'base' = the task as given to the model; 'fix' = the real solution (for validation)."""
    dest = FIX / task["id"] / state
    shutil.rmtree(dest, ignore_errors=True); dest.mkdir(parents=True)
    repo = task["repo"]
    if task.get("kind") == "worktree":
        extract(repo, None, task["copy"], dest)
        if state == "base":
            for f in task["revert"]:
                (dest / f).write_bytes(git(repo, "show", f"HEAD:{f}"))
    elif task.get("kind") == "lookup":
        extract(repo, task["fix"], task["copy"], dest)
    else:
        rev = f"{task['fix']}^" if state == "base" else task["fix"]
        extract(repo, rev, task["copy"], dest)
        for t in task["tests"]:
            out = dest / t; out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(git(repo, "show", f"{task['fix']}:{t}"))
    if repo == H / "dev/dashboard":  # $lib resolves through the SvelteKit tsconfig (untracked .svelte-kit)
        extract(repo, None, ["apps/client/tsconfig.json", "apps/client/.svelte-kit/tsconfig.json"], dest)
    for nm in NODE_MODULES.get(repo, []):
        if (repo / nm).exists():
            (dest / nm).parent.mkdir(parents=True, exist_ok=True)
            os.symlink(repo / nm, dest / nm)
    subprocess.run(["git", "init", "-q"], cwd=dest); subprocess.run(["git", "add", "-A"], cwd=dest)
    subprocess.run(["git", "-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "base"], cwd=dest)
    return dest


def run_tests(task, dest):
    r = subprocess.run(task["cmd"], shell=True, cwd=dest, capture_output=True, text=True, timeout=300)
    return r.returncode, (r.stdout + r.stderr)[-1500:]


def lookup_truth(task, dest):
    import re
    names = set()
    for f in sorted((dest / "dev/cc-proxy").glob("*.ts")):
        if f.name.endswith(".test.ts"):
            continue
        s = f.read_text()
        names |= set(re.findall(r"(?:process|Bun)\.env\.([A-Z_][A-Z0-9_]*)", s))
        names |= set(re.findall(r"(?:process|Bun)\.env\[\s*[\"']([A-Z_][A-Z0-9_]*)[\"']\s*\]", s))
    return sorted(names)


if __name__ == "__main__":
    only = sys.argv[1:]
    truth = {}
    for t in TASKS:
        if only and t["id"] not in only:
            continue
        base = build(t, "base")
        if t.get("kind") == "lookup":
            truth[t["id"]] = lookup_truth(t, base); print(t["id"], "truth", truth[t["id"]]); continue
        b, _ = run_tests(t, base)
        fixd = build(t, "fix") if t.get("kind") != "worktree" else None
        if fixd is None:  # worktree task: the live tree is the fix
            fixd = FIX / t["id"] / "fix"; shutil.rmtree(fixd, ignore_errors=True)
            fixd.mkdir(parents=True); extract(t["repo"], None, t["copy"], fixd)
        f, out = run_tests(t, fixd)
        print(f"{t['id']:18} {t['tier']:8} base_exit={b} fix_exit={f}", "OK" if b != 0 and f == 0 else "INVALID")
        if f != 0:
            print(out[-600:])
    if truth:
        (ROOT / "lookup-truth.json").write_text(json.dumps(truth, indent=1))
