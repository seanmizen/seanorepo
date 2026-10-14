# Kali Undercover: what it changes

Kali Undercover is a script that makes the Kali Xfce desktop look like
Windows 10. This page lists each change it makes, and compares each change
with winlike.

Source: [gitlab.com/kalilinux/packages/kali-undercover](https://gitlab.com/kalilinux/packages/kali-undercover),
branch `kali/master`, commit `9dbe4a8ba818` (2026-10-08), package version
2026.3.0. License: GPL-3+. The short quotes on this page come from that
commit.

All facts on this page come from the source code. We did not run Kali
Undercover, because it needs a running Xfce session with `xfconfd`.

## How it works

The package has one shell script, `bin/kali-undercover`, and data files.
The script is a toggle:

1. It stops if `xfconfd` does not run ("Undercover Mode only works on Xfce
   desktop").
2. It stops `xfce4-panel`.
3. If `~/.local/share/kali-undercover/user-profile.tar.bz2` does not exist,
   it saves the current settings to that file, then loads the undercover
   profile.
4. If the file exists, it loads the saved settings and removes the
   undercover changes.
5. It starts `xfce4-panel` again.

The profile is a tar file of five Xfce settings channels: `xfce4-panel`,
`xfce4-desktop`, `xfce4-notifyd`, `xfwm4` and `xsettings`. A Python helper
(`share/kali-undercover/scripts/xfce4-desktop-profiles.py`, based on
`xfce4-panel-profiles`) reads and writes them over D-Bus
(`org.xfce.Xfconf`).

The package also has two more profiles: `backtrack` and `halloween`. This
page covers only `undercover`.

## Changes, one by one

Legend for the winlike column:

- **Done**: winlike does the same thing, or a closer match to Windows 10.
- **Partial**: winlike does a part of it.
- **Skipped**: winlike does not do it. The reason follows.
- **N/A**: the change has no meaning for winlike.

### Window manager (`xfwm4` channel)

| Setting | Kali value | winlike | Status |
|---|---|---|---|
| Window theme | `Windows-10` (xfwm4 theme from B00merang) | Own labwc theme `Win10`: 46 x 30 px caption buttons, red close hover | Done |
| Button layout | `O|HMC` (window menu icon at left. Minimize, maximize, close at right) | `icon:iconify,max,close` | Done |
| Title alignment | `left` | Left (labwc default) | Done |
| Title font | `Liberation Sans 9` | `Segoe UI 9` (issue #665 replaces Segoe UI) | Done |
| Maximized windows keep borders | `borderless_maximize false` | Not set (labwc default) | Skipped. Small. |

### GTK settings (`xsettings` channel)

| Setting | Kali value | winlike | Status |
|---|---|---|---|
| GTK theme | `Windows-10` | `Windows-10` (same B00merang theme, from GitHub) | Done |
| Icon theme | `Windows-10-Icons` (B00merang icon pack, in the package) | `We10X` (issue #665 replaces it) | Done |
| Cursor theme | `Windows-10-Icons` | `We10XOS-cursors` (issue #665 replaces it) | Done |
| Font | `Liberation Sans 11` | `Segoe UI 9` | Done |
| `DecorationLayout` (client-side title bars) | `:minimize,maximize,close` | Not set | Skipped. labwc draws the title bar for most apps. A GTK app that draws its own title bar uses the GTK theme default. |
| Icons in buttons | `ButtonImages false` | Not set | Skipped. The GTK 3 default is already no icons in buttons. |
| Icons in menus | `MenuImages true` | Not set | Skipped. Small. GTK 3 ignores most menu images. |

### Taskbar (`xfce4-panel` channel)

Kali makes one panel at the bottom (`p=8`), 44 px high, full width, with
24 px icons. From left to right:

| Kali item | Windows 10 item | winlike | Status |
|---|---|---|---|
| Whisker Menu, 678 x 710 px, with favorites | Start menu | `fancymenu` in `lxqt-panel` | Done |
| Launcher: `xfce4-appfinder`, search icon | Search box or Cortana button | None | Skipped. See [gaps.md](gaps.md), item "Search on the taskbar". |
| Launcher: next workspace (`xdotool set_desktop --relative 1`) | Task View button | None | Skipped. winlike has one desktop and no Task View. |
| Show desktop button (at the left end). | Show desktop strip (at the right end). | 5 px strip at the right end. | Done. winlike puts it where Windows 10 puts it. |
| Directory menu on `/home/kali` | File Explorer pinned to the taskbar | Quick launch: file manager | Done |
| Pinned items: terminal, web browser, text editor | Pinned apps | Quick launch: file manager, terminal, text editor | Done |
| Task list, icons only, no labels | Taskbar buttons, combined | `taskbar`, icons only, grouped | Done |
| Power manager, tray, PulseAudio volume | Notification area | `statusnotifier`, `volume` | Done |
| Clock: two lines, time and date (`%_H:%M`, `%m/%d/%Y`) | Clock: time above the date | `worldclock`: `HH:mm` above `dd/MM/yyyy` | Done |
| Notification plugin (bell icon) at the right end | Action Center button | None | Skipped. See [gaps.md](gaps.md), item "Action Center". |

Kali puts the clock format strings in the opposite fields
(`digital-date-format '%_H:%M'`, `digital-time-format '%m/%d/%Y'`). We did
not run the plugin, so we do not know which line shows first.

### Desktop (`xfce4-desktop` channel)

| Setting | Kali value | winlike | Status |
|---|---|---|---|
| Wallpaper | `Windows-10.jpg` (in the package), zoomed | Windows 10 `img0` from `C:\Windows` (issue #665 replaces it) | Done |
| Background color | `#2068b2` | `#000000` | Done. The color shows only if the wallpaper is missing. |
| Desktop icons | File system, home, removable drives, trash | Trash only | Done. Windows 10 shows only the Recycle Bin by default. |
| Icon size | 48 px | 48 px | Done |
| One wallpaper for all workspaces | `single-workspace-mode true` | One desktop | Done |

### Notifications (`xfce4-notifyd` channel)

| Setting | Kali value | winlike | Status |
|---|---|---|---|
| Position | `notify-location 3` (bottom right) | `lxqt-notificationd` default is `bottom-right` (from the 2.1.0 source, `notifyd.cpp`) | Done |
| Slide-out animation | `do-slideout true` | None | Skipped. Small. |
| Opacity | `0.8` | Opaque | Skipped. Windows 10 toasts are opaque. |

### Files outside Xfce settings

| Change | How | winlike | Status |
|---|---|---|---|
| Qt style and colors | Copies `qt5ct.conf` and `qt6ct.conf`. They set Fusion style, `Windows-10-Icons`, palette `Windows.conf` and `Liberation Sans 11`. | `lxqt.conf`: Fusion style, Windows palette, Segoe UI 9. | Done |
| Selection color | `Windows.conf` sets highlight `#cce8ff` with black text: the Explorer item color | `#0078d7` with white text: the Win32 list and menu color | Partial. See [gaps.md](gaps.md), item "Explorer selection color". |
| Terminal look | Copies `qterminal.org/qterminal.ini`: white on black, `Liberation Mono 11`, no margin | Issue #666 (Ghostty) | Skipped here |
| Shell prompt | Appends a line to `~/.bashrc` and `~/.zshrc` that sources a prompt file. The prompt is `C:${PWD//\//\\}> ` | None | Skipped. See [gaps.md](gaps.md), item "Command prompt look". |
| User picture | Moves `~/.face` to `~/.face.undercover` and copies a plain avatar to `~/.face` | None | Skipped. The LXQt start menu shows no user picture. |
| Firefox light theme | `gsettings set org.gnome.desktop.interface color-scheme 'default'` | None | Skipped. See [gaps.md](gaps.md), item "Dark and light mode for apps". |
| Mousepad colors | Sets `Kali-Light` if the color scheme is `Kali-Dark` | N/A | N/A. winlike uses FeatherPad with its default light colors. |
| Plank dock | Stops `plank`, and starts it again on restore | N/A | N/A |
| Old notifications | Stops `xfce4-notifyd` | N/A | N/A |
| Undo | A second run restores the saved tar file and renames `*.undercover` files back. It also removes the lines from `~/.bashrc` and `~/.zshrc`. | `uninstall.sh` puts back the files from `~/.local/share/winlike/backup/`. | Done |

## What winlike can learn from it

1. **Taskbar search and Action Center buttons.** Kali puts a search
   launcher and a bell icon on the taskbar. winlike has neither. These are
   items in [gaps.md](gaps.md).
2. **Explorer selection color.** The file view in Windows 10 Explorer uses
   `#cce8ff` with black text. Kali uses this color for all Qt apps. winlike
   uses `#0078d7`, which is correct for menus and list boxes but not for
   the Explorer file view.
3. **A light color scheme for apps.** Kali sets the GNOME `color-scheme`
   key, because Firefox reads it. winlike does not set it.
4. **A Windows prompt.** Kali changes the shell prompt to `C:\...>`. This
   is a disguise feature. It is not useful for daily work, but it is cheap.

## What winlike does better

- Real Windows 10 sizes: 40 px taskbar (Kali: 44 px), 30 px title bar and
  46 px caption buttons, red close hover. The xfwm4 theme from B00merang
  cannot draw these. See the README section "Prior work".
- Windows 10 keyboard and mouse behavior: Win key, Win+arrows snap, Aero
  Snap by drag, title bar clicks. Kali Undercover changes only the look.
- The desktop shows only the Trash, as Windows 10 shows only the Recycle
  Bin.
- Show desktop sits at the right end of the taskbar.
