# Shared by hw/*.sh. Sourced, not run.
HW_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HW_ROOT="$(dirname "$HW_HERE")"
HOST="${1:?usage: $(basename "$0") <host> [machine]}"
MACHINE="${2:-surface}"
SSH_USER="${BOOTMAP_SSH_USER:-srv}"
SSH_KEY="${BOOTMAP_SSH_KEY:-$HOME/.ssh/seanorepo-admin}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "$SSH_USER@$HOST")
SCP=(scp -q -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10)
die() { echo "$(basename "$0"): $*" >&2; exit 1; }
