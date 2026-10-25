package main

import (
	"embed"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

//go:embed assets/index.html
var assets embed.FS

const marker = "tickwise-desktop"

// Fixed ports keep the page origin (and so its storage) stable between runs.
var ports = []int{47821, 47822, 47823, 47824, 47825}

// startServer serves the bundled app on 127.0.0.1 and returns its base URL.
func startServer() string {
	ln, base := listen()
	if ln != nil {
		go http.Serve(ln, handler())
	}
	return base
}

func listen() (net.Listener, string) {
	for _, p := range ports {
		addr := fmt.Sprintf("127.0.0.1:%d", p)
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln, "http://" + addr
		}
		// Port taken: if it is an older Checkmate still running, reuse it.
		if isOurs(addr) {
			return nil, "http://" + addr
		}
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	return ln, "http://" + ln.Addr().String()
}

func isOurs(addr string) bool {
	c := http.Client{Timeout: 800 * time.Millisecond}
	r, err := c.Get("http://" + addr + "/__id")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 64))
	return strings.TrimSpace(string(b)) == marker
}

func handler() http.Handler {
	page, _ := assets.ReadFile("assets/index.html")
	mux := http.NewServeMux()
	mux.HandleFunc("/__id", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(marker))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(page)
	})
	return mux
}
