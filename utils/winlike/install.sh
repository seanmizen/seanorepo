#!/usr/bin/env bash
# Install the winlike desktop: labwc + lxqt-panel + pcmanfm-qt with Windows 10
# behavior and layout, and Debian default icons, cursors, font and wallpaper.
# Safe to run again. Every run gives the same result.
# Undo: ./uninstall.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
cd "$HOME"
[ -d .config ] || { echo "install.sh: $HOME/.config does not exist" >&2; exit 1; }

# 1. Debian packages
packages=(
  labwc layer-shell-qt
  lxqt-panel lxqt-qtplugin lxqt-notificationd lxqt-config lxqt-runner
  pcmanfm-qt qterminal featherpad qps
  grim slurp wl-clipboard
  breeze-icon-theme breeze-cursor-theme fonts-open-sans fontconfig
  desktop-base
)
missing=()
for p in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "==> apt: ${missing[*]}"
  sudo apt-get install -y --no-install-recommends "${missing[@]}"
fi

# 2. Files from older versions of install.sh: Windows themes, icons, cursors,
#    fonts and wallpaper. Remove them. Literal paths, relative to $HOME.
for d in \
  .local/share/themes/Windows-10 \
  .local/share/themes/Win10 \
  .local/share/lxqt/themes/Win10 \
  .local/share/icons/We10X \
  .local/share/icons/We10X-dark \
  .local/share/icons/We10XOS-cursors \
  .local/share/fonts/windows \
  .local/share/winlike/wallpaper.jpg; do
  if [ -e "$d" ]; then
    rm -rf -- "$d"
    echo "==> removed old file: ~/$d"
  fi
done

# 3. Config files
#    The first install copies each file it will replace into
#    ~/.local/share/winlike/backup/. Later runs keep that backup as it is,
#    so uninstall.sh always puts back the files from before the first install.
echo "==> Config files"
backup=.local/share/winlike/backup
first_install=no
[ -d "$backup" ] || first_install=yes
mkdir -p "$backup"
render() { # Files that end in .in get @HOME@ replaced.
  sed "s|@HOME@|$HOME|g" "$here/home/$1"
}
while IFS= read -r -d '' rel; do
  rel=${rel#./}
  dest=${rel%.in}
  if [ "$first_install" = yes ] && [ -e "$dest" ]; then
    mkdir -p "$backup/$(dirname "$dest")"
    cp -p "$dest" "$backup/$dest"
    echo "    backup: ~/$dest"
  fi
  mkdir -p "$(dirname "$dest")"
  render "$rel" > "$dest"
  chmod "$(stat -c %a "$here/home/$rel")" "$dest"
  echo "    ~/$dest"
done < <(cd "$here/home" && find . -type f -print0 | sort -z)

# 4. Taskbar volume glyphs: link the white breeze-dark glyphs into the winlike
#    icon theme (see its index.theme).
echo "==> Icon theme: winlike (breeze, white volume glyphs on the taskbar)"
mkdir -p .local/share/icons/winlike/status
for level in muted low medium high; do
  ln -sfn "/usr/share/icons/breeze-dark/status/22/audio-volume-$level.svg" \
    ".local/share/icons/winlike/status/audio-volume-$level-panel.svg"
done

# The desktop shows ~/Desktop. uninstall.sh keeps it, because it can hold user files.
mkdir -p Desktop

fc-cache -f > /dev/null

echo
echo "Done. Start the desktop with: winlike"
