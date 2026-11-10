// Command pk is the package.json script picker.
// Argument parsing, discovery, and execution live in internal/app;
// the inline list lives in internal/ui.
package main

import (
	"os"

	"pk/internal/app"
)

func main() {
	os.Exit(app.Run(os.Args[1:], app.Env{}))
}
