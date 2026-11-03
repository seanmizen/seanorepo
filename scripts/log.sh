# log.sh: log levels for the shell scripts of the repo (REQ-SERVER-019).
#
# Where: each script that sources it. The deploy path uses it: deploy.sh,
#        release-poll.sh, scripts/prod-docker-all.sh and the prod:docker
#        script of each app. Do not run it on its own.
# When:  at each line that a script writes.
# Why:   journald reads a priority prefix at the start of each line: <3>
#        error, <4> warning, <6> info, <7> debug. `journalctl -p info` then
#        shows the messages of our scripts, and `-p debug` also shows the tool
#        output. The rule is in .claude/rules/logging.md.
#
# The functions:
#   log_err, log_warn, log_info, log_debug   one line at that level
#   run_quiet <cmd...>                       the output of <cmd> at debug.
#                                            On a failure, the last 30 lines
#                                            again at error.
#
# The tag of each line is LOG_TAG. Set it before you source this file. The
# default is the name of the script, without `.sh`.
#
# The first script that sources this file makes the decision about the prefix
# and exports it in LOG_PREFIX. A script that it starts gets the same decision,
# also when its own stdout is a pipe. Under systemd, stdout is not a terminal,
# so the lines get the prefix. On a terminal, the lines get no prefix.

LOG_TAG="${LOG_TAG:-$(basename "$0" .sh)}"
if [ -z "${LOG_PREFIX:-}" ]; then
    if [ -t 1 ]; then LOG_PREFIX=no; else LOG_PREFIX=yes; fi
fi
export LOG_PREFIX

# _log <priority> <message...>
_log() {
    local IFS=' ' p="$1"
    shift
    if [ "$LOG_PREFIX" = yes ]; then
        printf '<%s>[%s] %s\n' "$p" "$LOG_TAG" "$*"
    else
        printf '[%s] %s\n' "$LOG_TAG" "$*"
    fi
}

log_err()   { _log 3 "ERROR: $*" >&2; }
log_warn()  { _log 4 "WARNING: $*"; }
log_info()  { _log 6 "$*"; }
log_debug() { _log 7 "$*"; }

# run_quiet <cmd...>: runs <cmd> and returns its exit status.
#
# Each line of its output (stdout and stderr) goes to stdout at debug. A line
# that has a prefix already keeps it: a script that <cmd> starts can write its
# own info and error lines. On a non-zero exit, the function writes an error
# line, then the last 30 lines of the output without a prefix again at error.
# So nobody must change the level to find out why a command failed. On a
# terminal, the output is already on the screen, so only the error line is
# written.
run_quiet() {
    local IFS=' ' rc=0 tail_file line
    tail_file="$(mktemp "${TMPDIR:-/tmp}/run_quiet.XXXXXX")" || return 1
    "$@" 2>&1 | awk -v prefix="$LOG_PREFIX" -v out="$tail_file" '
        /^<[0-7]>/ { print; fflush(); next }
        {
            if (prefix == "yes") print "<7>" $0; else print
            fflush()
            ring[n++ % 30] = $0
        }
        END { for (i = (n > 30 ? n - 30 : 0); i < n; i++) print ring[i % 30] > out }
    ' || rc=${PIPESTATUS[0]}
    if [ "$rc" -ne 0 ]; then
        if [ "$LOG_PREFIX" = yes ] && [ -s "$tail_file" ]; then
            log_err "'$*' failed with exit status $rc. The last lines of its output:"
            while IFS= read -r line; do _log 3 "  | $line" >&2; done < "$tail_file"
        else
            log_err "'$*' failed with exit status $rc"
        fi
    fi
    rm -f "$tail_file"
    return "$rc"
}
