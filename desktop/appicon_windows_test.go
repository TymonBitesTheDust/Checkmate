//go:build windows

package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestIconGroups(t *testing.T) {
	seen := map[string]bool{}
	for id := uintptr(1); id <= 7; id++ {
		g := groupBytes(0, id)
		if len(g) < 6+14 {
			t.Fatalf("group %d missing (%d bytes)", id, len(g))
		}
		if id > 1 {
			if seen[string(g)] {
				t.Fatalf("group %d is the same as another style", id)
			}
			seen[string(g)] = true
		}
	}
	if !sameIcon(0, 1, 0, styleIcons["tickwise"]) {
		t.Fatal("the file icon should start as the Checkmate style")
	}
	if sameIcon(0, 1, 0, styleIcons["neon"]) {
		t.Fatal("different styles must not look the same")
	}
	if len(styleIcons) != 6 {
		t.Fatal("six styles")
	}
}

// Swaps the file icon of a copy of this program, then checks the copy still runs.
func TestSwapFileIcon(t *testing.T) {
	self, _ := os.Executable()
	dir := t.TempDir()
	exe := filepath.Join(dir, "Checkmate.exe")
	if err := copyFile(self, exe); err != nil {
		t.Fatal(err)
	}
	want := groupBytes(0, styleIcons["tide"])
	if err := swapFileIcon(exe, want); err != nil {
		t.Fatal("swap:", err)
	}
	if got := fileGroupBytes(exe, fileIconID); !bytes.Equal(got, want) {
		t.Fatal("file icon not changed")
	}
	if got := fileGroupBytes(exe, styleIcons["neon"]); !bytes.Equal(got, groupBytes(0, styleIcons["neon"])) {
		t.Fatal("the other styles' icons must stay as they were")
	}
	old := exe + ".old"
	attrs, err := windows.GetFileAttributes(windows.StringToUTF16Ptr(old))
	if err != nil || attrs&windows.FILE_ATTRIBUTE_HIDDEN == 0 {
		t.Fatal("old copy should be kept, hidden, until the next start", err)
	}
	out, err := exec.Command(exe, "-test.run=^TestRunsAtAll$", "-test.v").CombinedOutput()
	if err != nil || !bytes.Contains(out, []byte("PASS")) {
		t.Fatalf("the changed exe doesn't run: %v\n%s", err, out)
	}
	// and back to the default
	if err := swapFileIcon(exe, groupBytes(0, styleIcons["tickwise"])); err != nil {
		t.Fatal("second swap:", err)
	}
	ok := false
	withFile(exe, func(m uintptr) { ok = sameIcon(m, fileIconID, 0, 1) && !sameIcon(m, fileIconID, 0, styleIcons["tide"]) })
	if !ok {
		t.Fatal("back to the Checkmate icon")
	}
	t.Logf("exe size %d", fileSize(exe))
}

func TestRunsAtAll(t *testing.T) {}

func fileSize(p string) int64 {
	st, err := os.Stat(p)
	if err != nil {
		return -1
	}
	return st.Size()
}

func makeShortcut(t *testing.T, lnk, target string) {
	t.Helper()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	procCoInit.Call(0, 0x2)
	var link uintptr
	if r, _, _ := procCoCreate.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, 1, uintptr(unsafe.Pointer(&iidShellLinkW)), uintptr(unsafe.Pointer(&link))); r != 0 {
		t.Fatalf("CoCreateInstance %x", r)
	}
	defer comCall(link, comRelease)
	tp, _ := windows.UTF16PtrFromString(target)
	if r := comCall(link, 20 /*SetPath*/, uintptr(unsafe.Pointer(tp))); r != 0 {
		t.Fatalf("SetPath %x", r)
	}
	var pf uintptr
	comCall(link, comQueryInterface, uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&pf)))
	defer comCall(pf, comRelease)
	lp, _ := windows.UTF16PtrFromString(lnk)
	if r := comCall(pf, pfSave, uintptr(unsafe.Pointer(lp)), 1); r != 0 {
		t.Fatalf("Save %x", r)
	}
}

func shortcutIcon(t *testing.T, lnk string) (string, int32) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	procCoInit.Call(0, 0x2)
	var link, pf uintptr
	procCoCreate.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, 1, uintptr(unsafe.Pointer(&iidShellLinkW)), uintptr(unsafe.Pointer(&link)))
	defer comCall(link, comRelease)
	comCall(link, comQueryInterface, uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&pf)))
	defer comCall(pf, comRelease)
	lp, _ := windows.UTF16PtrFromString(lnk)
	comCall(pf, pfLoad, uintptr(unsafe.Pointer(lp)), 0)
	buf := make([]uint16, 1024)
	var idx int32
	comCall(link, slGetIconLocation, uintptr(unsafe.Pointer(&buf[0])), 1024, uintptr(unsafe.Pointer(&idx)))
	return windows.UTF16ToString(buf), idx
}

func TestShortcuts(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "app", "Checkmate.exe")
	other := filepath.Join(dir, "app", "Other.exe")
	os.MkdirAll(filepath.Dir(exe), 0o755)
	os.WriteFile(exe, []byte("x"), 0o755)
	os.WriteFile(other, []byte("x"), 0o755)
	desk := filepath.Join(dir, "Desktop")
	pins := filepath.Join(dir, "Quick Launch", "User Pinned", "TaskBar")
	os.MkdirAll(desk, 0o755)
	os.MkdirAll(pins, 0o755)
	a := filepath.Join(desk, "Checkmate.lnk")
	b := filepath.Join(pins, "Checkmate.lnk")
	c := filepath.Join(desk, "Other.lnk")
	makeShortcut(t, a, exe)
	makeShortcut(t, b, exe)
	makeShortcut(t, c, other)
	folders := []string{desk, filepath.Join(dir, "Quick Launch")}
	if n := retargetShortcuts(exe, styleIcons["riot"], folders); n != 2 {
		t.Fatalf("changed %d shortcuts, want 2", n)
	}
	for _, l := range []string{a, b} {
		p, i := shortcutIcon(t, l)
		if !(equalFoldPath(p, exe) && i == -int32(styleIcons["riot"])) {
			t.Fatalf("%s icon = %q,%d", l, p, i)
		}
	}
	if p, _ := shortcutIcon(t, c); p != "" {
		t.Fatalf("a shortcut to another program was changed: %q", p)
	}
	if n := retargetShortcuts(exe, styleIcons["riot"], folders); n != 0 {
		t.Fatalf("second pass changed %d", n)
	}
	if n := retargetShortcuts(exe, styleIcons["tickwise"], folders); n != 2 {
		t.Fatalf("back to Checkmate changed %d", n)
	}
	if _, i := shortcutIcon(t, a); i != -int32(styleIcons["tickwise"]) {
		t.Fatalf("index %d", i)
	}
}

func equalFoldPath(a, b string) bool {
	return len(a) == len(b) && bytes.EqualFold([]byte(filepath.Clean(a)), []byte(filepath.Clean(b)))
}

// CM_SWAP_FILE=<path to a built Checkmate.exe copy>: swap its icon to each style in turn.
func TestSwapGivenFile(t *testing.T) {
	path := os.Getenv("CM_SWAP_FILE")
	if path == "" {
		t.Skip("CM_SWAP_FILE not set")
	}
	for _, s := range []string{"neon", "riot", "tickwise"} {
		if err := swapFileIcon(path, groupBytes(0, styleIcons[s])); err != nil {
			t.Fatal(s, err)
		}
		ok := false
		withFile(path, func(m uintptr) { ok = sameIcon(m, fileIconID, 0, styleIcons[s]) })
		if !ok {
			t.Fatal("icon not", s)
		}
		os.Remove(path + ".old")
	}
}
