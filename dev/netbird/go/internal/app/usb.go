// usb.go ports USB discovery (lsblk JSON), the payload writer, and the MSI
// cache/download.
package app

import (
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// mediaPrefixes are the mount roots that count as removable media.
var mediaPrefixes = []string{"/run/media/", "/media/", "/mnt/"}

// UsbVolume is one mounted USB filesystem.
type UsbVolume struct {
	Device     string
	Mountpoint string
	Label      string
	Size       string
	Model      string
}

// ChoiceID is the mountpoint.
func (v UsbVolume) ChoiceID() string { return v.Mountpoint }

// ChoiceLabel is `label  mountpoint  size  model` with the blanks dropped.
func (v UsbVolume) ChoiceLabel() string {
	name := v.Label
	if name == "" {
		name = filepath.Base(v.Mountpoint)
	}
	if name == "" || name == "." || name == "/" {
		name = v.Device
	}
	extra := make([]string, 0, 2)
	for _, part := range []string{v.Size, v.Model} {
		if part != "" {
			extra = append(extra, part)
		}
	}
	label := name + "  " + v.Mountpoint
	if len(extra) > 0 {
		label += "  " + strings.Join(extra, "  ")
	}
	return label
}

// firstMount prefers `mountpoint` and falls back to the first `mountpoints`.
func firstMount(device map[string]any) string {
	if mount, ok := device["mountpoint"].(string); ok && mount != "" {
		return mount
	}
	if list, ok := device["mountpoints"].([]any); ok {
		for _, item := range list {
			if mount, ok := item.(string); ok && mount != "" {
				return mount
			}
		}
	}
	return ""
}

// isUsbDevice accepts a usb transport, or a removable device under a media root.
func isUsbDevice(tran string, rm bool, mount string) bool {
	if tran == "usb" {
		return true
	}
	if !rm || mount == "" {
		return false
	}
	for _, prefix := range mediaPrefixes {
		if strings.HasPrefix(mount, prefix) {
			return true
		}
	}
	return false
}

// parseLsblk walks the blockdevices tree and keeps mounted USB filesystems.
func parseLsblk(payload map[string]any) []UsbVolume {
	found := make([]UsbVolume, 0, 4)
	var walk func(devices []any, inheritedTran string, inheritedRm bool, inheritedModel string)
	walk = func(devices []any, inheritedTran string, inheritedRm bool, inheritedModel string) {
		for _, raw := range devices {
			device, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			tran := inheritedTran
			if value, ok := device["tran"].(string); ok && value != "" {
				tran = value
			}
			rm := inheritedRm
			if value, ok := device["rm"].(bool); ok && value {
				rm = true
			}
			model := inheritedModel
			if value := strings.TrimSpace(toString(device["model"])); value != "" {
				model = value
			} else {
				model = strings.TrimSpace(inheritedModel)
			}
			children, _ := device["children"].([]any)
			mount := firstMount(device)
			kind, hasKind := device["type"].(string)
			if mount != "" && isUsbDevice(tran, rm, mount) && usbVolumeKind(kind, hasKind) {
				if !(kind == "disk" && len(children) > 0) {
					found = append(found, UsbVolume{
						Device:     toString(device["name"]),
						Mountpoint: mount,
						Label:      strings.TrimSpace(toString(device["label"])),
						Size:       strings.TrimSpace(toString(device["size"])),
						Model:      model,
					})
				}
			}
			if len(children) > 0 {
				walk(children, tran, rm, model)
			}
		}
	}
	blockDevices, _ := payload["blockdevices"].([]any)
	walk(blockDevices, "", false, "")
	unique := make([]UsbVolume, 0, len(found))
	seen := map[string]bool{}
	for _, volume := range found {
		if seen[volume.Mountpoint] {
			continue
		}
		seen[volume.Mountpoint] = true
		unique = append(unique, volume)
	}
	return unique
}

// usbVolumeKind accepts the device types the original accepts.
func usbVolumeKind(kind string, hasKind bool) bool {
	if !hasKind || kind == "" {
		return true
	}
	switch kind {
	case "part", "crypt", "lvm", "disk":
		return true
	}
	return false
}

// listUsbVolumes runs lsblk and parses the JSON, or parses a given payload.
func listUsbVolumes(lsblkJSON string) ([]UsbVolume, error) {
	if lsblkJSON == "" {
		proc, err := exec.LookPath("lsblk")
		if err != nil {
			return nil, newError("lsblk is required to discover USB volumes")
		}
		out, err := exec.Command(proc, "-J", "-o",
			"NAME,LABEL,SIZE,MOUNTPOINT,MOUNTPOINTS,TRAN,RM,TYPE,MODEL").Output()
		if err != nil {
			return nil, newError("failed to list block devices")
		}
		lsblkJSON = string(out)
	}
	var payload any
	if err := json.Unmarshal([]byte(lsblkJSON), &payload); err != nil {
		return nil, newError("failed to parse lsblk json")
	}
	object, ok := payload.(map[string]any)
	if !ok {
		return nil, newError("failed to parse lsblk json")
	}
	return parseLsblk(object), nil
}

// payloadDir appends netbird-setup unless the destination already is it.
func payloadDir(dest string) string {
	if filepath.Base(dest) == USBPayloadDir {
		return dest
	}
	return filepath.Join(dest, USBPayloadDir)
}

// isWritableDir rejects block devices, character devices, and non-writable dirs.
func isWritableDir(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false
	}
	mode := info.Mode()
	if mode&os.ModeDevice != 0 || mode&os.ModeCharDevice != 0 {
		return false
	}
	return unixAccessWritable(path)
}

// renderWindowsPS1 reads windows/install-netbird.ps1 from the module directory.
func renderWindowsPS1(paths Paths) (string, error) {
	return renderFromModule(paths, filepath.Join(paths.WindowsDir, WindowsPS1Name), WindowsPS1Name)
}

// renderWindowsCMD reads windows/install-netbird.cmd.
func renderWindowsCMD(paths Paths) (string, error) {
	return renderFromModule(paths, filepath.Join(paths.WindowsDir, WindowsCMDName), WindowsCMDName)
}

// renderWindowsReadme reads the module's own README.md (the USB readme).
func renderWindowsReadme(paths Paths) (string, error) {
	return renderFromModule(paths, filepath.Join(paths.ScriptDir, WindowsReadmeName), WindowsReadmeName)
}

func renderFromModule(paths Paths, path, name string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", newError("missing " + name)
	}
	return string(data), nil
}

// writeUSBpayload copies the keys file and writes the three Windows files.
func writeUSBpayload(paths Paths, dest, keysPath string) ([]string, error) {
	envDest := filepath.Join(dest, KeysName)
	ps1Dest := filepath.Join(dest, WindowsPS1Name)
	cmdDest := filepath.Join(dest, WindowsCMDName)
	readmeDest := filepath.Join(dest, WindowsReadmeName)
	if err := copyFile(keysPath, envDest); err != nil {
		return nil, newError("failed to copy " + KeysName)
	}
	ps1, err := renderWindowsPS1(paths)
	if err != nil {
		return nil, err
	}
	cmdText, err := renderWindowsCMD(paths)
	if err != nil {
		return nil, err
	}
	readme, err := renderWindowsReadme(paths)
	if err != nil {
		return nil, err
	}
	if err := atomicWrite(ps1Dest, ps1, 0o644); err != nil {
		return nil, newError("failed to write " + WindowsPS1Name)
	}
	if err := atomicWrite(cmdDest, cmdText, 0o644); err != nil {
		return nil, newError("failed to write " + WindowsCMDName)
	}
	if err := atomicWrite(readmeDest, readme, 0o644); err != nil {
		return nil, newError("failed to write " + WindowsReadmeName)
	}
	return []string{envDest, ps1Dest, cmdDest, readmeDest}, nil
}

// copyFile copies content and mode, like shutil.copy2.
func copyFile(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Chmod(dst, info.Mode().Perm())
}

// downloadMSI fetches the installer to dest via `dest.part`, User-Agent
// netbird-setup and a 120 s timeout, like download_msi().
func downloadMSI(dest, url string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return newError("failed to download the NetBird Windows MSI")
	}
	tmp := dest + ".part"
	client := newHTTPClient(downloadTimeout)
	req, err := newGetRequest(url)
	if err != nil {
		return newError("failed to download the NetBird Windows MSI")
	}
	resp, err := client.Do(req)
	if err != nil {
		os.Remove(tmp)
		return newError("failed to download the NetBird Windows MSI")
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		os.Remove(tmp)
		return newError("failed to download the NetBird Windows MSI")
	}
	handle, err := os.Create(tmp)
	if err != nil {
		return newError("failed to download the NetBird Windows MSI")
	}
	if _, err := io.Copy(handle, resp.Body); err != nil {
		handle.Close()
		os.Remove(tmp)
		return newError("failed to download the NetBird Windows MSI")
	}
	if err := handle.Close(); err != nil {
		os.Remove(tmp)
		return newError("failed to download the NetBird Windows MSI")
	}
	return os.Rename(tmp, dest)
}

// ensureMSI copies a non-empty cached MSI, otherwise downloads it; a failed
// download is not fatal (the USB script falls back to winget).
func ensureMSI(paths Paths, destDir, url string, fetch func(string, string) error) (string, bool) {
	target := filepath.Join(destDir, MSIName)
	if size, err := fileSize(paths.MSICache); err == nil && size > 0 {
		if err := copyFile(paths.MSICache, target); err != nil {
			return "", false
		}
		return target, true
	}
	download := fetch
	if download == nil {
		download = downloadMSI
	}
	if err := os.MkdirAll(filepath.Dir(paths.MSICache), 0o755); err != nil {
		return "", false
	}
	if err := download(paths.MSICache, url); err != nil {
		return "", false
	}
	if size, err := fileSize(paths.MSICache); err == nil && size > 0 {
		if err := copyFile(paths.MSICache, target); err != nil {
			return "", false
		}
		return target, true
	}
	return "", false
}

func fileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// toString renders a JSON scalar as the string Python's str() would give for
// the fields lsblk emits (strings, numbers, null).
func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case nil:
		return ""
	case bool:
		if typed {
			return "True"
		}
		return "False"
	case float64:
		return trimFloat(typed)
	}
	return ""
}

func trimFloat(value float64) string {
	if value == float64(int64(value)) {
		return itoa(int64(value))
	}
	return ""
}
