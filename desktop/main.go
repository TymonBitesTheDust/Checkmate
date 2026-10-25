//go:build windows

// Checkmate for Windows: a native window (Microsoft Edge WebView2) showing the
// bundled web app, served from a fixed local address so its data persists.
package main

import (
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const (
	appName   = "Checkmate"
	iconResID = 1
)

var (
	user32          = windows.NewLazySystemDLL("user32.dll")
	shell32         = windows.NewLazySystemDLL("shell32.dll")
	procFindWindow  = user32.NewProc("FindWindowW")
	procShowWindow  = user32.NewProc("ShowWindow")
	procSetFg       = user32.NewProc("SetForegroundWindow")
	procIsIconic    = user32.NewProc("IsIconic")
	procMessageBox  = user32.NewProc("MessageBoxW")
	procLoadImage   = user32.NewProc("LoadImageW")
	procGetDpi      = user32.NewProc("GetDpiForSystem")
	procFlashWindow = user32.NewProc("FlashWindowEx")
	procShellNotify = shell32.NewProc("Shell_NotifyIconW")
	procSysMetrics  = user32.NewProc("GetSystemMetrics")
	procSendMessage = user32.NewProc("SendMessageW")
)

func main() {
	// One window at a time: a second launch brings the first one forward.
	name, _ := windows.UTF16PtrFromString("Local\\TickwiseDesktopSingleInstance")
	mutex, err := windows.CreateMutex(nil, false, name)
	if err == windows.ERROR_ALREADY_EXISTS {
		focusExisting()
		return
	}
	defer windows.CloseHandle(mutex)
	cleanupFileIcon()

	base := startServer()

	dataDir := dataFolder()
	_ = os.MkdirAll(dataDir, 0o755)

	width, height := windowSize()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     os.Getenv("CHECKMATE_DEBUG") == "1",
		AutoFocus: true,
		DataPath:  dataDir,
		WindowOptions: webview2.WindowOptions{
			Title:  appName,
			Width:  width,
			Height: height,
			IconId: iconResID,
			Center: true,
		},
	})
	if w == nil {
		fallback(base)
		return
	}
	defer w.Destroy()

	hwnd := uintptr(w.Window())
	w.SetSize(int(scale(380)), int(scale(520)), webview2.HintMin)

	tray := &trayIcon{hwnd: hwnd}
	defer tray.remove()

	_ = w.Bind("twOpenExternal", func(raw string) {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "mailto") {
			return
		}
		openURL(u.String())
	})
	// The app asks for the icon that matches the current style; follow says whether the
	// shortcuts and Checkmate.exe should change too (Settings → General).
	_ = w.Bind("twSetIcon", func(style string, follow bool) {
		applyStyleIcon(hwnd, style, follow)
	})
	_ = w.Bind("twNotify", func(title, body string) {
		tray.notify(title, body)
		flash(hwnd)
	})
	// Docs & Sheets: read a shared Google Doc/Sheet off the window's thread and
	// hand the answer back to the page (see fetch.go).
	_ = w.Bind("twFetch", func(id, raw string) {
		go func() {
			status, text := fetchText(raw)
			js := fetchReply(id, status, text)
			w.Dispatch(func() { w.Eval(js) })
		}()
	})

	w.Navigate(base + "/")
	w.Run()
	finishFileIcon()
}

// ---------------------------------------------------------------- window helpers

func dpi() uintptr {
	if procGetDpi.Find() == nil {
		if d, _, _ := procGetDpi.Call(); d > 0 {
			return d
		}
	}
	return 96
}

func scale(v uint) uint { return uint(uintptr(v) * dpi() / 96) }

func windowSize() (uint, uint) {
	w, h := scale(1180), scale(800)
	sw, _, _ := procSysMetrics.Call(0) // SM_CXSCREEN
	sh, _, _ := procSysMetrics.Call(1) // SM_CYSCREEN
	if sw > 0 && uint(sw)*9/10 < w {
		w = uint(sw) * 9 / 10
	}
	if sh > 0 && uint(sh)*85/100 < h {
		h = uint(sh) * 85 / 100
	}
	return w, h
}

// The app was called Tickwise before it was renamed. Its tasks and settings live in
// the WebView's data folder, so on first start the old %LOCALAPPDATA%\Tickwise folder
// is moved to %LOCALAPPDATA%\Checkmate. If that can't happen (an old copy is still
// open), the old folder is used as it is, and nothing is lost.
const oldName = "Tickwise"

func dataFolder() string {
	base := os.Getenv("LOCALAPPDATA")
	dir := filepath.Join(base, appName)
	old := filepath.Join(base, oldName)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if _, err := os.Stat(old); err == nil {
			if os.Rename(old, dir) != nil {
				return old
			}
		}
	}
	return dir
}

func focusExisting() {
	class, _ := windows.UTF16PtrFromString("webview")
	var hwnd uintptr
	// an older copy still open shows the old name in its title bar
	for _, name := range []string{appName, oldName} {
		title, _ := windows.UTF16PtrFromString(name)
		hwnd, _, _ = procFindWindow.Call(uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)))
		if hwnd != 0 {
			break
		}
	}
	if hwnd == 0 {
		return
	}
	if iconic, _, _ := procIsIconic.Call(hwnd); iconic != 0 {
		procShowWindow.Call(hwnd, 9) // SW_RESTORE
	}
	procSetFg.Call(hwnd)
}

func openURL(u string) {
	verb, _ := windows.UTF16PtrFromString("open")
	target, _ := windows.UTF16PtrFromString(u)
	_ = windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}

func messageBox(text, caption string, flags uintptr) uintptr {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString(caption)
	r, _, _ := procMessageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
	return r
}

// No WebView2 runtime: offer the download and open the app in the browser meanwhile.
// Windows display language is Traditional Chinese (Taiwan, Hong Kong, Macau).
func chineseUI() bool {
	lang, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetUserDefaultUILanguage").Call()
	switch lang & 0xFFFF {
	case 0x0404, 0x0C04, 0x1404, 0x7C04:
		return true
	}
	return false
}

func fallback(base string) {
	const yes = 6
	missing := "Checkmate needs the Microsoft Edge WebView2 Runtime, which is missing on this PC.\n\n" +
		"Choose Yes to download it from Microsoft (free, about 2 minutes), then open Checkmate again.\n" +
		"Choose No to use Checkmate in your web browser for now. Keep this message open while you use it."
	running := "Checkmate is running in your browser. Close this message to quit."
	if chineseUI() {
		missing = "Checkmate 需要 Microsoft Edge WebView2 Runtime，但這部電腦尚未安裝。\n\n" +
			"選「是」從 Microsoft 下載（免費，約 2 分鐘），然後再次開啟 Checkmate。\n" +
			"選「否」先在網頁瀏覽器中使用 Checkmate，使用期間請保持這個訊息開啟。"
		running = "Checkmate 正在你的瀏覽器中執行。關閉這個訊息即可結束。"
	}
	r := messageBox(missing, appName, 0x00000004|0x00000030) // MB_YESNO | MB_ICONWARNING
	if r == yes {
		openURL("https://go.microsoft.com/fwlink/p/?LinkId=2124703")
		return
	}
	openURL(base + "/")
	messageBox(running, appName, 0x00000040)
}

type flashInfo struct {
	cbSize    uint32
	hwnd      uintptr
	dwFlags   uint32
	uCount    uint32
	dwTimeout uint32
}

func flash(hwnd uintptr) {
	fi := flashInfo{hwnd: hwnd, dwFlags: 0x3 | 0xC, uCount: 3} // FLASHW_ALL | FLASHW_TIMERNOFG
	fi.cbSize = uint32(unsafe.Sizeof(fi))
	procFlashWindow.Call(uintptr(unsafe.Pointer(&fi)))
}

// ---------------------------------------------------------------- notifications

// NOTIFYICONDATAW (Vista+ layout).
type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     uintptr
}

const (
	nimAdd     = 0
	nimModify  = 1
	nimDelete  = 2
	nifMessage = 0x1
	nifIcon    = 0x2
	nifTip     = 0x4
	nifInfo    = 0x10
	niifUser   = 0x4
	niifLarge  = 0x20
	wmTray     = 0x8000 + 77 // WM_APP + 77, ignored by the window procedure
)

type trayIcon struct {
	hwnd  uintptr
	added bool
	mu    sync.Mutex
}

// Icon groups are listed in appicon_windows.go. #1 is the file icon (the last style used).
var currentIcon uintptr = iconResID

func loadIconID(id uintptr, size int) uintptr {
	var h windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &h)
	icon, _, _ := procLoadImage.Call(uintptr(h), id, 1, uintptr(size), uintptr(size), 0x8000) // IMAGE_ICON, LR_SHARED
	return icon
}

func loadIcon(size int) uintptr { return loadIconID(atomic.LoadUintptr(&currentIcon), size) }

// Swaps the title-bar and taskbar icon.
func setWindowIcon(hwnd uintptr, id uintptr) {
	if id == 0 {
		id = iconResID
	}
	big, _, _ := procSysMetrics.Call(11)   // SM_CXICON
	small, _, _ := procSysMetrics.Call(49) // SM_CXSMICON
	if h := loadIconID(id, int(big)); h != 0 {
		procSendMessage.Call(hwnd, 0x0080, 1, h) // WM_SETICON, ICON_BIG
	}
	if h := loadIconID(id, int(small)); h != 0 {
		procSendMessage.Call(hwnd, 0x0080, 0, h) // WM_SETICON, ICON_SMALL
	}
	atomic.StoreUintptr(&currentIcon, id)
}

func copyUTF16(dst []uint16, s string) {
	u, _ := syscall.UTF16FromString(s)
	if len(u) > len(dst) {
		u = u[:len(dst)]
		u[len(u)-1] = 0
	}
	copy(dst, u)
}

// Shows a Windows notification (shown as a toast on Windows 10 and 11).
func (t *trayIcon) notify(title, body string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	nid := notifyIconData{HWnd: t.hwnd, UID: 1, UCallbackMessage: wmTray}
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.HIcon = loadIcon(16)
	copyUTF16(nid.SzTip[:], appName)
	if !t.added {
		nid.UFlags = nifMessage | nifIcon | nifTip
		procShellNotify.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
		t.added = true
	}
	nid.UFlags = nifInfo | nifIcon | nifTip
	copyUTF16(nid.SzInfoTitle[:], title)
	copyUTF16(nid.SzInfo[:], body)
	nid.DwInfoFlags = niifUser | niifLarge
	nid.HBalloonIcon = loadIcon(64)
	procShellNotify.Call(nimModify, uintptr(unsafe.Pointer(&nid)))
}

func (t *trayIcon) remove() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.added {
		return
	}
	nid := notifyIconData{HWnd: t.hwnd, UID: 1}
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	procShellNotify.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
	t.added = false
}
