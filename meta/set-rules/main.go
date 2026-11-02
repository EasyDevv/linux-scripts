// main.go is the process entry. The shipped script's body lives in app.Run.
package main

import (
	"os"

	"set-rules/internal/app"
)

func main() {
	os.Exit(app.Run(os.Args))
}
