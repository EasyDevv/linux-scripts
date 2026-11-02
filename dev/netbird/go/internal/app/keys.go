// keys.go ports the key-name rules and the keys-file writer.
package app

import (
	"os"
	"regexp"
	"strings"
)

var keyNameRe = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)

// reservedNames may not be used as setup-key names: they are configuration keys.
var reservedNames = map[string]bool{
	"NETBIRD_API_KEY":        true,
	"NETBIRD_MANAGEMENT_URL": true,
	"NETBIRD_AUTO_GROUP":     true,
}

// normalizeKeyName uppercases, strips the legacy NETBIRD_SETUP_KEY_ prefix, and
// rejects anything that is not GREEN_USER_01-shaped or is reserved.
func normalizeKeyName(raw string) (string, error) {
	name := strings.ToUpper(strings.TrimSpace(raw))
	if strings.HasPrefix(name, oldKeyPrefix) {
		name = name[len(oldKeyPrefix):]
	}
	if !keyNameRe.MatchString(name) {
		return "", newError("key name must look like GREEN_USER_01 " +
			"(uppercase letters, digits, underscore)")
	}
	if reservedNames[name] {
		return "", newError("key name is reserved: " + name)
	}
	return name, nil
}

// saveSetupKey upserts the key into the keys file, seeding the header when the
// file is empty. A write failure writes a `.rescue` sibling and reports it.
func saveSetupKey(config Config, name, key string) (string, error) {
	existing := ""
	if data, err := os.ReadFile(config.KeysPath); err == nil {
		existing = string(data)
	}
	if strings.TrimSpace(existing) == "" {
		existing = envHeader(config.ManagementURL, config.AutoGroup)
	}
	updated := upsertEnv(existing, name, key)
	if err := atomicWrite(config.KeysPath, updated, 0o600); err != nil {
		rescue := config.KeysPath + "." + name + ".rescue"
		if writeErr := atomicWrite(rescue, upsertEnv(envHeader(config.ManagementURL, config.AutoGroup), name, key), 0o600); writeErr != nil {
			return "", newError("failed to write " + baseName(config.KeysPath) +
				"; saved a rescue file next to it")
		}
		return "", newError("failed to write " + baseName(config.KeysPath) +
			"; saved a rescue file next to it")
	}
	return config.KeysPath, nil
}

// listKeyNames returns the non-empty names that are not reserved configuration,
// in file order (the original iterated the parsed dict in insertion order).
func listKeyNames(keysPath string) []string {
	data, err := os.ReadFile(keysPath)
	if err != nil {
		return nil
	}
	text := string(data)
	values := parseEnv(text)
	names := make([]string, 0, len(values))
	for _, name := range envNameOrder(text) {
		if values[name] != "" && !reservedNames[name] {
			names = append(names, name)
		}
	}
	return names
}

// readSetupKey returns one stored key value.
func readSetupKey(keysPath, name string) (string, error) {
	key := loadEnvFile(keysPath)[name]
	if key == "" {
		return "", newError("setup key not found: " + name)
	}
	return key, nil
}
