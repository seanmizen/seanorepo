#!/usr/bin/env python3
"""Capture the QEMU screen to PNG files while a VM runs.

    capture.py <qmp.sock> <out_dir> [interval_s]

Connects to the QMP socket, then sends `screendump` every interval_s seconds
(default 0.2) until QEMU exits. Frames are out_dir/frame-00000.png and on.
A frame that is the same as the frame before it is deleted, so out_dir holds
only the frames where the screen changed.
"""

import json
import os
import socket
import sys
import time


def main():
    sock_path, out_dir = sys.argv[1], sys.argv[2]
    interval = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
    os.makedirs(out_dir, exist_ok=True)

    deadline = time.time() + 30
    while True:
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.connect(sock_path)
            break
        except OSError:
            if time.time() > deadline:
                sys.exit(f"capture: no QMP socket at {sock_path}")
            time.sleep(0.05)
    f = s.makefile("rw")

    def call(cmd, **args):
        f.write(json.dumps({"execute": cmd, "arguments": args}) + "\n")
        f.flush()
        while True:
            line = f.readline()
            if not line:
                raise EOFError
            msg = json.loads(line)
            if "return" in msg or "error" in msg:
                return msg

    f.readline()  # greeting
    call("qmp_capabilities")
    n = 0
    last = None
    start = time.time()
    try:
        while True:
            path = os.path.join(out_dir, f"frame-{n:05d}.png")
            r = call("screendump", filename=path, format="png")
            if "error" in r:
                time.sleep(interval)
                continue
            try:
                data = open(path, "rb").read()
            except OSError:
                data = None
            if data is not None and data == last:
                os.remove(path)
            else:
                last = data
                with open(os.path.join(out_dir, "times.txt"), "a") as t:
                    t.write(f"frame-{n:05d}.png {time.time() - start:.2f}\n")
                n += 1
            time.sleep(interval)
    except (EOFError, OSError, ValueError):
        pass
    print(f"capture: {n} frames in {out_dir}")


if __name__ == "__main__":
    main()
