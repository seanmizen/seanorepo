// SPDX-License-Identifier: GPL-2.0
/*
 * bootmap: draw the kernel's initcalls as a live treemap on the firmware
 * framebuffer.
 *
 * At early_initcall time this code:
 *   1. reads every initcall from the linker sections, so it knows each box
 *      before the boxes run (the same idea as the systemd job list),
 *   2. lays out the tree with bootmap_layout.c (REQ-BOOTMAP-001),
 *   3. maps the UEFI GOP framebuffer from screen_info, and
 *   4. attaches to the initcall_start and initcall_finish tracepoints.
 * Each tracepoint event then draws one box. No display driver is necessary:
 * the GOP framebuffer is linear memory, as for earlyprintk=efi.
 *
 * /proc/bootmap gives the rectangle and the state of each box. The
 * userspace daemon reads it and continues the same picture.
 *
 * Command line:
 *   bootmap=off                  do not draw
 *   bootmap.stages=F,L,K,I,S     the weights of the five stages (firmware,
 *                                loader, kernel, initrd, systemd). A stage
 *                                with weight 0 is not in the picture.
 *
 * The drawing rules are the rules of src/render/canvas.zig. The colours are
 * the colours of src/render/palette.zig.
 */
#include <linux/init.h>
#include <linux/kernel.h>
#include <linux/io.h>
#include <linux/slab.h>
#include <linux/string.h>
#include <linux/sched/clock.h>
#include <linux/screen_info.h>
#include <linux/proc_fs.h>
#include <linux/seq_file.h>
#include <trace/events/initcall.h>

#include "bootmap_layout.h"

#define BOOTMAP_NAME_LEN 48
#define BOOTMAP_STAGES 5
#define BOOTMAP_STAGE_KERNEL 2

enum bootmap_state { BM_PENDING, BM_ACTIVE, BM_DONE, BM_FAILED };

static const char *const bootmap_stage_names[BOOTMAP_STAGES] = {
	"firmware", "loader", "kernel", "initrd", "systemd",
};

/* src/render/palette.zig */
static const u32 bootmap_stage_colors[BOOTMAP_STAGES] = {
	0x3987e5, 0xd95926, 0x199e70, 0xc98500, 0xd55181,
};
#define BOOTMAP_SURFACE 0x000000
#define BOOTMAP_GAP 2

/* The initcall levels, in run order. The linker script names them. */
extern initcall_entry_t __initcall_start[];
extern initcall_entry_t __initcall0_start[];
extern initcall_entry_t __initcall1_start[];
extern initcall_entry_t __initcall2_start[];
extern initcall_entry_t __initcall3_start[];
extern initcall_entry_t __initcall4_start[];
extern initcall_entry_t __initcall5_start[];
extern initcall_entry_t __initcallrootfs_start[];
extern initcall_entry_t __initcall6_start[];
extern initcall_entry_t __initcall7_start[];
extern initcall_entry_t __initcall_end[];

struct bootmap_level {
	const char *name;
	initcall_entry_t *start, *end;
};

struct bootmap_node {
	char name[BOOTMAP_NAME_LEN];
	unsigned char depth;
	unsigned char stage;
	unsigned char state;
	initcall_t fn;		/* leaves of the kernel stage only */
	u64 start_ns, end_ns;
};

static struct {
	bool off;
	u64 stage_weights[BOOTMAP_STAGES];
	u32 *fb;
	u32 width, height, stride;
	u32 n;
	struct bootmap_node *nodes;
	unsigned char *depth;
	u64 *weight;
	struct bootmap_rect *rects;
	u32 first_leaf, end_leaf; /* the kernel leaves: [first_leaf, end_leaf) */
	u32 cursor;
	bool live;
} bm = {
	.stage_weights = { 0, 0, 30, 10, 60 },
};

static int __init bootmap_setup_off(char *s)
{
	bm.off = !strcmp(s, "off") || !strcmp(s, "0");
	return 1;
}
__setup("bootmap=", bootmap_setup_off);

static int __init bootmap_setup_stages(char *s)
{
	int i;

	for (i = 0; i < BOOTMAP_STAGES && s && *s; i++) {
		unsigned long long v;
		char *comma = strchr(s, ',');

		if (comma)
			*comma = '\0';
		if (!kstrtoull(s, 10, &v))
			bm.stage_weights[i] = v;
		s = comma ? comma + 1 : NULL;
	}
	return 1;
}
__setup("bootmap.stages=", bootmap_setup_stages);

/* Drawing: the same rules as src/render/canvas.zig. */

static void bm_fill(s32 x0, s32 y0, s32 w, s32 h, u32 color)
{
	s32 xa = max(x0, 0), ya = max(y0, 0);
	s32 xb = min_t(s32, x0 + w, bm.width), yb = min_t(s32, y0 + h, bm.height);
	s32 y;

	if (xa >= xb || ya >= yb)
		return;
	for (y = ya; y < yb; y++)
		memset32(bm.fb + (size_t)y * bm.stride + xa, color, xb - xa);
}

static void bm_outline(s32 x, s32 y, s32 w, s32 h, u32 color)
{
	bm_fill(x, y, w, 1, color);
	bm_fill(x, y + h - 1, w, 1, color);
	bm_fill(x, y, 1, h, color);
	bm_fill(x + w - 1, y, 1, h, color);
}

static u32 bm_scale(u32 c, u32 pct)
{
	u32 r = ((c >> 16) & 0xff) * pct / 100;
	u32 g = ((c >> 8) & 0xff) * pct / 100;
	u32 b = (c & 0xff) * pct / 100;

	return (r << 16) | (g << 8) | b;
}

/* FNV-1a 32 bit, as std.hash.Fnv1a_32. */
static u32 bm_fnv1a(const char *s)
{
	u32 h = 0x811c9dc5;

	while (*s) {
		h ^= (unsigned char)*s++;
		h *= 0x01000193;
	}
	return h;
}

static u32 bm_leaf_color(const struct bootmap_node *nd)
{
	return bm_scale(bootmap_stage_colors[nd->stage], 88 + bm_fnv1a(nd->name) % 13);
}

static void bm_draw_box(u32 i, u32 color_if_done)
{
	const struct bootmap_node *nd = &bm.nodes[i];
	struct bootmap_rect r = bm.rects[i];
	s32 w = r.w > BOOTMAP_GAP ? r.w - BOOTMAP_GAP : r.w;
	s32 h = r.h > BOOTMAP_GAP ? r.h - BOOTMAP_GAP : r.h;

	if (!bm.fb || w <= 0 || h <= 0)
		return;
	switch (nd->state) {
	case BM_PENDING:
		bm_fill(r.x, r.y, w, h, BOOTMAP_SURFACE);
		break;
	case BM_ACTIVE:
		/* The kernel has no expected time, so no partial fill. */
		bm_fill(r.x, r.y, w, h, BOOTMAP_SURFACE);
		bm_outline(r.x, r.y, w, h, color_if_done);
		break;
	default:
		bm_fill(r.x, r.y, w, h, color_if_done);
		break;
	}
}

static void bm_draw_leaf(u32 i)
{
	bm_draw_box(i, bm_leaf_color(&bm.nodes[i]));
}

/* The tracepoint probes. They are not __init: a module load after boot
 * also fires initcall_start, and .init.text is free by then. */

static u32 bm_find(initcall_t fn)
{
	u32 k, i;

	if (!bm.live)
		return 0;
	/* Initcalls run in link order, so the next one is almost always at
	 * the cursor. */
	for (k = 0; k < bm.end_leaf - bm.first_leaf; k++) {
		i = bm.first_leaf + (bm.cursor - bm.first_leaf + k) % (bm.end_leaf - bm.first_leaf);
		if (bm.nodes[i].fn == fn && bm.nodes[i].state < BM_DONE)
			return i;
	}
	return 0;
}

static void bm_on_start(void *data, initcall_t fn)
{
	u32 i = bm_find(fn);

	if (!i)
		return;
	bm.cursor = i;
	bm.nodes[i].state = BM_ACTIVE;
	bm.nodes[i].start_ns = local_clock();
	bm_draw_leaf(i);
}

static void bm_on_finish(void *data, initcall_t fn, int ret)
{
	u32 i = bm_find(fn);

	if (!i)
		return;
	/* A non-zero return is almost always "no such hardware here", not a
	 * failure (vm/collect-trace.py has the same rule). */
	bm.nodes[i].state = BM_DONE;
	bm.nodes[i].end_ns = local_clock();
	bm_draw_leaf(i);
	if (i + 1 == bm.end_leaf)
		bm.live = false;
}

/* Build the tree: root, the stages, and under the kernel stage one group
 * for each level with one leaf for each initcall. */

static u32 bm_count(const struct bootmap_level *lv, int nlv)
{
	u32 n = 1 + 2; /* root, the start_kernel group and its leaf */
	int i;

	for (i = 0; i < BOOTMAP_STAGES; i++)
		n += bm.stage_weights[i] > 0 || i == BOOTMAP_STAGE_KERNEL;
	for (i = 0; i < nlv; i++)
		if (lv[i].end > lv[i].start)
			n += 1 + (lv[i].end - lv[i].start);
	return n;
}

static void bm_add(u32 *n, const char *name, unsigned char depth,
		   unsigned char stage, u64 weight, unsigned char state)
{
	struct bootmap_node *nd = &bm.nodes[*n];

	strscpy(nd->name, name, sizeof(nd->name));
	nd->depth = depth;
	nd->stage = stage;
	nd->state = state;
	bm.depth[*n] = depth;
	bm.weight[*n] = weight;
	(*n)++;
}

static int __init bootmap_init(void);

static int __init bootmap_build(void)
{
	const struct bootmap_level lv[] = {
		{ "early", __initcall_start, __initcall0_start },
		{ "pure", __initcall0_start, __initcall1_start },
		{ "core", __initcall1_start, __initcall2_start },
		{ "postcore", __initcall2_start, __initcall3_start },
		{ "arch", __initcall3_start, __initcall4_start },
		{ "subsys", __initcall4_start, __initcall5_start },
		{ "fs", __initcall5_start, __initcallrootfs_start },
		{ "rootfs", __initcallrootfs_start, __initcall6_start },
		{ "device", __initcall6_start, __initcall7_start },
		{ "late", __initcall7_start, __initcall_end },
	};
	const int nlv = ARRAY_SIZE(lv);
	struct bootmap_scratch s;
	u32 n = 0, total;
	int st, l;
	initcall_entry_t *e;
	char buf[BOOTMAP_NAME_LEN];
	bool ran_before = true;

	total = bm_count(lv, nlv);
	bm.nodes = kcalloc(total, sizeof(*bm.nodes), GFP_KERNEL);
	bm.depth = kcalloc(total, 1, GFP_KERNEL);
	bm.weight = kcalloc(total, sizeof(u64), GFP_KERNEL);
	bm.rects = kcalloc(total, sizeof(*bm.rects), GFP_KERNEL);
	s.raw = kcalloc(total, sizeof(u64), GFP_KERNEL);
	s.w = kcalloc(total, sizeof(u32), GFP_KERNEL);
	s.order = kcalloc(total, sizeof(u32), GFP_KERNEL);
	s.kids = kcalloc(total, sizeof(u32), GFP_KERNEL);
	s.out = kcalloc(total, sizeof(struct bootmap_rect), GFP_KERNEL);
	if (!bm.nodes || !bm.depth || !bm.weight || !bm.rects || !s.raw ||
	    !s.w || !s.order || !s.kids || !s.out)
		goto fail;

	bm_add(&n, "boot", 0, 0, 0, BM_PENDING);
	for (st = 0; st < BOOTMAP_STAGES; st++) {
		u64 sw = bm.stage_weights[st];

		if (st != BOOTMAP_STAGE_KERNEL) {
			/* The stages before the kernel are complete. */
			if (sw)
				bm_add(&n, bootmap_stage_names[st], 1, st, sw,
				       st < BOOTMAP_STAGE_KERNEL ? BM_DONE : BM_PENDING);
			continue;
		}
		bm_add(&n, "kernel", 1, st, max_t(u64, sw, 1), BM_ACTIVE);
		/* Each initcall has the same weight, so its box has the same
		 * size, and a group has the size of its count. */
		/* start_kernel ran before any initcall. Weight 8, so it is a
		 * box and not a line. */
		bm_add(&n, "start_kernel", 2, st, 8, BM_DONE);
		bm_add(&n, "start_kernel", 3, st, 1, BM_DONE);
		bm.first_leaf = n;
		for (l = 0; l < nlv; l++) {
			if (lv[l].end <= lv[l].start)
				continue;
			bm_add(&n, lv[l].name, 2, st, lv[l].end - lv[l].start, BM_PENDING);
			for (e = lv[l].start; e < lv[l].end; e++) {
				initcall_t fn = initcall_from_entry(e);

				snprintf(buf, sizeof(buf), "%ps", fn);
				/* The early initcalls up to this one ran before
				 * the probes were attached: they are done. */
				bm_add(&n, buf, 3, st, 1, ran_before ? BM_DONE : BM_PENDING);
				bm.nodes[n - 1].fn = fn;
				if (fn == bootmap_init)
					ran_before = false;
			}
		}
		bm.end_leaf = n;
	}
	bm.n = n;
	bm.cursor = bm.first_leaf;

	bootmap_layout_tree(bm.depth, bm.weight, bm.n,
			    (struct bootmap_rect){ 0, 0, bm.width, bm.height },
			    bm.rects, &s);
	kfree(s.raw);
	kfree(s.w);
	kfree(s.order);
	kfree(s.kids);
	kfree(s.out);
	return 0;
fail:
	kfree(s.raw);
	kfree(s.w);
	kfree(s.order);
	kfree(s.kids);
	kfree(s.out);
	return -ENOMEM;
}

static int __init bootmap_map_fb(void)
{
	const struct screen_info *si = &screen_info;
	u64 base = __screen_info_lfb_base(si);

	if (screen_info_video_type(si) != VIDEO_TYPE_EFI || !base) {
		pr_info("bootmap: no EFI framebuffer, nothing to draw on\n");
		return -ENODEV;
	}
	if (si->lfb_depth != 32) {
		pr_info("bootmap: framebuffer depth %u, only 32 is supported\n", si->lfb_depth);
		return -ENODEV;
	}
	bm.width = min_t(u32, si->lfb_width, BOOTMAP_MAX_SIDE);
	bm.height = min_t(u32, si->lfb_height, BOOTMAP_MAX_SIDE);
	bm.stride = si->lfb_linelength / 4;
	bm.fb = memremap(base, (size_t)si->lfb_linelength * si->lfb_height, MEMREMAP_WC);
	if (!bm.fb)
		return -ENOMEM;
	return 0;
}

static int bootmap_show(struct seq_file *m, void *v)
{
	u32 i;

	seq_printf(m, "bootmap 1 %u %u %u\n", bm.width, bm.height, bm.n);
	for (i = 0; i < bm.n; i++) {
		const struct bootmap_node *nd = &bm.nodes[i];
		const struct bootmap_rect *r = &bm.rects[i];

		seq_printf(m, "%u %u %u %d %d %d %d %u %llu %llu %s\n", i, nd->depth,
			   nd->stage, r->x, r->y, r->w, r->h, nd->state,
			   nd->start_ns / 1000, nd->end_ns / 1000, nd->name);
	}
	return 0;
}

static int __init bootmap_init(void)
{
	u32 i;
	int err;

	if (bm.off)
		return 0;
	err = bootmap_map_fb();
	if (err)
		return 0;
	err = bootmap_build();
	if (err) {
		pr_err("bootmap: no memory for %u boxes\n", bm.n);
		return 0;
	}

	/* The first frame: black, then the boxes that are already done. */
	bm_fill(0, 0, bm.width, bm.height, BOOTMAP_SURFACE);
	for (i = 1; i < bm.n; i++) {
		const struct bootmap_node *nd = &bm.nodes[i];

		if (nd->state == BM_DONE && (nd->depth == 3 || bm.depth[i] == 1))
			bm_draw_box(i, nd->depth == 3 ? bm_leaf_color(nd) :
				    bootmap_stage_colors[nd->stage]);
	}

	bm.live = true;
	err = register_trace_initcall_start(bm_on_start, NULL);
	if (!err)
		err = register_trace_initcall_finish(bm_on_finish, NULL);
	if (err) {
		pr_err("bootmap: cannot attach to the initcall tracepoints: %d\n", err);
		bm.live = false;
		return 0;
	}
	pr_info("bootmap: %u boxes, %u initcalls, on %ux%u\n", bm.n,
		bm.end_leaf - bm.first_leaf, bm.width, bm.height);
	return 0;
}
early_initcall(bootmap_init);

static int __init bootmap_proc_init(void)
{
	if (bm.n)
		proc_create_single("bootmap", 0444, NULL, bootmap_show);
	return 0;
}
fs_initcall(bootmap_proc_init);
