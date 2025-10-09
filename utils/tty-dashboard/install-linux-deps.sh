#!/bin/bash
set -e

echo "🔧 Installing Puppeteer/Chromium dependencies for Linux..."

# Detect the Linux distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "❌ Cannot detect Linux distribution"
    exit 1
fi

case $OS in
    ubuntu|debian)
        echo "📦 Installing dependencies for Ubuntu/Debian..."
        sudo apt-get update
        sudo apt-get install -y \
            ca-certificates \
            fonts-liberation \
            libappindicator3-1 \
            libasound2 \
            libatk-bridge2.0-0 \
            libatk1.0-0 \
            libc6 \
            libcairo2 \
            libcups2 \
            libdbus-1-3 \
            libexpat1 \
            libfontconfig1 \
            libgbm1 \
            libgcc1 \
            libglib2.0-0 \
            libgtk-3-0 \
            libnspr4 \
            libnss3 \
            libpango-1.0-0 \
            libpangocairo-1.0-0 \
            libstdc++6 \
            libx11-6 \
            libx11-xcb1 \
            libxcb1 \
            libxcomposite1 \
            libxcursor1 \
            libxdamage1 \
            libxext6 \
            libxfixes3 \
            libxi6 \
            libxrandr2 \
            libxrender1 \
            libxss1 \
            libxtst6 \
            lsb-release \
            wget \
            xdg-utils
        ;;
    
    fedora|rhel|centos)
        echo "📦 Installing dependencies for Fedora/RHEL/CentOS..."
        sudo dnf install -y \
            alsa-lib \
            atk \
            cups-libs \
            gtk3 \
            ipa-gothic-fonts \
            libXcomposite \
            libXcursor \
            libXdamage \
            libXext \
            libXi \
            libXrandr \
            libXScrnSaver \
            libXtst \
            pango \
            xorg-x11-fonts-100dpi \
            xorg-x11-fonts-75dpi \
            xorg-x11-fonts-cyrillic \
            xorg-x11-fonts-misc \
            xorg-x11-fonts-Type1 \
            xorg-x11-utils \
            mozilla-nss \
            nspr
        ;;
    
    arch)
        echo "📦 Installing dependencies for Arch Linux..."
        sudo pacman -Sy --noconfirm \
            alsa-lib \
            at-spi2-atk \
            cairo \
            cups \
            dbus \
            expat \
            glib2 \
            gtk3 \
            libcups \
            libdrm \
            libx11 \
            libxcb \
            libxcomposite \
            libxdamage \
            libxext \
            libxfixes \
            libxkbcommon \
            libxrandr \
            mesa \
            nspr \
            nss \
            pango
        ;;
    
    *)
        echo "❌ Unsupported distribution: $OS"
        echo "Please install the following packages manually:"
        echo "  - libnspr4"
        echo "  - libnss3"
        echo "  - libatk-bridge2.0-0"
        echo "  - libgtk-3-0"
        echo "  - libgbm1"
        echo "  - And other Chromium dependencies"
        exit 1
        ;;
esac

echo "✅ Dependencies installed successfully!"
echo ""
echo "You can now run the application with:"
echo "  yarn start"
