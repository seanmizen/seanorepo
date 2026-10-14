# winlike

A Linux desktop with the look and feel of Windows 10. It runs in a window on
the Windows desktop through WSLg, so you can change it and test it quickly.

![winlike desktop](screenshot.png)

| Part | Tool |
|---|---|
| Window manager (compositor) | [labwc](https://labwc.github.io/) 0.8 with the `Win10` theme from this directory |
| Taskbar and start menu | `lxqt-panel` 2.1 with the `Win10` LXQt theme from this directory |
| Desktop (wallpaper, icons, rubber-band select) | `pcmanfm-qt --desktop` |
| Icons | [We10X](https://github.com/yeyushengfan258/We10X-icon-theme) |
| Cursors | [We10XOS-cursors](https://github.com/yeyushengfan258/We10XOS-cursors) |
| GTK theme | [B00merang Windows-10](https://github.com/B00merang-Project/Windows-10) |
| Fonts and wallpaper | Segoe UI, Consolas and `img0` from `C:\Windows` |

Tested on Debian 13 (trixie) in WSL2 on Windows 10, with WSLg.

## Use it

```bash
utils/winlike/install.sh     # install or update. Safe to run again.
winlike                      # start the desktop in a window
utils/winlike/uninstall.sh   # remove it all
```

`winlike` asks for `sudo` one time after each WSL start. WSLg mounts
`/tmp/.X11-unix` read-only, and Xwayland needs to write there.

## Keyboard

| Keys | Action |
|---|---|
| Win | Open the start menu |
| Ctrl+Esc | Open the start menu |
| Alt+F4 | Close the window |
| Alt+Tab, Alt+Shift+Tab | Switch windows |
| Win+Tab | Switch windows (there is no Task View) |
| Alt+Space | Window menu |
| Win+Left, Win+Right | Snap the window to half of the screen |
| Win+Up | Maximize |
| Win+Down | Restore a maximized or snapped window, else minimize |
| Win+Shift+Up | Stretch the window to full height |
| Win+D, Win+M | Show the desktop |
| Win+1 to Win+9 | Open the app at that taskbar position |
| Win+E | File Explorer (`pcmanfm-qt`) |
| Win+R | Run (`lxqt-runner`) |
| Win+I | Settings (`lxqt-config`) |
| Win+X | Quick Link menu |
| Ctrl+Shift+Esc | Task Manager (`qps`) |
| PrtScn | Copy the screen to the clipboard |
| Win+PrtScn | Save `~/Pictures/Screenshots/Screenshot (N).png` |
| Win+Shift+S | Select an area and copy it to the clipboard |

## Mouse

| Where | Action |
|---|---|
| Title bar: drag | Move. Drag to the top edge to maximize. Drag to a side edge to snap. |
| Title bar: double-click | Maximize or restore |
| Title bar: right-click | Window menu |
| Window icon: click | Window menu |
| Window icon: double-click | Close |
| Window edge or corner: drag | Resize |
| Desktop: drag | Selection rectangle |
| Desktop: right-click | Desktop menu |
| Taskbar button: middle-click | Close the window |

The config does not load the labwc default mouse binds. Windows does not move a
window with Alt+drag, or roll it up when you scroll on the title bar.

## What install.sh changes

1. **Debian packages.** It installs these with `apt` if they are missing:
   `labwc layer-shell-qt lxqt-panel lxqt-qtplugin lxqt-notificationd
   lxqt-config lxqt-runner pcmanfm-qt qterminal featherpad qps grim slurp
   wl-clipboard fontconfig curl ca-certificates`.
2. **Themes from GitHub.** The script pins each one to a commit:

   | Repository | Commit | Installed to |
   |---|---|---|
   | `B00merang-Project/Windows-10` | `3a41166` | `~/.local/share/themes/Windows-10` |
   | `yeyushengfan258/We10X-icon-theme` | `0f52ff2` | `~/.local/share/icons/We10X`, `We10X-dark` |
   | `yeyushengfan258/We10XOS-cursors` | `b971891` | `~/.local/share/icons/We10XOS-cursors` |

3. **Files from Windows.** It copies Segoe UI and Consolas to
   `~/.local/share/fonts/windows/`, and the Windows 10 wallpaper to
   `~/.local/share/winlike/wallpaper.jpg`. These files come with your Windows
   license. Do not commit them or share them.
4. **Config files.** It copies every file in [`home/`](home/) to the same path
   under `~`. A file that ends in `.in` gets `@HOME@` replaced. The first
   install copies each file it replaces into `~/.local/share/winlike/backup/`.
   `uninstall.sh` puts these files back.
5. **`~/Desktop`.** It makes this directory if it does not exist.
   `uninstall.sh` keeps it.

The config files:

| File | Purpose |
|---|---|
| `.config/labwc/rc.xml` | Keybinds, mouse binds, snapping, theme name, fonts, window rules |
| `.config/labwc/menu.xml` | Window menu and Win+X menu |
| `.config/labwc/environment` | Wayland, LXQt platform theme, cursor |
| `.config/labwc/autostart` | Starts the desktop, the taskbar and notifications |
| `.config/lxqt/lxqt.conf` | LXQt theme, icons, cursor, Qt font, Fusion style, Windows palette |
| `.config/lxqt/panel.conf` | Taskbar layout |
| `.config/pcmanfm-qt/winlike/settings.conf.in` | Desktop: wallpaper, Recycle Bin, icon size, font |
| `.config/gtk-3.0/settings.ini` | GTK theme, icons, cursor, font |
| `.config/fontconfig/fonts.conf` | ClearType-style text: full hinting, RGB subpixel antialiasing, Segoe UI as `sans-serif` |
| `.local/bin/winlike` | Starts the session |
| `.local/bin/winlike-panel` | Sends a taskbar shortcut over D-Bus (start menu, show desktop, Win+N) |
| `.local/bin/winlike-screenshot` | PrtScn, Win+PrtScn and Win+Shift+S |
| `.local/share/themes/Win10/labwc/` | Window frame theme and caption button SVGs |
| `.local/share/lxqt/themes/Win10/` | Taskbar and start menu theme, start button logo |

## Windows 10 values in the theme

- Title bar: white, 30 px high. Title in Segoe UI 9, black when active and
  `#999999` when inactive.
- Caption buttons: 46 x 30 px with 10 px glyphs. Hover is `#e5e5e5`. Close
  hover is `#e81123` with a white glyph.
- Taskbar: `#101010`, 40 px high, 48 px buttons. Running apps have a 2 px
  `#76b9ed` line. The active app also has a lighter background.
- Show desktop: a 5 px strip at the right end of the taskbar.
- Start menu and taskbar menus: Windows 10 dark (`#1f1f1f`, `#2b2b2b`).

## Known gaps

- **Win key and the start menu.** LXQt 2.1 has no command to open the menu.
  `winlike-panel` calls the panel over D-Bus, and the menu opens as a normal
  window. A labwc window rule removes its title bar and moves it to the
  bottom-left corner. LXQt 2.3 adds `lxqt-qdbus openmenu`, which opens the
  menu as a real popup. Debian 13 does not have LXQt 2.3.
- **Recycle Bin.** The desktop label is "Trash".
- **Alt+Tab.** labwc shows a list of titles, not window thumbnails.
- **Snap.** There is no quarter snap in the corners and no Snap Assist.
- **Not done:** Win+L (no screen locker), Task View, the search box on the
  taskbar, and thumbnail previews when you hover on a taskbar button.

## Prior work

- **Kali Undercover** (Kali 2019.4) makes Xfce look like Windows 10 with the
  B00merang theme, a Windows 10 icon theme and an Xfce panel profile.
- **B00merang Windows-10** has an `openbox-3` theme. labwc can read it, but the
  Openbox format cannot give the 46 px buttons or the red close hover. Thus
  this directory has a labwc theme of its own.
- **LXQt on labwc**: the [openSUSE LXQt labwc page](https://en.opensuse.org/openSUSE:LXQt_labwc)
  and the [lxqt-wayland-session 0.4.0 release](https://lxqt-project.org/release/2026/04/20/lxqt-wayland-session-0-4-0/),
  which adds `openmenu`.
