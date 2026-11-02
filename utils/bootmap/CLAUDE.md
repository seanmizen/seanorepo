# bootmap

The boot as a live treemap. Read `README.md` for the design and the status.

- Build and test: `zig build test` and `test/layout-parity.sh`. Run both after
  each change to `src/layout/`, `src/model/plan.zig` or `kernel/bootmap_layout.*`.
- `src/layout/treemap.zig` and `kernel/bootmap_layout.c` are one algorithm in
  two languages (REQ-BOOTMAP-001). Change both, in the same commit. Use
  integers only. Never use a float in the layout.
- The pads and the sort rule in `src/model/plan.zig` have copies in
  `kernel/bootmap_layout.c`. Keep them equal.
- `working/` holds large files (VM disks, a kernel tree). Never commit it.
- swindowzig comes from its GitHub release (`build.zig.zon`), not from
  `utils/swindowzig`.
- Do not install dracut on the host. It replaces `initramfs-tools` in WSL.
