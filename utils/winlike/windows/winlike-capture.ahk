; winlike-capture.ahk: full keyboard capture for the winlike desktop.
; AutoHotkey v2. It needs no admin rights. See docs/keyboard-capture.md.
;
; Windows keeps some keys for itself (Win combinations, Alt+Tab, Ctrl+Esc,
; PrtScn). They do not get to the WSLg window. When the winlike window is
; active and capture is on, this script sends F13 to F18 in place of these
; keys. Windows does nothing with F13 to F18. In winlike, the xkb option
; winlike:capture (~/.config/xkb/symbols/winlike) changes them back:
;
;   Win  -> F13 -> Super_L (it is a modifier, so Win+E etc. work)
;   Tab  in Alt+Tab, Alt+Shift+Tab        -> F14 -> Tab
;   Esc  in Ctrl+Esc, Ctrl+Shift+Esc      -> F15 -> Escape
;   Space in Alt+Space                    -> F16 -> space
;   PrtScn                                -> F17 -> Print
;   F4   in Alt+F4                        -> F18 -> F4
;
; Right Ctrl, pressed and released alone in the winlike window, turns capture
; off and on (as in VMware). The tray icon shows the state: a padlock when
; the keyboard is captured, the AutoHotkey icon when it is not.
; Ctrl+Alt+Enter in the winlike window: full screen on, full screen off.
;
; Capture cannot stop Ctrl+Alt+Del or Win+L. Windows always gets them.

#Requires AutoHotkey v2.0
#SingleInstance Force
InstallKeybdHook
SetTitleMatchMode 2   ; A title matches when it contains the text.

; The winlike window. labwc runs nested in a WSLg window. wlroots gives that
; window the title "wlroots - WL-1", and WSLg adds the distro name. All WSLg
; windows belong to msrdc.exe. If the title is different on your computer,
; use Window Spy (in the AutoHotkey tray menu) and change this line.
GroupAdd "winlike", "wlroots - WL- ahk_exe msrdc.exe"

global capture := true   ; Capture is on at the start.
global shown := ""       ; The state that the tray icon shows now.

A_TrayMenu.Insert("1&", "Capture keyboard (Right Ctrl)", (*) => ToggleCapture())
A_TrayMenu.Insert("2&")
SetTimer UpdateIndicator, 250
UpdateIndicator()

Captured() => capture && WinActive("ahk_group winlike")

; Turn capture off or on. The tooltip tells you the new state.
ToggleCapture() {
    global capture := !capture
    UpdateIndicator()
    if capture
        ToolTip "winlike: keyboard captured (Right Ctrl to release)"
    else
        ToolTip "winlike: keyboard released (Right Ctrl to capture)"
    SetTimer () => ToolTip(), -1500
}

; Set the tray icon and its text for the current state.
UpdateIndicator() {
    global shown
    state := Captured() ? "on" : capture ? "armed" : "off"
    if (state = shown)
        return
    shown := state
    if (state = "on") {
        TraySetIcon "shell32.dll", 48   ; padlock
        A_IconTip := "winlike: keyboard captured. Right Ctrl releases it."
    } else {
        TraySetIcon "*"                 ; the AutoHotkey icon
        if (state = "armed")
            A_IconTip := "winlike: capture is on when the winlike window is active."
        else
            A_IconTip := "winlike: capture is off. Right Ctrl in winlike turns it on."
    }
}

; Find the monitor that holds the centre of the window.
MonitorOf(x, y, w, h) {
    cx := x + w // 2, cy := y + h // 2
    Loop MonitorGetCount() {
        MonitorGet A_Index, &l, &t, &r, &b
        if (cx >= l && cx < r && cy >= t && cy < b)
            return A_Index
    }
    return MonitorGetPrimary()
}

; Full screen on: keep the window position, then fill the monitor.
; Full screen off: put the window back. WSLg sends the new size to labwc.
ToggleFullscreen() {
    static saved := Map()
    hwnd := WinExist("A")
    if saved.Has(hwnd) {
        r := saved.Delete(hwnd)
        WinMove r[1], r[2], r[3], r[4], hwnd
        return
    }
    WinGetPos &x, &y, &w, &h, hwnd
    saved[hwnd] := [x, y, w, h]
    MonitorGet MonitorOf(x, y, w, h), &l, &t, &r, &b
    WinMove l, t, r - l, b - t, hwnd
}

; Right Ctrl alone toggles capture. The "~" lets Right Ctrl go through, so
; Right Ctrl+C and the other combinations still work.
#HotIf WinActive("ahk_group winlike")
~RCtrl up:: {
    if (A_PriorKey = "RControl")
        ToggleCapture()
}
^!Enter::ToggleFullscreen()

; The keys that capture replaces. "{Blind}" keeps the held modifiers down,
; so labwc gets Alt+F14 (Alt+Tab), Ctrl+F15 (Ctrl+Esc) and so on.
#HotIf Captured()
LWin::F13
RWin::F13
!Tab::Send "{Blind}{F14}"
!+Tab::Send "{Blind}{F14}"
^Esc::Send "{Blind}{F15}"
^+Esc::Send "{Blind}{F15}"
!Space::Send "{Blind}{F16}"
*PrintScreen::Send "{Blind}{F17}"
!F4::Send "{Blind}{F18}"
#HotIf
