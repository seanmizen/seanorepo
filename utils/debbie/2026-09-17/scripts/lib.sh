# lib.sh: the functions that the three numbered steps and test-vm.sh share.
#
# Where: your computer. Each script loads this file when it starts. Do not run
#        it on its own.
# Why:   hardware and the VM must install a target machine the same way. So the
#        code they share lives here once:
#          - select_env, read_env    find and read a target machine's env file
#          - installer_params        build the installer boot line
#          - write_overrides         print overrides.cfg for one target machine
#          - log, warn, die          output, tagged with the calling script's name

TAG="$(basename "$0" .sh)"
log()  { echo "[$TAG] $*"; }
warn() { echo "[$TAG] WARNING: $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

#------------------------------------------------------------------------------
# Parse .env LITERALLY, never source it.
#
# `. .env` runs the file as shell, which expands anything in it, and a
# sha512-crypt hash is full of '$'. A correct .env that is sourced fails with
# "line 12: $6: unbound variable": the shell reads $6 as a positional
# parameter. Quotes work, but they are easy to forget in a file whose main
# value always contains '$'.
#
# Values are taken as written: no expansion, no command substitution. An
# unknown key is an error, not a setting that does nothing with no report.
#------------------------------------------------------------------------------
#------------------------------------------------------------------------------
# Pick this step's env file for one machine. The machine is a REQUIRED argument:
#   <step>.sh surface   ->  <step dir>/surface.env
#   <step>.sh .env      ->  <step dir>/.env
#   <step>.sh ./x.env   ->  that path (anything with a slash)
# No argument is an error that lists the machines this step has files for. So
# a forgotten argument cannot run with another machine's settings.
#------------------------------------------------------------------------------
select_env() {
    local dir="$1" machine="${2:-}" have
    have="$(cd "$dir" && ls -A 2> /dev/null | { grep -E '\.env$' || true; } | sed 's/\.env$//; s/^$/.env/' | tr '\n' ' ')"
    [ -n "$machine" ] || die "usage: $(basename "$0") <machine>   (env files here: ${have:-none - copy .env.example to <machine>.env})"
    case "$machine" in
        */*)  ENV_FILE="$machine" ;;
        .env) ENV_FILE="$dir/.env" ;;
        *)    ENV_FILE="$dir/$machine.env" ;;
    esac
    [ -f "$ENV_FILE" ] || die "no $ENV_FILE. Copy $dir/.env.example to it and fill it in. (env files here: ${have:-none})"
}

# Which step reads a key, for the error when it turns up in the wrong file.
key_home() {
    case "$1" in
        ISO)                         echo 1-build-iso ;;
        PASSWORD_CRYPTED)            echo 2-serve-preseed ;;
        SSH_KEY)                     echo "2-serve-preseed, 3-provision" ;;
        ROLE_WEBSERVER|ROLE_TUNNEL)  echo 3-provision ;;
        WIFI_*|PORT|SERVE_IP)        echo "1-build-iso, 2-serve-preseed" ;;
        SERVER_NAME)                 echo "2-serve-preseed, 3-provision" ;;
        DEPLOY_USER)                 echo "all three" ;;
        *)                           echo "no step" ;;
    esac
}

# read_env KEY... - parse $ENV_FILE, accepting ONLY the keys named. Every file
# is atomic: a key another step reads is an error saying which step it is for.
read_env() {
    local line key val lineno=0 k allowed=" "
    # Joined by hand: the callers set IFS=$'\n\t', so "$*" would join with
    # newlines and no key would ever match.
    for k in "$@"; do allowed="$allowed$k "; done
    [ -f "$ENV_FILE" ] || die "no $ENV_FILE."
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))
        line="${line%$'\r'}"                       # tolerate CRLF
        case "$line" in '' | '#'*) continue ;; esac
        case "$line" in *=*) : ;; *) die "$ENV_FILE line $lineno: not KEY=VALUE: $line" ;; esac

        key="${line%%=*}"; val="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"       # trim
        key="${key%"${key##*[![:space:]]}"}"
        key="${key#export }"

        # Strip one layer of surrounding quotes, so a .env written either way
        # behaves the same.
        case "$val" in
            \'*\') val="${val#\'}"; val="${val%\'}" ;;
            \"*\") val="${val#\"}"; val="${val%\"}" ;;
        esac

        if [ "$key" = DEBBIE_SERVES ]; then
            die "$ENV_FILE line $lineno: DEBBIE_SERVES is not supported. Set ROLE_WEBSERVER=yes in 3-provision instead, or delete the line: an unset role runs no sites."
        fi
        case "$allowed" in
            *" $key "*) printf -v "$key" '%s' "$val" ;;
            *) die "$ENV_FILE line $lineno: $(basename "$0") does not read $key (read by: $(key_home "$key")). Keys here:$allowed" ;;
        esac
    done < "$ENV_FILE"
}

#------------------------------------------------------------------------------
# Which address the target fetches from. Loopback is no good - the installer is
# on another machine.
#------------------------------------------------------------------------------
lan_ip() {
    local dev
    case "$(uname -s)" in
        Darwin)
            dev="$(route -n get default 2> /dev/null | awk '/interface:/{print $2}')"
            [ -n "$dev" ] && ipconfig getifaddr "$dev" 2> /dev/null && return 0
            ;;
        *)
            dev="$(ip route show default 2> /dev/null | awk '/default/{print $5; exit}')"
            [ -n "$dev" ] && ip -4 -o addr show "$dev" 2> /dev/null \
                | awk '{split($4,a,"/"); print a[1]; exit}' && return 0
            ;;
    esac
    return 1
}

#------------------------------------------------------------------------------
# The installer kernel parameters, in one place, used by both the served-URL
# route and the baked-into-the-ISO route.
#
# Every one of these is necessary, and three of them are easy to get wrong:
#
#   auto=true         delays locale, keyboard and hostname until the installer
#                     has the preseed. Without it, the installer asks them
#                     first.
#   priority=critical suppresses every non-critical prompt. So the wifi values
#                     below are MANDATORY, not a convenience: with the prompt
#                     suppressed, netcfg takes the empty default for the
#                     passphrase and fails with "either too long or too short",
#                     which looks like a bad password.
#   show_essids=manual a separate question from the ESSID, which offers a
#                     scanned list. Without it, the install stops even with the
#                     ESSID given.
#   security_type=wpa the values of the select are 'wep/open' and 'wpa'. WPA2
#                     PSK is 'wpa'. There is no 'wpa2'.
#   netcfg/hostname   REQ-SERVER-004. See below.
#
# The hostname is here, on the boot line, for the same reason as the wifi
# credentials: EVERY netcfg/* ANSWER MUST ARRIVE BEFORE NETCFG RUNS. netcfg
# runs before the installer fetches the preseed, because the preseed comes over
# the network. The Debian guide says so: "preseeding the network configuration
# won't work if you're loading your preconfiguration file from the network"
# (B.4.3).
#
# Without the key here, netcfg/hostname and netcfg/get_hostname in
# overrides.cfg arrive too late. netcfg then does a reverse-DNS lookup of the
# DHCP address (for example 192.168.1.182) and splits it at the first dot. The
# machine installs as hostname `192` in domain `168.1.182`.
#
# netcfg checks netcfg/hostname FIRST, and prefers it over the name from DHCP
# and over reverse DNS. Debian bug 606636 added that in netcfg 1.99, and it is
# the first branch of the HOSTNAME case in netcfg's dhcp.c. Given here, the key
# is in debconf before netcfg starts, so netcfg takes that branch.
#
# Two layers, not one: overrides.cfg's late_command also writes /etc/hostname
# and /etc/hosts in the target. That cannot lose a race with netcfg, whichever
# key wins. So a machine gets the correct name even if the reasoning above is
# wrong on some network.
#
# The caller puts these BEFORE the '---' separator. After it, the installer
# copies them into the bootloader config of the installed system, and the wifi
# passphrase stays in plaintext on the target's disk.
#------------------------------------------------------------------------------
installer_params() {
    local url="$1" params
    params="auto=true priority=critical url=$url"
    if [ -n "${WIFI_SSID:-}" ]; then
        # Hardware, on wifi. Without WIFI_IFACE the installer asks which one.
        [ -n "${WIFI_IFACE:-}" ] && params="$params netcfg/choose_interface=$WIFI_IFACE"
        params="$params netcfg/wireless_show_essids=manual"
        params="$params netcfg/wireless_essid=$WIFI_SSID"
        params="$params netcfg/wireless_security_type=wpa"
        params="$params netcfg/wireless_wpa=$WIFI_PASS"
    else
        # Wired, e.g. the VM: take the first interface with a link.
        params="$params netcfg/choose_interface=auto"
    fi
    # These name the INSTALLER, not the installed machine. write_overrides'
    # late_command, which step 2 serves, names the machine, and
    # setup-server-environment.sh repairs the name (REQ-SERVER-004). So step 1
    # needs no machine name, and one USB serves every machine.
    #
    # SET, never empty. With netcfg/hostname unset, netcfg does a reverse-DNS
    # lookup and can name a machine `192`. The placeholder stops it from asking
    # or guessing.
    params="$params netcfg/hostname=${SERVER_NAME:-debbie-installer}"
    params="$params netcfg/get_hostname=${SERVER_NAME:-debbie-installer}"
    printf '%s' "$params"
}

#------------------------------------------------------------------------------
# write_overrides: prints overrides.cfg, the settings that belong to one target
# machine, for the installer to read after preseed.cfg.
#
# serve-preseed.sh (hardware) and test-vm.sh (VM) call it before each install
# and serve its output next to preseed.cfg. preseed.cfg holds only settings
# that every target machine shares. Both paths use this one function, so a
# hardware install and a VM install cannot differ.
#
# Reads from the environment:
#   DEPLOY_USER, SERVER_NAME   required
#   SSH_PUBKEY_FILE            required: the public key to authorise
#   PASSWORD_CRYPTED           required: sha512-crypt hash (openssl passwd -6)
#   CONSOLE                    optional: serial console, e.g. ttyAMA0. Only the
#                              VM sets it. On hardware there is no serial port,
#                              and the screen would stay black.
#------------------------------------------------------------------------------
write_overrides() {
    local name pubkey
    for name in DEPLOY_USER SERVER_NAME SSH_PUBKEY_FILE PASSWORD_CRYPTED; do
        [ -n "${!name:-}" ] || die "write_overrides: $name is required"
    done
    [ -f "$SSH_PUBKEY_FILE" ] || die "write_overrides: no such public key: $SSH_PUBKEY_FILE"
    pubkey="$(cat "$SSH_PUBKEY_FILE")"


cat <<EOF
# GENERATED by write_overrides in scripts/lib.sh. Layered over preseed.cfg via
# preseed/include - later values win. Do not edit; edit the generator.
d-i passwd/username string $DEPLOY_USER

# These two are BELIEVED TO HAVE NO EFFECT, and nothing may depend on them -
# REQ-SERVER-004. The installer fetches this file over the network, so netcfg
# runs and picks a hostname before it reads the file. See the long note in
# preseed.cfg. They stay because they cost nothing, and they are correct if a
# local file drives this preseed.
#
# What binds is netcfg/hostname= on the KERNEL COMMAND LINE (the caller's job -
# installer_params in scripts/lib.sh), and the late_command below.
d-i netcfg/get_hostname string $SERVER_NAME
d-i netcfg/hostname string $SERVER_NAME

# The password hash comes from the env file and is never committed. The
# repository is public, so a committed password or hash would be public too.
# preseed.cfg holds no hash at all.
d-i passwd/user-password-crypted password $PASSWORD_CRYPTED
EOF

if [ -n "${CONSOLE:-}" ]; then
    echo "d-i debian-installer/add-kernel-opts string console=$CONSOLE,115200n8"
fi

cat <<EOF

# Only ONE late_command may exist across all included files. The last one
# wins, with no warning, so it is defined here and nowhere else. EXTEND it.
# Never add a second one.
#
# The first three commands set the hostname on the installed filesystem -
# REQ-SERVER-004. This layer is certain, unlike the netcfg/* keys above (read
# too late) and the boot-line key (correct, but provable only on hardware). It
# works because of where late_command sits in the finish-install sequence:
#
#   netcfg runs -> /etc/hostname and /etc/hosts are written from whatever it
#   decided -> base-installer copies them into /target -> pkgsel ->
#   finish-install.d/07 (THIS) -> finish-install.d/55netcfg-copy-config.
#
# So the target's identity files exist when this runs. The only netcfg script
# that runs after it is 55netcfg-copy-config, which writes interface
# configuration into netplan, NetworkManager or ifupdown, and does not touch
# /etc/hostname or /etc/hosts. Nothing overwrites what this sets.
#
# The 127.0.1.1 line is REPLACED, not appended to. netcfg writes its own, and
# with a reverse-DNS name that line reads '127.0.1.1 192.168.1.182 192'. The
# grep pattern leaves the dots unescaped on purpose: backslashes inside a
# debconf value with line continuations are an unnecessary risk, and an
# anchored '^127.0.1.1' cannot match anything else in /etc/hosts.
#
# A space separates the fields rather than a tab, for the same reason: no
# backslash escape has to survive debconf. /etc/hosts is whitespace-delimited,
# and setup-server-environment.sh's repair matches either.
d-i preseed/late_command string \\
    echo '$SERVER_NAME' > /target/etc/hostname; \\
    grep -v '^127.0.1.1' /target/etc/hosts > /target/etc/hosts.new; \\
    echo '127.0.1.1 $SERVER_NAME' >> /target/etc/hosts.new; \\
    mv /target/etc/hosts.new /target/etc/hosts; \\
    in-target mkdir -p /home/$DEPLOY_USER/.ssh; \\
    echo '$pubkey' > /target/home/$DEPLOY_USER/.ssh/authorized_keys; \\
    in-target chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh; \\
    in-target chmod 700 /home/$DEPLOY_USER/.ssh; \\
    in-target chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys; \\
    echo '$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL' > /target/etc/sudoers.d/90-$DEPLOY_USER; \\
    chmod 440 /target/etc/sudoers.d/90-$DEPLOY_USER
EOF
}
