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
# `. .env` runs the file as shell, which expands anything in it - and a
# sha512-crypt hash is full of '$'. Sourcing a correct .env failed on first use
# with "line 12: $6: unbound variable", the shell reading $6 as a positional
# parameter. Quoting works but is a foot-gun in a file whose main value always
# contains '$'.
#
# Values are taken verbatim: no expansion, no command substitution, and an
# unrecognised key is an error rather than a setting that silently does nothing.
#------------------------------------------------------------------------------
#------------------------------------------------------------------------------
# Pick this step's env file for one machine - #332. The machine is a REQUIRED argument:
#   <step>.sh trixie2   ->  <step dir>/trixie2.env
#   <step>.sh .env      ->  <step dir>/.env
#   <step>.sh ./x.env   ->  that path (anything with a slash)
# No argument is an error listing the machines this step has files for, so a
# forgotten argument can never run against some other machine's settings.
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
        SERVER_NAME|DEPLOY_USER)     echo "all three" ;;
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
            die "$ENV_FILE line $lineno: DEBBIE_SERVES was replaced by ROLE_WEBSERVER in 3-provision (#329). Delete the line: unset means the machine runs no sites."
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
# Every one of these is load-bearing, and three of them have already cost an
# evening:
#
#   auto=true         postpones locale/keyboard/hostname until the preseed has
#                     been fetched. Without it the installer asks them first.
#   priority=critical suppresses every non-critical prompt. This is why the
#                     wifi values below are MANDATORY rather than a
#                     convenience: with the prompt suppressed, netcfg takes the
#                     empty default for the passphrase and fails with "either
#                     too long or too short", which reads like a bad password.
#   show_essids=manual a separate question from the ESSID, offering a scanned
#                     list. Unset, the install stops even with the ESSID given.
#   security_type=wpa the select's values are 'wep/open' and 'wpa'. WPA2 PSK is
#                     'wpa'; there is no 'wpa2'.
#   netcfg/hostname   REQ-SERVER-004, #285. See below - this one cost a whole
#                     install, not an evening.
#
# The hostname is here, on the boot line, for the same structural reason the
# wifi credentials are: EVERY netcfg/* ANSWER MUST ARRIVE BEFORE NETCFG RUNS,
# and netcfg runs before the preseed is fetched, because the preseed is fetched
# over the network. The Debian guide says it outright - "preseeding the network
# configuration won't work if you're loading your preconfiguration file from
# the network" (B.4.3).
#
# The first real install proved it. overrides.cfg set both netcfg/hostname and
# netcfg/get_hostname to the intended name; netcfg had already run, fallen
# through to a reverse-DNS lookup of the DHCP address 192.168.1.182, and split
# it at the first dot, so the machine installed itself as hostname `192` in domain
# `168.1.182`. Both keys were correct and both were read too late.
#
# netcfg checks netcfg/hostname FIRST and prefers it over the DHCP-supplied
# name and over reverse DNS - that is what Debian #606636 added in netcfg 1.99,
# and it is the first branch of the HOSTNAME case in netcfg's dhcp.c. Given
# here, it is in debconf before netcfg starts, so that branch is taken.
#
# Belt and braces, not belt alone: overrides.cfg's late_command also writes
# /etc/hostname and /etc/hosts in the target. That cannot lose a race with
# netcfg no matter which key wins, so a machine is correctly named even if the
# reasoning above turns out to be wrong on some particular network.
#
# The caller places these BEFORE the '---' separator. After it, they would be
# copied into the installed system's bootloader config, persisting the wifi
# passphrase in plaintext on the target's disk.
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
    params="$params netcfg/hostname=$SERVER_NAME"
    params="$params netcfg/get_hostname=$SERVER_NAME"
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

# These two are BELIEVED NOT TO TAKE EFFECT and nothing may depend on them -
# REQ-SERVER-004, #285. This file is fetched over the network, so netcfg has
# already run and already picked a hostname before it is read; see the long
# note in preseed.cfg. They are kept because they cost nothing and are correct
# if this preseed is ever driven from a local file instead.
#
# What binds is netcfg/hostname= on the KERNEL COMMAND LINE (the caller's job -
# installer_params in scripts/lib.sh), and the late_command below.
d-i netcfg/get_hostname string $SERVER_NAME
d-i netcfg/hostname string $SERVER_NAME

# The password hash is injected rather than committed. The previous generation
# shipped 'password changeme' in the clear in a public repository for nine
# months; this generation's preseed.cfg holds no hash at all.
d-i passwd/user-password-crypted password $PASSWORD_CRYPTED
EOF

if [ -n "${CONSOLE:-}" ]; then
    echo "d-i debian-installer/add-kernel-opts string console=$CONSOLE,115200n8"
fi

cat <<EOF

# Only ONE late_command may exist across all included files - last wins,
# silently - so it is defined here and nowhere else. EXTEND it; never add a
# second one anywhere.
#
# The first three commands impose the hostname on the installed filesystem -
# REQ-SERVER-004, #285. This is the layer that is guaranteed, as opposed to the
# netcfg/* keys above (read too late) and the boot-line key (right, but only
# provable on hardware). It works because of where late_command sits in the
# finish-install sequence:
#
#   netcfg runs -> /etc/hostname and /etc/hosts are written from whatever it
#   decided -> base-installer copies them into /target -> pkgsel ->
#   finish-install.d/07 (THIS) -> finish-install.d/55netcfg-copy-config.
#
# So the target's identity files already exist when this runs, and the only
# netcfg script that runs afterwards is 55netcfg-copy-config, which writes
# interface configuration into netplan/NetworkManager/ifupdown and does not
# touch /etc/hostname or /etc/hosts. Nothing overwrites what is set here.
#
# The 127.0.1.1 line is REPLACED, not appended to: netcfg writes its own, and
# on the failing install that line read '127.0.1.1 192.168.1.182 192'. The grep
# pattern leaves the dots unescaped on purpose - backslashes inside a debconf
# value that is already using line continuations are a needless risk, and an
# anchored '^127.0.1.1' cannot plausibly match anything else in /etc/hosts.
#
# A space separates the fields rather than a tab, for the same reason: no
# backslash escape has to survive debconf. /etc/hosts is whitespace-delimited,
# and postinstall.sh's repair matches either.
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
