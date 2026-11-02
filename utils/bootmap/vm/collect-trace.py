#!/usr/bin/env python3
"""Collect one boot of this machine as a bootmap trace (JSON on stdout).

Runs on the guest, as root, after `systemctl is-system-running --wait`.
The guest must boot with `initcall_debug`, so the kernel log has one line
for the start and one line for the end of each initcall.

All times are microseconds of CLOCK_MONOTONIC. The kernel log timestamps use
the same clock base (local_clock), close enough for a picture.

Trace format (version 1):
  {"version": 1, "source": str, "end_us": int,
   "boxes": [{"path": [stage, group, name], "start_us": int, "end_us": int,
              "failed": bool}]}
"""

import json
import re
import subprocess
import sys

STAGE_KERNEL = "kernel"
STAGE_INITRD = "initrd"
STAGE_SYSTEMD = "systemd"

# The order in which the targets of a normal boot are reached. A unit goes
# into the group of the first of these targets that it is ordered before.
TARGET_ORDER = [
    "local-fs-pre.target",
    "local-fs.target",
    "sysinit.target",
    "sockets.target",
    "timers.target",
    "paths.target",
    "basic.target",
    "network-pre.target",
    "network.target",
    "network-online.target",
    "cloud-config.target",
    "multi-user.target",
    "graphical.target",
]
DEFAULT_GROUP = "multi-user.target"

# Unit types that are boxes. Devices, slices and scopes are not work that
# the boot waits for in a way a person can see, so they are not boxes.
UNIT_SUFFIXES = (".service", ".socket", ".mount", ".swap", ".timer", ".path", ".automount")

CALLING = re.compile(r"^\[\s*(\d+)\.(\d+)\] calling\s+(\S+?)\+0x[0-9a-f]+/0x[0-9a-f]+ @ (\d+)")
RETURNED = re.compile(
    r"^\[\s*(\d+)\.(\d+)\] initcall (\S+?)\+0x[0-9a-f]+/0x[0-9a-f]+ returned (-?\d+) after (\d+) usecs"
)
# Kernel symbol names of initcall pointers end in the level digit, for example
# __initcall__kmod_pci__123_456_pci_subsys_init4. "s" is the _sync variant.
# early_initcall and rootfs_initcall use a word, not a digit.
INITCALL_SYM = re.compile(r"^__initcall__kmod_.+?__\d+_\d+_(\w+?)(\d|early|rootfs)s?$")
LEVEL_NAMES = {"0": "pure", "1": "core", "2": "postcore", "3": "arch", "4": "subsys",
               "5": "fs", "6": "device", "7": "late", "early": "early", "rootfs": "rootfs"}


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def initcall_levels():
    """Map an initcall function name to its level name, from /proc/kallsyms."""
    levels = {}
    try:
        with open("/proc/kallsyms") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                m = INITCALL_SYM.match(parts[2])
                if m:
                    levels.setdefault(m.group(1), LEVEL_NAMES[m.group(2)])
    except OSError:
        pass
    return levels


def kernel_boxes():
    log = run("dmesg", "--kernel")
    levels = initcall_levels()
    started = {}
    boxes = []
    first_call = None
    for line in log.splitlines():
        m = CALLING.match(line)
        if m:
            t = int(m.group(1)) * 1_000_000 + int(m.group(2))
            started[m.group(3)] = t
            if first_call is None:
                first_call = t
            continue
        m = RETURNED.match(line)
        if m:
            name = m.group(3)
            end = int(m.group(1)) * 1_000_000 + int(m.group(2))
            start = started.pop(name, end - int(m.group(5)))
            group = levels.get(name, "unknown")
            boxes.append(
                {
                    "path": [STAGE_KERNEL, group, name],
                    "start_us": start,
                    "end_us": end,
                    # A non-zero return is almost always "no such hardware
                    # here" (-ENODEV and similar), not a failure. The kernel
                    # does not report it either. So an initcall never fails.
                    "failed": False,
                    "ret": int(m.group(4)),
                }
            )
    if first_call is None:
        sys.exit("collect-trace: no initcall lines in the kernel log. Boot with initcall_debug.")
    # The time before the first initcall: setup_arch, memory, the scheduler.
    boxes.insert(
        0,
        {"path": [STAGE_KERNEL, "start_kernel", "start_kernel"], "start_us": 0, "end_us": first_call, "failed": False},
    )
    return boxes


def manager_times():
    props = [
        "InitRDTimestampMonotonic",
        "UserspaceTimestampMonotonic",
        "FinishTimestampMonotonic",
    ]
    out = run("systemctl", "show", "-p", ",".join(props))
    vals = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    return {k: int(vals.get(k) or 0) for k in props}


def unit_boxes(userspace_us, finish_us):
    names = [
        line.split()[0]
        for line in run("systemctl", "list-units", "--all", "--plain", "--no-legend").splitlines()
        if line.split() and line.split()[0].endswith(UNIT_SUFFIXES)
    ]
    out = run(
        "systemctl",
        "show",
        "-p",
        "Id,ActiveState,Result,Before,InactiveExitTimestampMonotonic,ActiveEnterTimestampMonotonic",
        "--",
        *names,
    )
    boxes = []
    for block in out.strip().split("\n\n"):
        vals = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        start = int(vals.get("InactiveExitTimestampMonotonic") or 0)
        end = int(vals.get("ActiveEnterTimestampMonotonic") or 0)
        failed = vals.get("ActiveState") == "failed" or vals.get("Result", "success") != "success"
        # Only units that started in this boot, before the boot finished.
        if start == 0 or start < userspace_us or start > finish_us:
            continue
        if end == 0 or end < start:
            end = finish_us if failed else start
        before = set(vals.get("Before", "").split())
        group = next((t for t in TARGET_ORDER if t in before), DEFAULT_GROUP)
        boxes.append({"path": [STAGE_SYSTEMD, group, vals["Id"]], "start_us": start, "end_us": end, "failed": failed})
    return boxes


def main():
    times = manager_times()
    kernel = kernel_boxes()
    kernel_end = max(b["end_us"] for b in kernel)
    userspace = times["UserspaceTimestampMonotonic"]
    initrd_start = times["InitRDTimestampMonotonic"] or kernel_end
    boxes = list(kernel)
    if userspace > initrd_start:
        boxes.append({"path": [STAGE_INITRD, "initramfs", "initramfs"], "start_us": initrd_start, "end_us": userspace, "failed": False})
    units = unit_boxes(userspace, times["FinishTimestampMonotonic"])
    # systemd's own start: from exec to the first unit (generators, unit load).
    first_unit = min((b["start_us"] for b in units), default=userspace)
    if first_unit > userspace:
        boxes.append({"path": [STAGE_SYSTEMD, "manager", "systemd"], "start_us": userspace, "end_us": first_unit, "failed": False})
    boxes += units
    boxes.sort(key=lambda b: (b["start_us"], b["end_us"], b["path"]))
    source = run("uname", "-sr").strip() + ", " + open("/etc/debian_version").read().strip()
    json.dump(
        {"version": 1, "source": source, "end_us": max(b["end_us"] for b in boxes), "boxes": boxes},
        sys.stdout,
        indent=1,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
