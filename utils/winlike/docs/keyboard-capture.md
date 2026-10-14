# Keyboard capture and full screen

This page tells how to run winlike full screen with the keyboard captured, as
in VMware. When the keyboard is captured, Win combinations and Alt+Tab go to
winlike, not to Windows. Right Ctrl releases the keyboard.

## Summary

| Part | Method | Admin rights |
|---|---|---|
| Capture | `windows/winlike-capture.ahk` (AutoHotkey v2) sends F13 to F18 in place of the keys that Windows keeps. The `winlike:capture` xkb option in winlike changes them back. | No |
| Release | Right Ctrl, pressed and released alone, turns capture off and on. The tray icon shows the state. | No |
| Full screen | `winlike --fullscreen` sets the labwc output to the monitor size. Ctrl+Alt+Enter (in the AutoHotkey script) moves the window over the whole monitor. | No |

Windows always gets Ctrl+Alt+Del and Win+L. No program can capture them.
VMware also cannot capture them.

## How keys get to labwc

1. WSLg runs Weston in the WSL system distro. Weston sends each Linux window
   to Windows over RDP in RemoteApp mode (RAIL). On Windows, `msrdc.exe`
   shows each Linux window as a separate Windows window.
2. `winlike` starts labwc as a Wayland client of Weston. Weston shows the
   labwc output as one window. wlroots gives it the title `wlroots - WL-1`.
3. When this window is active, `msrdc.exe` sends each key to Weston as a scan
   code. Weston sends it to labwc.
4. Windows handles its own shortcuts before `msrdc.exe` gets the key. The
   Windows shell keeps Win+E, Win+D, Win+R, Alt+Tab, Ctrl+Esc and similar
   keys.

The RDP property `keyboardhook` controls step 4 in a normal RDP client.
The WSLg files on this computer do not set it:

```text
C:\Program Files\WSL\wslg.rdp          (RemoteApp mode, the default)
audiocapturemode:i:2
authentication level:i:0
disableconnectionsharing:i:1
enablecredsspsupport:i:0
hvsocketenabled:i:1
remoteapplicationmode:i:1
remoteapplicationprogram:s:dummy-entry
```

The default value is `2`: Windows key combinations go to the remote side
only in a full screen desktop session. A RemoteApp window is not a desktop
session, so Windows keeps the keys. The value `3` sends the keys to a
RemoteApp window when it has focus, but only in the Windows RDP client
([RDP properties](https://learn.microsoft.com/en-us/azure/virtual-desktop/rdp-properties#keyboardhook)).

## Which keys get to labwc

Run `winlike-keytest` to find out. It starts a test session that has no
keybinds and a window that lists the combinations. Each row turns green when
labwc gets the key. Run it two times: first without the AutoHotkey script,
then with the script and capture on. The results go to the terminal and to
`/tmp/winlike-keytest.txt`.

The table shows the expected results. The "Today" column comes from how
Windows and RDP handle keys (see above). It is not measured yet: the agent
that wrote this page cannot press keys in a Windows window. Replace each
"expected" with the result from `winlike-keytest`.

| Keys | Today, without capture | With winlike-capture.ahk |
|---|---|---|
| Win alone | Expected: yes, but the Windows Start menu also opens | Expected: yes (F13 = Super_L) |
| Win+E, Win+R, Win+I, Win+X, Win+D, Win+M | Expected: no (Windows) | Expected: yes |
| Win+1 to Win+9, Win+Tab | Expected: no (Windows) | Expected: yes |
| Win+arrows, Win+Shift+Up | Expected: no (Windows snaps the WSLg window) | Expected: yes |
| Win+Shift+S, Win+PrtScn | Expected: no (Windows screenshot) | Expected: yes |
| Alt+Tab, Alt+Shift+Tab | Expected: no (Windows switcher) | Expected: yes (F14 = Tab) |
| Alt+Space | Expected: no (Windows window menu) | Expected: yes (F16 = Space) |
| Ctrl+Esc | Expected: no (Windows Start menu) | Expected: yes (F15 = Esc) |
| Ctrl+Shift+Esc | Expected: no (Windows Task Manager) | Expected: yes (F15 = Esc) |
| PrtScn | Expected: no (Windows copies the screen) | Expected: yes (F17 = Print) |
| Alt+F4 | Not known. Windows can close the whole WSLg window. | Expected: yes (F18 = F4) |
| Ctrl+C and other keys that Windows does not use | Yes | Yes |
| Win+L, Ctrl+Alt+Del | No | No |

## Capture methods

| Method | Right Ctrl release | Admin rights | Scope | Result |
|---|---|---|---|---|
| AutoHotkey v2 script | Yes | No (portable zip or per-user install) | Only the winlike window | **Chosen** |
| `keyboardhook:i:3` in `wslg.rdp` | No | Yes. The file is in `C:\Program Files\WSL`, and a WSL update replaces it. | Every WSLg window | Not tested. Try it if the script fails. |
| WSLg desktop mode: `WSL2_WESTON_SHELL_DESKTOP=true` in `.wslgconfig` | No. RDP uses Ctrl+Alt+Break. | No | One RDP desktop window for all WSLg apps | Rejected |
| PowerToys Keyboard Manager | No | No (per-user install) | Per app, but no toggle key and no indicator | Rejected |
| SharpKeys or a `Scancode Map` | No | Yes | All of Windows | Rejected |

### AutoHotkey v2 script

An AutoHotkey keyboard hook gets each key before the Windows shell. Thus the
script can stop Win+E, Alt+Tab and similar keys
([AutoHotkey hotkeys](https://www.autohotkey.com/docs/v2/Hotkeys.htm),
[Alt-Tab](https://www.autohotkey.com/docs/v2/Hotkeys.htm#alttab)). When
capture is on and the winlike window is active, the script:

- Remaps Win to F13
  ([remapping](https://www.autohotkey.com/docs/v2/misc/Remap.htm)). Windows
  never sees the Win key, so it does not open the Start menu or run a Win
  shortcut.
- Sends F14 in place of Tab in Alt+Tab, F15 in place of Esc in Ctrl+Esc, F16
  in place of Space in Alt+Space, F17 in place of PrtScn and F18 in place of
  F4 in Alt+F4. `{Blind}` keeps Alt, Ctrl and Shift down.

In winlike, `~/.config/labwc/environment` sets
`XKB_DEFAULT_OPTIONS=winlike:capture`. The xkb files in `~/.config/xkb/`
change F13 to `Super_L` with the Mod4 modifier, and F14 to F18 to Tab,
Escape, space, Print and F4. Thus labwc gets real Win combinations, and the
keybinds in `rc.xml` do not change. A check with libxkbcommon 1.7 gave this
result:

```text
F13 -> Super_L    (Mod4 is active while F13 is down)
F14 -> Tab
F15 -> Escape
F16 -> space
F17 -> Print
```

### keyboardhook in wslg.rdp

WSLg starts `msrdc.exe` with `C:\Program Files\WSL\wslg.rdp`
([WSLGd/main.cpp](https://github.com/microsoft/wslg/blob/main/WSLGd/main.cpp)).
If you add `keyboardhook:i:3` to this file, `msrdc.exe` can send Win
combinations to every WSLg window. You need admin rights to change the file.
A WSL update replaces it. There is no release key.

### WSLg desktop mode

WSLg reads `.wslgconfig` from your Windows profile. It copies each key in the
`[system-distro-env]` section into the environment of WSLGd before it reads
`WSL2_WESTON_SHELL_DESKTOP` ([WSLGd/main.cpp](https://github.com/microsoft/wslg/blob/main/WSLGd/main.cpp)).
Thus this file starts Weston with its desktop shell and `wslg_desktop.rdp`,
which is a normal RDP desktop session:

```ini
[system-distro-env]
WSL2_WESTON_SHELL_DESKTOP=true
```

In full screen, the default `keyboardhook` value `2` then sends Win
combinations to Weston. But every Linux GUI app goes into this one desktop
window, and the change needs `wsl --shutdown`. This mode is for WSLg
debugging. It was not tested.

## Full screen

labwc runs nested. The wlroots Wayland backend opens a 1280x720 window.
`WLR_WL_OUTPUTS` sets only the number of windows, not the size. labwc 0.8 has
no output section in `rc.xml`. But labwc supports the wlr-output-management
protocol, so `wlr-randr` can set the size:

```bash
wlr-randr --output WL-1 --custom-mode 1920x1080
```

A test in a nested labwc 0.8.3 under WSLg changed the output and the window
from 1280x720 to 1920x1080. `winlike --size WxH` and `winlike --fullscreen`
use this. `--fullscreen` gets the size of the monitor at 0,0 from WSLg (GDK).
`~/.config/labwc/autostart` runs `wlr-randr` before it starts the taskbar.

Windows decides where the window goes. To put it over the whole monitor and
the Windows taskbar, press Ctrl+Alt+Enter in the winlike window. The
AutoHotkey script moves the window to the monitor bounds. WSLg sends the new
size to labwc. Press Ctrl+Alt+Enter again to put the window back. Without
the script, Win+Up maximizes the window to the work area, above the Windows
taskbar.

These Windows-side steps are not tested yet. If the Windows taskbar stays in
front of the window, report it, and the script can make the window
always-on-top while it is full screen.

## Set it up

1. In WSL, install the new packages and config:

   ```bash
   utils/winlike/install.sh
   ```

2. On Windows, get AutoHotkey v2 without admin rights. Download the zip from
   <https://www.autohotkey.com/download/>, and extract it to
   `%LOCALAPPDATA%\Programs\AutoHotkey`.
3. Copy the script to Windows:

   ```bash
   mkdir -p /mnt/c/Users/sean/winlike
   cp utils/winlike/windows/winlike-capture.ahk /mnt/c/Users/sean/winlike/
   ```

4. Start the script when you sign in to Windows. Press Win+R, type
   `shell:startup`, and make a shortcut there with this target:

   ```text
   "%LOCALAPPDATA%\Programs\AutoHotkey\AutoHotkey64.exe" "%USERPROFILE%\winlike\winlike-capture.ahk"
   ```

   Then open the shortcut one time to start the script now.
5. Start winlike: `winlike --fullscreen`. Click in the window, then press
   Ctrl+Alt+Enter.
6. Check the window title with Window Spy (AutoHotkey tray menu). If it does
   not contain `wlroots - WL-`, change the `GroupAdd` line in the script.
7. Run `winlike-keytest` two times (without and with the script). Put the
   results in the table above.

## Use it

| Keys | Action |
|---|---|
| Right Ctrl (alone) | Turn capture off or on. A tooltip shows the new state. |
| Ctrl+Alt+Enter | Full screen on or off |

The tray icon is a padlock while winlike has the keyboard. It is the
AutoHotkey icon at all other times. Capture works only while the winlike
window is active. When you click another window, Windows gets all keys again.
