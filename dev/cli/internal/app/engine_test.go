package app

import (
	"path/filepath"
	"testing"
)

func TestInstallAlwaysPinsGloballyFromTheCliHome(t *testing.T) {
	args := installArgs("litestream", "0.5.17")
	if args[3] != "-c" || args[4] != "upwards-global" {
		t.Fatalf("config = %#v", args[3:5])
	}
	if !hasArgPair(args, "--pin", "global") {
		t.Fatalf("args = %#v", args)
	}
	if args[5] != "install" || args[6] != "litestream" || args[7] != "0.5.17" {
		t.Fatalf("install = %#v", args[5:8])
	}
}

func TestPluginIsRegisteredInTheGlobalConfig(t *testing.T) {
	pluginFile := filepath.Join("/x", "plugins", "aws.toml")
	args := pluginAddArgs("aws", pluginFile)
	if !containsString(args, "file:///x/plugins/aws.toml") {
		t.Fatalf("args = %#v", args)
	}
	if !hasArgPair(args, "--to", "global") {
		t.Fatalf("args = %#v", args)
	}
}

func TestInheritedVersionOverridesAreDetected(t *testing.T) {
	for _, key := range []string{"PROTO_VERSION", "PROTO_BUN_VERSION", "PROTO_SHIM_NAME", "PROTO_SHIM_PATH", "PROTO_NODE_VERSION"} {
		if !isInheritedOverride(key) {
			t.Fatalf("%s was not an override", key)
		}
	}
	for _, key := range []string{"PROTO_HOME", "PATH", "PROTO_APP_LOG", "BUN_VERSION"} {
		if isInheritedOverride(key) {
			t.Fatalf("%s was an override", key)
		}
	}
}

func hasArgPair(args []string, left, right string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == left && args[i+1] == right {
			return true
		}
	}
	return false
}

func containsString(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
