// util.go holds the small helpers the other files share: path basenames, file
// access, and the GET request used by the MSI download.
package app

import (
	"net/http"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

// baseName is Python's Path.name.
func baseName(path string) string { return filepath.Base(path) }

// itoa is strconv.Itoa under a local name so usb.go stays readable.
func itoa(value int64) string { return strconv.FormatInt(value, 10) }

// unixAccessWritable is os.access(path, W_OK) for the current user.
func unixAccessWritable(path string) bool {
	return syscall.Access(path, 0x2) == nil
}

// newGetRequest builds the installer GET with the original's User-Agent and
// http.client's default Accept-Encoding (the transport disables compression).
func newGetRequest(url string) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "netbird-setup")
	req.Header.Set("Accept-Encoding", "identity")
	req.Close = true
	return req, nil
}

// downloadTimeout is urllib's timeout=120 for the MSI download.
const downloadTimeout = 120 * time.Second
