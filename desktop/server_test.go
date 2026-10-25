package main

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestServer(t *testing.T) {
	base := startServer()
	if !strings.HasPrefix(base, "http://127.0.0.1:4782") {
		t.Fatalf("unexpected base %s", base)
	}
	r, err := http.Get(base + "/")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode != 200 || !strings.Contains(string(b), "<title>Checkmate</title>") {
		t.Fatalf("index: %d", r.StatusCode)
	}
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("content type %q", ct)
	}
	if r, _ := http.Get(base + "/nope.js"); r.StatusCode != 404 {
		t.Fatalf("expected 404, got %d", r.StatusCode)
	}
	// A second start finds the running instance and reuses the same origin.
	if again := startServer(); again != base {
		t.Fatalf("second start used %s, want %s", again, base)
	}
}
