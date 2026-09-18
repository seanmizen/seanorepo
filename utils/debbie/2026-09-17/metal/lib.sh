# lib.sh - shared by serve-preseed.sh and build-iso.sh. Sourced, not executed.
#
# Both need the same .env and the same answer to "what address will the target
# fetch from", and two copies of either would drift.

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[metal] $*"; }

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
read_env() {
    local line key val lineno=0
    [ -f "$ENV_FILE" ] || die "no $ENV_FILE. Copy .env.example to .env and fill it in."
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

        case "$key" in
            DEPLOY_USER)      DEPLOY_USER="$val" ;;
            SERVER_NAME)      SERVER_NAME="$val" ;;
            PASSWORD_CRYPTED) PASSWORD_CRYPTED="$val" ;;
            WIFI_SSID)        WIFI_SSID="$val" ;;
            WIFI_PASS)        WIFI_PASS="$val" ;;
            WIFI_IFACE)       WIFI_IFACE="$val" ;;
            SSH_KEY)          SSH_KEY="$val" ;;
            ISO)              ISO="$val" ;;
            PORT)             PORT="$val" ;;
            SERVE_IP)         SERVE_IP="$val" ;;
            *) die "$ENV_FILE line $lineno: unknown key '$key'. See .env.example." ;;
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
# it at the first dot, so the box installed itself as hostname `192` in domain
# `168.1.182`. Both keys were correct and both were read too late.
#
# netcfg checks netcfg/hostname FIRST and prefers it over the DHCP-supplied
# name and over reverse DNS - that is what Debian #606636 added in netcfg 1.99,
# and it is the first branch of the HOSTNAME case in netcfg's dhcp.c. Given
# here, it is in debconf before netcfg starts, so that branch is taken.
#
# Belt and braces, not belt alone: overrides.cfg's late_command also writes
# /etc/hostname and /etc/hosts in the target. That cannot lose a race with
# netcfg no matter which key wins, so a box is correctly named even if the
# reasoning above turns out to be wrong on some particular network.
#
# The caller places these BEFORE the '---' separator. After it, they would be
# copied into the installed system's bootloader config, persisting the wifi
# passphrase in plaintext on the target's disk.
#------------------------------------------------------------------------------
installer_params() {
    local url="$1" params
    params="auto=true priority=critical url=$url"
    [ -n "${WIFI_IFACE:-}" ] && params="$params netcfg/choose_interface=$WIFI_IFACE"
    params="$params netcfg/wireless_show_essids=manual"
    params="$params netcfg/wireless_essid=$WIFI_SSID"
    params="$params netcfg/wireless_security_type=wpa"
    params="$params netcfg/wireless_wpa=$WIFI_PASS"
    # Must stay in step with vm/test-vm.sh's own append line.
    params="$params netcfg/hostname=$SERVER_NAME"
    params="$params netcfg/get_hostname=$SERVER_NAME"
    printf '%s' "$params"
}
