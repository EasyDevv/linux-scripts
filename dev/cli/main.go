// main.go ports the process entry of cli-rust/src/main.rs.
// Dispatch lives in app.Run; later stages fill the command body.

package main

import (
	"os"

	"cli/internal/app"
)

func main() {
	os.Exit(app.Run(os.Args[1:]))
}
