#!/usr/bin/env bash
# Remove everything that install.sh wrote, and put back the files from before
# the first install (from ~/.local/share/winlike/backup/).
# The Debian packages stay. The last lines of output give the apt command to remove them.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
cd "$HOME"
[ -d .config ] || { echo "uninstall.sh: $HOME/.config does not exist" >&2; exit 1; }

echo "==> Config files"
backup=.local/share/winlike/backup
while IFS= read -r -d '' rel; do
  rel=${rel#./}
  dest=${rel%.in}
  if [ -e "$backup/$dest" ]; then
    cp -p "$backup/$dest" "$dest"
    echo "    restored: ~/$dest"
  elif [ -e "$dest" ]; then
    rm -f -- "$dest"
    echo "    removed:  ~/$dest"
  fi
done < <(cd "$here/home" && find . -type f -print0 | sort -z)

echo "==> Themes, icons, cursors, fonts, wallpaper"
# Literal paths, relative to $HOME (the cd above).
for d in \
  .local/share/themes/Windows-10 \
  .local/share/themes/Win10 \
  .local/share/lxqt/themes/Win10 \
  .local/share/icons/We10X \
  .local/share/icons/We10X-dark \
  .local/share/icons/We10XOS-cursors \
  .local/share/fonts/windows \
  .local/share/winlike \
  .config/pcmanfm-qt/winlike; do
  if [ -e "$d" ]; then
    rm -rf -- "$d"
    echo "    removed:  ~/$d"
  fi
done

fc-cache -f > /dev/null

echo
echo "Done. To remove the packages too:"
echo "  sudo apt-get remove labwc layer-shell-qt lxqt-panel lxqt-qtplugin lxqt-notificationd lxqt-config lxqt-runner pcmanfm-qt qterminal featherpad qps grim slurp wl-clipboard"
