//go:build windows

// The app icon follows the style everywhere Windows shows it:
//   - the window's title bar and taskbar button, straight away (WM_SETICON);
//   - shortcuts to Checkmate.exe on the Desktop, in the Start menu and pinned to the
//     taskbar, straight away (their icon is pointed at the style's icon inside the exe);
//   - Checkmate.exe's own file icon, when the window closes. A running program can't
//     change its own file, so a copy gets the new icon and takes its place, and the
//     old file (renamed, hidden) is removed the next time Checkmate starts.
//
// Icon groups inside the exe (see winres/winres.json):
//   #1      the file icon, rewritten to match the style
//   #2..#7  one per style, never changed
package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const fileIconID = 1

// style -> icon group
var styleIcons = map[string]uintptr{"archive": 2, "riot": 3, "tide": 4, "frontier": 5, "neon": 6, "tickwise": 7}

var (
	kernel32           = windows.NewLazySystemDLL("kernel32.dll")
	ole32              = windows.NewLazySystemDLL("ole32.dll")
	procFindResource   = kernel32.NewProc("FindResourceW")
	procLoadResource   = kernel32.NewProc("LoadResource")
	procLockResource   = kernel32.NewProc("LockResource")
	procSizeofResource = kernel32.NewProc("SizeofResource")
	procBeginUpdate    = kernel32.NewProc("BeginUpdateResourceW")
	procUpdateRes      = kernel32.NewProc("UpdateResourceW")
	procEndUpdate      = kernel32.NewProc("EndUpdateResourceW")
	procLoadLibraryEx  = kernel32.NewProc("LoadLibraryExW")
	procFreeLibrary    = kernel32.NewProc("FreeLibrary")
	procCoInit         = ole32.NewProc("CoInitializeEx")
	procCoUninit       = ole32.NewProc("CoUninitialize")
	procCoCreate       = ole32.NewProc("CoCreateInstance")
	procChangeNotify   = shell32.NewProc("SHChangeNotify")
)

const (
	rtGroupIcon       = 14
	shcneUpdateItem   = 0x00002000
	shcneAssocChanged = 0x08000000
	shcnfPathW        = 0x0005
	shcnfIDList       = 0x0000
	shcnfFlushNoWait  = 0x3000
)

// ---------------------------------------------------------------- what the app asks for

var iconState struct {
	sync.Mutex
	style   string
	follow  bool
	pending *time.Timer
}

// Called by the page whenever the style (or the "change the app icon" setting) changes,
// and once when it loads.
func applyStyleIcon(hwnd uintptr, style string, follow bool) {
	id, ok := styleIcons[style]
	if !ok {
		style, id = "tickwise", styleIcons["tickwise"]
	}
	setWindowIcon(hwnd, id)
	iconState.Lock()
	defer iconState.Unlock()
	iconState.style, iconState.follow = style, follow
	if iconState.pending != nil {
		iconState.pending.Stop()
	}
	// Clicking through the styles shouldn't rewrite shortcuts for each one.
	iconState.pending = time.AfterFunc(900*time.Millisecond, func() {
		if exe, err := exePath(); err == nil {
			target := id
			if !follow {
				target = styleIcons["tickwise"]
			}
			retargetShortcuts(exe, target, shortcutFolders())
		}
	})
}

// When the window has closed: give Checkmate.exe the icon of the style in use.
func finishFileIcon() {
	iconState.Lock()
	style, follow := iconState.style, iconState.follow
	if iconState.pending != nil {
		iconState.pending.Stop()
	}
	iconState.Unlock()
	if style == "" {
		return
	}
	id := styleIcons[style]
	if !follow {
		id = styleIcons["tickwise"]
	}
	exe, err := exePath()
	if err != nil {
		return
	}
	retargetShortcuts(exe, id, shortcutFolders())
	want := groupBytes(0, id)
	if want == nil || sameIcon(0, fileIconID, 0, id) {
		return
	}
	_ = swapFileIcon(exe, want)
}

// Leftovers of an earlier swap.
func cleanupFileIcon() {
	if exe, err := exePath(); err == nil {
		_ = os.Remove(exe + ".old")
		_ = os.Remove(exe + ".new")
	}
}

func exePath() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return filepath.Clean(p), nil
}

// ---------------------------------------------------------------- icon resources

// The raw RT_GROUP_ICON data of a group in a module (0 = this program).
func groupBytes(module uintptr, id uintptr) []byte { return resourceBytes(module, id, rtGroupIcon) }

// Raw data of any resource.
func resourceBytes(module, id, kind uintptr) []byte {
	h, _, _ := procFindResource.Call(module, id, kind)
	if h == 0 {
		return nil
	}
	size, _, _ := procSizeofResource.Call(module, h)
	g, _, _ := procLoadResource.Call(module, h)
	if g == 0 || size == 0 {
		return nil
	}
	p, _, _ := procLockResource.Call(g)
	if p == 0 {
		return nil
	}
	return append([]byte(nil), unsafe.Slice((*byte)(unsafe.Pointer(p)), size)...)
}

// The pictures a group shows: each entry's size/colour header and its image.
// (Two groups can show the same pictures through different RT_ICON ids.)
func groupPictures(module, id uintptr) [][]byte {
	g := groupBytes(module, id)
	if len(g) < 6 {
		return nil
	}
	n := int(g[4]) | int(g[5])<<8
	var out [][]byte
	for i := 0; i < n && 6+14*(i+1) <= len(g); i++ {
		e := g[6+14*i : 6+14*(i+1)]
		img := resourceBytes(module, uintptr(e[12])|uintptr(e[13])<<8, 3 /*RT_ICON*/)
		out = append(out, append(append([]byte(nil), e[:12]...), img...))
	}
	return out
}

func sameIcon(m1, id1, m2, id2 uintptr) bool {
	a, b := groupPictures(m1, id1), groupPictures(m2, id2)
	if len(a) == 0 || len(a) != len(b) {
		return false
	}
	for i := range a {
		if !bytes.Equal(a[i], b[i]) {
			return false
		}
	}
	return true
}

// Opens an exe on disk just to read its resources.
func withFile(path string, fn func(module uintptr)) bool {
	p, _ := windows.UTF16PtrFromString(path)
	const asDataFile, asImageResource = 0x2, 0x20
	m, _, _ := procLoadLibraryEx.Call(uintptr(unsafe.Pointer(p)), 0, asDataFile|asImageResource)
	if m == 0 {
		return false
	}
	defer procFreeLibrary.Call(m)
	fn(m)
	return true
}

// The RT_GROUP_ICON data of a group in an exe file on disk.
func fileGroupBytes(path string, id uintptr) (out []byte) {
	withFile(path, func(m uintptr) { out = groupBytes(m, id) })
	return out
}

// Copies the exe, gives the copy's file icon (group #1) the wanted group's images, checks
// the copy, and swaps it in. The running file can be renamed but not rewritten.
func swapFileIcon(exe string, group []byte) error {
	tmp, old := exe+".new", exe+".old"
	_ = os.Remove(tmp)
	if err := copyFile(exe, tmp); err != nil {
		return err
	}
	if err := setGroup(tmp, fileIconID, group); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if got := fileGroupBytes(tmp, fileIconID); !bytes.Equal(got, group) {
		_ = os.Remove(tmp)
		return syscall.EINVAL
	}
	_ = os.Remove(old)
	from, _ := windows.UTF16PtrFromString(exe)
	to, _ := windows.UTF16PtrFromString(old)
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	src, _ := windows.UTF16PtrFromString(tmp)
	if err := windows.MoveFileEx(src, from, 0); err != nil {
		_ = windows.MoveFileEx(to, from, 0) // put the original back
		_ = os.Remove(tmp)
		return err
	}
	_ = windows.SetFileAttributes(to, windows.FILE_ATTRIBUTE_HIDDEN)
	procChangeNotify.Call(shcneUpdateItem, shcnfPathW|shcnfFlushNoWait, uintptr(unsafe.Pointer(from)), 0)
	procChangeNotify.Call(shcneAssocChanged, shcnfIDList|shcnfFlushNoWait, 0, 0)
	return nil
}

func setGroup(path string, id uintptr, group []byte) error {
	p, _ := windows.UTF16PtrFromString(path)
	h, _, err := procBeginUpdate.Call(uintptr(unsafe.Pointer(p)), 0)
	if h == 0 {
		return err
	}
	// go-winres stores the groups as language-neutral (0)
	ok, _, err := procUpdateRes.Call(h, rtGroupIcon, id, 0, uintptr(unsafe.Pointer(&group[0])), uintptr(len(group)))
	if ok == 0 {
		procEndUpdate.Call(h, 1) // discard
		return err
	}
	if r, _, err := procEndUpdate.Call(h, 0); r == 0 {
		return err
	}
	return nil
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// ---------------------------------------------------------------- shortcuts

// Where Windows keeps the shortcuts people make: Desktop, Start menu, taskbar pins.
func shortcutFolders() []string {
	var out []string
	for _, f := range []*windows.KNOWNFOLDERID{windows.FOLDERID_Desktop, windows.FOLDERID_PublicDesktop, windows.FOLDERID_Programs, windows.FOLDERID_CommonPrograms} {
		if p, err := windows.KnownFolderPath(f, 0); err == nil && p != "" {
			out = append(out, p)
		}
	}
	if p, err := windows.KnownFolderPath(windows.FOLDERID_RoamingAppData, 0); err == nil && p != "" {
		out = append(out, filepath.Join(p, "Microsoft", "Internet Explorer", "Quick Launch"))
	}
	return out
}

var (
	clsidShellLink  = windows.GUID{Data1: 0x00021401, Data4: [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidShellLinkW   = windows.GUID{Data1: 0x000214F9, Data4: [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidPersistFile  = windows.GUID{Data1: 0x0000010b, Data4: [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	shortcutWalkCap = 600
)

// Calls method n of a COM object.
func comCall(obj uintptr, n int, args ...uintptr) uintptr {
	vtbl := *(*uintptr)(unsafe.Pointer(obj))
	fn := *(*uintptr)(unsafe.Pointer(vtbl + uintptr(n)*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{obj}, args...)...)
	return r
}

// IShellLinkW methods (after IUnknown's three)
const (
	slGetPath         = 3
	slGetIconLocation = 16
	slSetIconLocation = 17
	pfLoad            = 5
	pfSave            = 6
	comRelease        = 2
	comQueryInterface = 0
)

// Points every shortcut to this exe at the given icon group. Returns how many changed.
func retargetShortcuts(exe string, id uintptr, folders []string) int {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if r, _, _ := procCoInit.Call(0, 0x2); r == 0 || r == 1 { // COINIT_APARTMENTTHREADED; S_OK or S_FALSE
		defer procCoUninit.Call()
	}
	name := strings.ToLower(filepath.Base(exe))
	nameA := []byte(name)
	nameW := utf16Bytes(name)
	changed := 0
	seen := 0
	for _, root := range folders {
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if strings.Count(strings.TrimPrefix(p, root), string(filepath.Separator)) > 3 {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.EqualFold(filepath.Ext(p), ".lnk") || seen >= shortcutWalkCap {
				return nil
			}
			seen++
			// only open shortcuts that mention the exe's name at all
			raw, err := os.ReadFile(p)
			if err != nil || len(raw) > 1<<20 {
				return nil
			}
			if !bytes.Contains(bytes.ToLower(raw), nameA) && !bytes.Contains(lowerUTF16(raw), nameW) && !bytes.Contains(lowerUTF16(raw[1:]), nameW) {
				return nil
			}
			if setShortcutIcon(p, exe, id) {
				changed++
			}
			return nil
		})
	}
	if changed > 0 {
		procChangeNotify.Call(shcneAssocChanged, shcnfIDList|shcnfFlushNoWait, 0, 0)
	}
	return changed
}

// Sets one shortcut's icon if it points at exe. True if it was changed.
func setShortcutIcon(lnk, exe string, id uintptr) bool {
	var link uintptr
	r, _, _ := procCoCreate.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, 1 /*CLSCTX_INPROC_SERVER*/, uintptr(unsafe.Pointer(&iidShellLinkW)), uintptr(unsafe.Pointer(&link)))
	if r != 0 || link == 0 {
		return false
	}
	defer comCall(link, comRelease)
	var pf uintptr
	if comCall(link, comQueryInterface, uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&pf))) != 0 || pf == 0 {
		return false
	}
	defer comCall(pf, comRelease)
	path, _ := windows.UTF16PtrFromString(lnk)
	if comCall(pf, pfLoad, uintptr(unsafe.Pointer(path)), 0 /*STGM_READ*/) != 0 {
		return false
	}
	buf := make([]uint16, 1024)
	if comCall(link, slGetPath, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0, 0) != 0 {
		return false
	}
	target := windows.UTF16ToString(buf)
	if target == "" || !strings.EqualFold(filepath.Clean(target), exe) {
		return false
	}
	icon := make([]uint16, 1024)
	var idx int32
	comCall(link, slGetIconLocation, uintptr(unsafe.Pointer(&icon[0])), uintptr(len(icon)), uintptr(unsafe.Pointer(&idx)))
	want := -int32(id) // a negative index means "icon group with this id"
	if strings.EqualFold(windows.UTF16ToString(icon), exe) && idx == want {
		return false
	}
	exeW, _ := windows.UTF16PtrFromString(exe)
	if comCall(link, slSetIconLocation, uintptr(unsafe.Pointer(exeW)), uintptr(want)) != 0 {
		return false
	}
	if comCall(pf, pfSave, 0, 1) != 0 { // save to the file it was loaded from
		return false
	}
	procChangeNotify.Call(shcneUpdateItem, shcnfPathW|shcnfFlushNoWait, uintptr(unsafe.Pointer(path)), 0)
	return true
}

func utf16Bytes(s string) []byte {
	u := windows.StringToUTF16(s)
	u = u[:len(u)-1]
	out := make([]byte, 0, len(u)*2)
	for _, c := range u {
		out = append(out, byte(c), byte(c>>8))
	}
	return out
}

// Lower-cases the ASCII letters of UTF-16LE text (enough for matching a file name).
func lowerUTF16(b []byte) []byte {
	out := make([]byte, len(b))
	copy(out, b)
	for i := 0; i+1 < len(out); i += 2 {
		if out[i+1] == 0 && out[i] >= 'A' && out[i] <= 'Z' {
			out[i] += 'a' - 'A'
		}
	}
	return out
}

