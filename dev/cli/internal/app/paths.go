// paths.go ports cli-rust/src/paths.rs.
//
// tools.toml 기본 경로 (Rust lib.rs default_manifest_path, CARGO_MANIFEST_DIR 대체):
// Rust 는 컴파일 시 CARGO_MANIFEST_DIR/tools.toml 로 고정하고, CLI_MANIFEST 가 있으면 그 파일을 쓴다.
// Go 에는 컴파일 타임 크레이트 루트가 없으므로 DefaultManifestPath 가 다음 순서로 찾는다.
//  1. CLI_MANIFEST — 매니페스트 파일 경로 (Rust 와 같은 오버라이드). 빈 값이라도 설정돼 있으면 그 값을 쓴다.
//  2. CLI_ROOT/tools.toml — 래퍼가 CLI_ROOT 를 프로젝트 루트로 설정한다.
//  3. 실행 파일 기준 — 바이너리가 <root>/bin/cli 에 놓인다고 가정하고 tools.toml 은 <root>/tools.toml.
//     os.Executable 의 심볼릭 링크는 EvalSymlinks 로 풀어, PATH 심링크도 실제 루트를 보게 한다.
//  4. 실행 파일 경로를 얻지 못하면 tools.toml (현재 디렉터리 상대).
//
// Exported: ProtoRoot, Paths, NewPaths, PathsFromEnv, path methods, DefaultManifestPath.
// Joins follow Rust Path::join (no Clean of "." / "..").

package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// ProtoRoot is paths::proto_root. PROTO_HOME, else HOME/.proto, else .proto.
func ProtoRoot() string {
	if v, ok := os.LookupEnv("PROTO_HOME"); ok {
		return v
	}
	if home, ok := os.LookupEnv("HOME"); ok {
		return pathJoin(home, ".proto")
	}
	return ".proto"
}

func bunInstallDir() string {
	if v, ok := os.LookupEnv("BUN_INSTALL"); ok {
		return v
	}
	if home, ok := os.LookupEnv("HOME"); ok {
		return pathJoin(home, ".bun")
	}
	return ".bun"
}

type Paths struct {
	// proto 락파일(.protolock)과 플러그인 TOML 이 있는 폴더. 기본 ~/.local/share/cli.
	CliHome string
	// lock.json, 임시 다운로드, 이전 바이너리. 기본 ~/.local/state/cli.
	State string
	// proto 실행 파일 이름 또는 경로.
	ProtoBin string
	// go·cargo 가 설치하는 접두 폴더(bin/ 가 그 아래). 기본 ~/.local.
	Prefix string
	// bun·go·cargo·osv-scanner 실행 파일 이름 또는 경로.
	BunBin   string
	GoBin    string
	CargoBin string
	OsvBin   string
}

// NewPaths is Paths::new. Prefix defaults to .local; tool bins default to bare names.
func NewPaths(cliHome, state, protoBin string) Paths {
	return Paths{
		CliHome:  cliHome,
		State:    state,
		ProtoBin: protoBin,
		Prefix:   ".local",
		BunBin:   "bun",
		GoBin:    "go",
		CargoBin: "cargo",
		OsvBin:   "osv-scanner",
	}
}

// PathsFromEnv is Paths::from_env.
// CLI_HOME, CLI_STATE, CLI_PREFIX fall back to HOME and error with "HOME is not set" when that is missing.
// CLI_PROTO defaults to "proto". CLI_BUN, CLI_GO, CLI_CARGO, CLI_OSV override when set (including empty).
// Those five follow Rust env::var: a non-UTF-8 value is treated as unset. CLI_HOME/STATE/PREFIX/MANIFEST use var_os.
func PathsFromEnv() (Paths, error) {
	home, hasHome := os.LookupEnv("HOME")
	cliHome, ok := os.LookupEnv("CLI_HOME")
	if !ok {
		if !hasHome {
			return Paths{}, fmt.Errorf("HOME is not set")
		}
		cliHome = pathJoin(home, ".local/share/cli")
	}
	state, ok := os.LookupEnv("CLI_STATE")
	if !ok {
		if !hasHome {
			return Paths{}, fmt.Errorf("HOME is not set")
		}
		state = pathJoin(home, ".local/state/cli")
	}
	protoBin := "proto"
	if v, ok := envUnicode("CLI_PROTO"); ok {
		protoBin = v
	}
	paths := NewPaths(cliHome, state, protoBin)
	if v, ok := os.LookupEnv("CLI_PREFIX"); ok {
		paths.Prefix = v
	} else {
		if !hasHome {
			return Paths{}, fmt.Errorf("HOME is not set")
		}
		paths.Prefix = pathJoin(home, ".local")
	}
	if v, ok := envUnicode("CLI_BUN"); ok {
		paths.BunBin = v
	}
	if v, ok := envUnicode("CLI_GO"); ok {
		paths.GoBin = v
	}
	if v, ok := envUnicode("CLI_CARGO"); ok {
		paths.CargoBin = v
	}
	if v, ok := envUnicode("CLI_OSV"); ok {
		paths.OsvBin = v
	}
	return paths, nil
}

// BinDir is Paths::bin_dir.
func (p Paths) BinDir() string { return pathJoin(p.Prefix, "bin") }

// BunGlobalBin is Paths::bun_global_bin. Uses BUN_INSTALL or ~/.bun, not Paths fields.
func (p Paths) BunGlobalBin() string { return pathJoin(bunInstallDir(), "bin") }

// BunGlobalLock is Paths::bun_global_lock.
func (p Paths) BunGlobalLock() string {
	return pathJoin(bunInstallDir(), "install/global/bun.lock")
}

// PluginsDir is Paths::plugins_dir.
func (p Paths) PluginsDir() string { return pathJoin(p.CliHome, "plugins") }

// PluginFile is Paths::plugin_file.
func (p Paths) PluginFile(name string) string {
	return pathJoin(p.PluginsDir(), name+".toml")
}

// Protolock is Paths::protolock.
func (p Paths) Protolock() string { return pathJoin(p.CliHome, ".protolock") }

// Prototools is Paths::prototools.
func (p Paths) Prototools() string { return pathJoin(p.CliHome, ".prototools") }

// LockJSON is Paths::lock_json.
func (p Paths) LockJSON() string { return pathJoin(p.State, "lock.json") }

// TmpDir is Paths::tmp_dir.
func (p Paths) TmpDir(name string) string { return pathJoin(p.State, "tmp", name) }

// ProtoToolDir is Paths::proto_tool_dir.
func (p Paths) ProtoToolDir(name, version string) string {
	return pathJoin(ProtoRoot(), "tools", name, version)
}

// Shim is Paths::shim.
func (p Paths) Shim(exe string) string { return pathJoin(ProtoRoot(), "shims", exe) }

const protoToolsBody = "[settings]\nunstable-lockfile = true\n"

// EnsureCliHome is Paths::ensure_cli_home.
// Creates the plugins dir and state dir. Writes .prototools only when it does not exist.
func (p Paths) EnsureCliHome() error {
	if err := os.MkdirAll(p.PluginsDir(), 0o777); err != nil {
		return err
	}
	if err := os.MkdirAll(p.State, 0o777); err != nil {
		return err
	}
	tools := p.Prototools()
	if _, err := os.Stat(tools); err != nil {
		// Rust Path::exists is false when existence cannot be confirmed, then write is attempted.
		if werr := os.WriteFile(tools, []byte(protoToolsBody), 0o666); werr != nil {
			return werr
		}
	}
	return nil
}

// DefaultManifestPath resolves tools.toml. See the file comment for the Rust difference.
func DefaultManifestPath() string {
	if v, ok := os.LookupEnv("CLI_MANIFEST"); ok {
		return v
	}
	if root, ok := os.LookupEnv("CLI_ROOT"); ok {
		return pathJoin(root, "tools.toml")
	}
	exe, err := os.Executable()
	if err != nil {
		return "tools.toml"
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	root := parentDir(parentDir(exe))
	if root == "" {
		return "tools.toml"
	}
	return pathJoin(root, "tools.toml")
}

// pathJoin matches Rust Path::join: an absolute element replaces the accumulator,
// "." and ".." are kept, and an empty relative element still adds a separator ("foo"+"" => "foo/").
func pathJoin(elem ...string) string {
	if len(elem) == 0 {
		return ""
	}
	b := elem[0]
	for _, e := range elem[1:] {
		if strings.HasPrefix(e, "/") {
			b = e
			continue
		}
		if b == "" {
			b = e
			continue
		}
		if strings.HasSuffix(b, "/") {
			b += e
		} else {
			b += "/" + e
		}
	}
	return b
}

// envUnicode is Rust std::env::var: missing or non-UTF-8 is not Ok.
func envUnicode(key string) (string, bool) {
	v, ok := os.LookupEnv(key)
	if !ok || !utf8.ValidString(v) {
		return "", false
	}
	return v, true
}

func parentDir(path string) string {
	i := strings.LastIndex(path, "/")
	if i < 0 {
		return ""
	}
	if i == 0 {
		return "/"
	}
	return path[:i]
}

// withExtension matches Rust Path::with_extension (last dot only; a leading-dot name has no extension).
func withExtension(path, ext string) string {
	dir := parentDir(path)
	file := path
	if dir != "" {
		file = path[len(dir)+1:]
		if dir == "/" {
			file = path[1:]
		}
	}
	stem := file
	if extName, ok := rustExtension(file); ok {
		stem = file[:len(file)-len(extName)-1]
	}
	name := stem
	if ext != "" {
		name = stem + "." + ext
	}
	if dir == "" {
		return name
	}
	if dir == "/" {
		return "/" + name
	}
	return dir + "/" + name
}

func rustExtension(file string) (string, bool) {
	if file == "" || file == "." || file == ".." {
		return "", false
	}
	i := strings.LastIndex(file, ".")
	if i <= 0 {
		return "", false
	}
	return file[i+1:], true
}

func mkdirParent(path string) error {
	parent := parentDir(path)
	if parent == "" || parent == "." {
		return nil
	}
	return os.MkdirAll(parent, 0o777)
}
