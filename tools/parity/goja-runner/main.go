// Runs the bundled TS sim inside goja (the Nakama JS runtime) and prints the
// ReplayResult JSON. Same bundle + same JSON-in/JSON-out shape as the V8 runner,
// so a hash difference is a real cross-runtime divergence.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/dop251/goja"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: goja-runner <bundle.js>  (ReplayBundle JSON on stdin)")
		os.Exit(2)
	}
	bundleSrc, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read bundle:", err)
		os.Exit(1)
	}
	bundleJSON, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read stdin:", err)
		os.Exit(1)
	}

	vm := goja.New()
	if _, err := vm.RunString(string(bundleSrc)); err != nil {
		fmt.Fprintln(os.Stderr, "load bundle:", err)
		os.Exit(1)
	}
	if err := vm.Set("__bundleJson", string(bundleJSON)); err != nil {
		fmt.Fprintln(os.Stderr, "set input:", err)
		os.Exit(1)
	}
	v, err := vm.RunString("JSON.stringify(Sim.runReplay(JSON.parse(__bundleJson)))")
	if err != nil {
		fmt.Fprintln(os.Stderr, "run replay:", err)
		os.Exit(1)
	}
	fmt.Print(v.String())
}
