#!/usr/bin/env bash
# Install the winlike desktop: labwc + lxqt-panel + pcmanfm-qt with a Windows 10
# look and feel. Safe to run again. Every run gives the same result.
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
  fontconfig curl ca-certificates
)
missing=()
for p in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "==> apt: ${missing[*]}"
  sudo apt-get install -y --no-install-recommends "${missing[@]}"
fi

# 2. Themes from GitHub, pinned to a commit
fetch() { # repo sha -> prints the unpacked directory
  local dir
  dir=$(mktemp -d)
  curl -fsSL "https://codeload.github.com/$1/tar.gz/$2" | tar -xz -C "$dir"
  echo "$dir/${1#*/}-$2"
}

echo "==> GTK theme: B00merang-Project/Windows-10"
src=$(fetch B00merang-Project/Windows-10 3a4116603b66a9adcb78f3987d7ea6f01de1cbce)
mkdir -p .local/share/themes
rm -rf -- .local/share/themes/Windows-10
cp -r "$src" .local/share/themes/Windows-10

echo "==> Icon theme: yeyushengfan258/We10X-icon-theme"
src=$(fetch yeyushengfan258/We10X-icon-theme 0f52ff2dce554146f8f76ab2c7a5968fd773400d)
mkdir -p .local/share/icons
bash "$src/install.sh" -d "$HOME/.local/share/icons" > /dev/null

echo "==> Cursor theme: yeyushengfan258/We10XOS-cursors"
src=$(fetch yeyushengfan258/We10XOS-cursors b971891cc016ba780af791ac9872a15406695ad8)
rm -rf -- .local/share/icons/We10XOS-cursors
cp -r "$src/dist" .local/share/icons/We10XOS-cursors

# 3. Fonts and wallpaper from the Windows install (licensed with it: keep them local)
win=/mnt/c/Windows
if [ -d "$win/Fonts" ]; then
  echo "==> Fonts: Segoe UI, Consolas"
  mkdir -p .local/share/fonts/windows
  install -m 644 "$win"/Fonts/segoeui*.ttf "$win"/Fonts/seguisb.ttf "$win"/Fonts/consola*.ttf .local/share/fonts/windows/
  echo "==> Wallpaper: Windows 10 hero"
  mkdir -p .local/share/winlike
  for f in "$win/Web/4K/Wallpaper/Windows/img0_3840x2160.jpg" "$win/Web/Wallpaper/Windows/img0.jpg"; do
    if [ -f "$f" ]; then install -m 644 "$f" .local/share/winlike/wallpaper.jpg; break; fi
  done
else
  echo "==> $win not found: skipped Windows fonts and wallpaper" >&2
fi

# 4. Config files
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

# The desktop shows ~/Desktop. uninstall.sh keeps it, because it can hold user files.
mkdir -p Desktop

fc-cache -f > /dev/null

echo
echo "Done. Start the desktop with: winlike"
