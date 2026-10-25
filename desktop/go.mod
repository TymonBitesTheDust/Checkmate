module checkmate-desktop

go 1.24

require (
	github.com/jchv/go-webview2 v0.0.0-20260205173254-56598839c808
	golang.org/x/sys v0.33.0
)

require github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect

// Fetched from GitHub mirrors; the default module proxy is not reachable from the build machine.
replace golang.org/x/sys => ../third_party/sys
