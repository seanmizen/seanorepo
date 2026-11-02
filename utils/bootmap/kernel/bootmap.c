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
 *   bootmap.fill=raster|rows-up|spiral, bootmap.fill_ms=250,
 *   bootmap.outline=1, bootmap.empty=black|white|dim|#rrggbb,
 *   bootmap.spawn=start|plan, bootmap.gap=1, bootmap.pad=1,1,1,
 *   bootmap.warn_ms=500, bootmap.late=clear|keep,
 *   bootmap.order=boot|size|best, bootmap.other=10
 *                                the style options of src/render/style.zig
 *
 * A kernel thread redraws the boxes that are filling, every 16 ms, until
 * every box is full. So a box that completes in microseconds still fills
 * over fill_ms, and the viewer can see it fill.
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
#include <linux/kthread.h>
#include <linux/delay.h>
#include <linux/spinlock.h>
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

enum bootmap_fill { BM_RASTER, BM_ROWS_UP, BM_SPIRAL };

/* src/render/style.zig: the same options and the same defaults. */
static struct {
	int fill;
	u32 fill_ms;
	u32 outline;
	bool empty_dim;
	u32 empty;
	bool spawn_plan;
	u32 gap;
	unsigned char pads[3];
	u32 warn_ms;
	bool late_keep;
	int order;		/* BOOTMAP_ORDER_* */
	u32 other;		/* permille: smaller groups go into "other" */
} bms = {
	.fill = BM_RASTER, .fill_ms = 250, .outline = 1, .empty = 0x000000,
	.gap = 1, .pads = { 1, 1, 1 }, .warn_ms = 500,
	.order = BOOTMAP_ORDER_BOOT, .other = 10,
};

/* src/render/palette.zig: the pixels that a late step paints. */
#define BOOTMAP_WARNING 0xfab219

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
	bool spawned;		/* the outline and the empty colour are drawn */
	u32 late0, late1;	/* the late pixels: [late0, late1) are yellow */
	bool full;		/* the box is solid: nothing more to draw */
	u32 drawn;		/* the pixels of the interior that are painted */
};

static struct {
	bool off;
	u64 stage_weights[BOOTMAP_STAGES];
	u32 *fb;
	u32 width, height, stride;
	u32 n;
	struct bootmap_node *nodes;
	unsigned char *depth;
	unsigned char *other;	/* 1 for the "other" group */
	u64 *weight;
	struct bootmap_rect *rects;
	u32 first_leaf, end_leaf; /* the kernel leaves: [first_leaf, end_leaf) */
	u32 cursor;
	u32 pending;		/* the kernel leaves that have not finished */
	bool live;
	spinlock_t lock;
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

static int __init bootmap_setup_fill(char *s)
{
	if (!strcmp(s, "raster"))
		bms.fill = BM_RASTER;
	else if (!strcmp(s, "rows-up"))
		bms.fill = BM_ROWS_UP;
	else if (!strcmp(s, "spiral"))
		bms.fill = BM_SPIRAL;
	return 1;
}
__setup("bootmap.fill=", bootmap_setup_fill);

static int __init bootmap_setup_fill_ms(char *s)
{
	u32 v;

	if (!kstrtou32(s, 10, &v))
		bms.fill_ms = max_t(u32, v, 1);
	return 1;
}
__setup("bootmap.fill_ms=", bootmap_setup_fill_ms);

static int __init bootmap_setup_outline(char *s)
{
	if (kstrtou32(s, 10, &bms.outline))
		pr_warn("bootmap: bad number in an option\n");
	return 1;
}
__setup("bootmap.outline=", bootmap_setup_outline);

static int __init bootmap_setup_empty(char *s)
{
	bms.empty_dim = false;
	if (!strcmp(s, "white"))
		bms.empty = 0xffffff;
	else if (!strcmp(s, "black"))
		bms.empty = 0;
	else if (!strcmp(s, "dim"))
		bms.empty_dim = true;
	else if (s[0] == '#')
		if (kstrtou32(s + 1, 16, &bms.empty))
			pr_warn("bootmap: bad number in an option\n");
	return 1;
}
__setup("bootmap.empty=", bootmap_setup_empty);

static int __init bootmap_setup_spawn(char *s)
{
	bms.spawn_plan = !strcmp(s, "plan");
	return 1;
}
__setup("bootmap.spawn=", bootmap_setup_spawn);

static int __init bootmap_setup_gap(char *s)
{
	if (kstrtou32(s, 10, &bms.gap))
		pr_warn("bootmap: bad number in an option\n");
	return 1;
}
__setup("bootmap.gap=", bootmap_setup_gap);

static int __init bootmap_setup_warn_ms(char *s)
{
	if (kstrtou32(s, 10, &bms.warn_ms))
		pr_warn("bootmap: bad number in an option\n");
	return 1;
}
__setup("bootmap.warn_ms=", bootmap_setup_warn_ms);

static int __init bootmap_setup_late(char *s)
{
	bms.late_keep = !strcmp(s, "keep");
	return 1;
}
__setup("bootmap.late=", bootmap_setup_late);

static int __init bootmap_setup_order(char *s)
{
	if (!strcmp(s, "boot"))
		bms.order = BOOTMAP_ORDER_BOOT;
	else if (!strcmp(s, "size"))
		bms.order = BOOTMAP_ORDER_SIZE;
	else if (!strcmp(s, "best"))
		bms.order = BOOTMAP_ORDER_BEST;
	return 1;
}
__setup("bootmap.order=", bootmap_setup_order);

static int __init bootmap_setup_other(char *s)
{
	if (kstrtou32(s, 10, &bms.other))
		pr_warn("bootmap: bad number in an option\n");
	return 1;
}
__setup("bootmap.other=", bootmap_setup_other);

static int __init bootmap_setup_pad(char *s)
{
	int i;

	for (i = 0; i < 3 && s && *s; i++) {
		char *comma = strchr(s, ',');
		u8 v;

		if (comma)
			*comma = '\0';
		if (!kstrtou8(s, 10, &v))
			bms.pads[i] = v;
		s = comma ? comma + 1 : NULL;
	}
	return 1;
}
__setup("bootmap.pad=", bootmap_setup_pad);

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

/* Paint pixels [k0, k1) of the area in the order of bms.fill: the same
 * orders as fillRange in src/render/canvas.zig. */
static void bm_fill_range(s32 x, s32 y, s32 w, s32 h, u32 k0, u32 k1, u32 color)
{
	if (w <= 0 || h <= 0 || k1 <= k0)
		return;
	if (bms.fill == BM_RASTER) {
		u32 k = k0;

		while (k < k1) {
			u32 col = k % w, run = min_t(u32, w - col, k1 - k);

			bm_fill(x + col, y + k / w, run, 1, color);
			k += run;
		}
	} else if (bms.fill == BM_ROWS_UP) {
		s32 r0 = k0 / w, r1 = k1 / w;

		if (r1 > r0)
			bm_fill(x, y + h - r1, w, r1 - r0, color);
	} else {
		u32 off = 0;

		while (w > 0 && h > 0 && off < k1) {
			struct { s32 sx, sy, dx, dy, len; } sd[4] = {
				{ x, y, 1, 0, w },
				{ x + w - 1, y + 1, 0, 1, h - 1 },
				{ x + w - 2, y + h - 1, -1, 0, h > 1 ? w - 1 : 0 },
				{ x, y + h - 2, 0, -1, w > 1 ? h - 2 : 0 },
			};
			int j;

			for (j = 0; j < 4; j++) {
				u32 len, a, b;
				s32 s0, n, px, py, qx, qy;

				if (sd[j].len <= 0)
					continue;
				len = sd[j].len;
				a = max(k0, off);
				b = min(k1, off + len);
				if (b > a) {
					s0 = a - off;
					n = b - a;
					px = sd[j].sx + sd[j].dx * s0;
					py = sd[j].sy + sd[j].dy * s0;
					qx = px + sd[j].dx * (n - 1);
					qy = py + sd[j].dy * (n - 1);
					bm_fill(min(px, qx), min(py, qy),
						max(px, qx) - min(px, qx) + 1,
						max(py, qy) - min(py, qy) + 1, color);
				}
				off += len;
			}
			x++;
			y++;
			w -= 2;
			h -= 2;
		}
	}
}

/* activeAt() in src/render/style.zig: up to span, t / span * 900. After
 * span, 1000 - 100 * span / t, at most 999: a late step still paints. */
static u64 bm_active_at(u64 t, u64 span)
{
	if (t <= span)
		return div64_u64(t * 900, span);
	return min_t(u64, 1000 - div64_u64(100 * span, t), 999);
}

/* permille() in src/render/style.zig, with expected = 0: the kernel does
 * not know how long an initcall takes. */
static u32 bm_permille(const struct bootmap_node *nd, u64 now_ns)
{
	u64 fill_us = (u64)bms.fill_ms * 1000;
	u64 start = nd->start_ns / 1000, now = now_ns / 1000, end, at_end;

	if (now < start)
		return 0;
	if (nd->state != BM_DONE || now < nd->end_ns / 1000)
		return bm_active_at(now - start, fill_us);
	end = nd->end_ns / 1000;
	at_end = bm_active_at(end - start, fill_us);
	return min_t(u64, at_end + div64_u64((now - end) * 1000, fill_us), 1000);
}

/* Bring one leaf up to date at time now_ns. Call with bm.lock held.
 * It paints only what changed. Return true when the leaf is full. */
static bool bm_update_leaf(u32 i, u64 now_ns)
{
	struct bootmap_node *nd = &bm.nodes[i];
	struct bootmap_rect r = bm.rects[i];
	s32 w = r.w > (s32)bms.gap ? r.w - bms.gap : r.w;
	s32 h = r.h > (s32)bms.gap ? r.h - bms.gap : r.h;
	u32 color = bm_leaf_color(nd), p, area, k;
	bool late;
	s32 o;

	if (nd->full)
		return true;
	if (!bm.fb || w <= 0 || h <= 0) {
		nd->full = nd->state == BM_DONE;
		return nd->full;
	}
	if (nd->state == BM_PENDING && !bms.spawn_plan)
		return false;
	o = (w > 2 * (s32)bms.outline && h > 2 * (s32)bms.outline) ? bms.outline : 0;
	if (!nd->spawned) {
		if (o)
			bm_fill(r.x, r.y, w, h, color);
		bm_fill(r.x + o, r.y + o, w - 2 * o, h - 2 * o,
			bms.empty_dim ? bm_scale(color, 25) : bms.empty);
		nd->spawned = true;
		nd->drawn = 0;
		nd->late0 = nd->late1 = 0;
	}
	p = nd->state == BM_PENDING ? 0 : bm_permille(nd, now_ns);
	area = (w - 2 * o) * (h - 2 * o);
	k = (u32)div64_u64((u64)area * p, 1000);
	/* A step in flight for longer than warn_ms is late. The pixels that
	 * it paints from then on are yellow (lateAt in style.zig). */
	late = nd->state == BM_ACTIVE &&
	       now_ns - nd->start_ns > (u64)bms.warn_ms * 1000000;
	if (late && !nd->late1)
		nd->late0 = nd->late1 = nd->drawn;
	if (p >= 1000) {
		bm_fill(r.x, r.y, w, h, color);
		if (bms.late_keep && nd->late1 > nd->late0)
			bm_fill_range(r.x + o, r.y + o, w - 2 * o, h - 2 * o,
				      nd->late0, nd->late1, BOOTMAP_WARNING);
		nd->full = true;
		return true;
	}
	bm_fill_range(r.x + o, r.y + o, w - 2 * o, h - 2 * o, nd->drawn, k,
		      late ? BOOTMAP_WARNING : color);
	if (late)
		nd->late1 = max(nd->late1, k);
	if (nd->state == BM_DONE && !bms.late_keep && nd->late1 > nd->late0) {
		/* late=clear: the step ended, so its yellow pixels get the
		 * stage colour. */
		bm_fill_range(r.x + o, r.y + o, w - 2 * o, h - 2 * o,
			      nd->late0, nd->late1, color);
		nd->late0 = nd->late1;
	}
	nd->drawn = max(nd->drawn, k);
	return false;
}

/* The animation thread: it redraws the leaves that are filling. */
static int bm_animate(void *unused)
{
	for (;;) {
		u64 now = local_clock();
		bool all_full = true;
		u32 i;

		spin_lock(&bm.lock);
		for (i = 1; i < bm.n; i++) {
			if (bm.depth[i] != 3)
				continue;
			/* After the last initcall, a box that never started
			 * (a skipped initcall) stays empty. */
			/* After the initcalls (SYSTEM_RUNNING), a box that
			 * never started stays empty. */
			if (bm_update_leaf(i, now) ||
			    ((!bm.live || system_state >= SYSTEM_RUNNING) &&
			     bm.nodes[i].state == BM_PENDING))
				continue;
			all_full = false;
		}
		spin_unlock(&bm.lock);
		if (all_full)
			break;
		msleep(16);
	}
	pr_info("bootmap: every kernel box is full\n");
	return 0;
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
	spin_lock(&bm.lock);
	bm.nodes[i].state = BM_ACTIVE;
	bm.nodes[i].start_ns = local_clock();
	bm_update_leaf(i, bm.nodes[i].start_ns);
	spin_unlock(&bm.lock);
}

static void bm_on_finish(void *data, initcall_t fn, int ret)
{
	u32 i = bm_find(fn);

	if (!i)
		return;
	/* A non-zero return is almost always "no such hardware here", not a
	 * failure (vm/collect-trace.py has the same rule). */
	spin_lock(&bm.lock);
	bm.nodes[i].state = BM_DONE;
	bm.nodes[i].end_ns = local_clock();
	bm_update_leaf(i, bm.nodes[i].end_ns);
	spin_unlock(&bm.lock);
	/* The leaves are not in run order ("other" is last), so count. */
	if (--bm.pending == 0)
		bm.live = false;
}

/* Build the tree: root, the stages, and under the kernel stage one group
 * for each level with one leaf for each initcall. */

static u32 bm_count(const struct bootmap_level *lv, int nlv)
{
	u32 n = 1 + 2 + 1; /* root, start_kernel group and leaf, "other" */
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

/* Add one leaf for each initcall of a level. An entry at or before self
 * (the entry of bootmap_init) ran before the probes: it is done. */
static void __init bm_add_level(u32 *n, const struct bootmap_level *lv,
				unsigned char st, initcall_entry_t *self)
{
	char buf[BOOTMAP_NAME_LEN];
	initcall_entry_t *e;

	for (e = lv->start; e < lv->end; e++) {
		initcall_t fn = initcall_from_entry(e);
		bool before = self && lv->start == __initcall_start && e <= self;

		snprintf(buf, sizeof(buf), "%ps", fn);
		bm_add(n, buf, 3, st, 1, before ? BM_DONE : BM_PENDING);
		bm.nodes[*n - 1].fn = fn;
	}
}

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
	u32 n = 0, total, i;
	int st, l;
	initcall_entry_t *e;
	bool small[ARRAY_SIZE(lv)];
	u64 kw;
	int nsmall;
	initcall_entry_t *self = NULL;

	/* The early initcalls up to bootmap_init ran before the probes were
	 * attached: they are done. */
	for (e = __initcall_start; e < __initcall0_start; e++)
		if (initcall_from_entry(e) == bootmap_init)
			self = e;

	total = bm_count(lv, nlv);
	bm.nodes = kcalloc(total, sizeof(*bm.nodes), GFP_KERNEL);
	bm.depth = kcalloc(total, 1, GFP_KERNEL);
	bm.other = kcalloc(total, 1, GFP_KERNEL);
	bm.weight = kcalloc(total, sizeof(u64), GFP_KERNEL);
	bm.rects = kcalloc(total, sizeof(*bm.rects), GFP_KERNEL);
	s.raw = kcalloc(total, sizeof(u64), GFP_KERNEL);
	s.w = kcalloc(total, sizeof(u32), GFP_KERNEL);
	s.order = kcalloc(total, sizeof(u32), GFP_KERNEL);
	s.kids = kcalloc(total, sizeof(u32), GFP_KERNEL);
	s.out = kcalloc(total, sizeof(struct bootmap_rect), GFP_KERNEL);
	s.tmp = kcalloc(total, sizeof(struct bootmap_rect), GFP_KERNEL);
	if (!bm.nodes || !bm.depth || !bm.other || !bm.weight || !bm.rects ||
	    !s.raw || !s.w || !s.order || !s.kids || !s.out || !s.tmp)
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
		/* The small levels go into one "other" group, the last group
		 * (the rule of mergeSmall in src/model/plan.zig). start_kernel
		 * is never small. */
		kw = 8;
		for (l = 0; l < nlv; l++)
			kw += lv[l].end - lv[l].start;
		nsmall = 0;
		for (l = 0; l < nlv; l++) {
			u64 cnt = lv[l].end - lv[l].start;

			small[l] = cnt && cnt * 1000 < (u64)bms.other * kw;
			nsmall += small[l];
		}
		if (nsmall < 2)
			memset(small, 0, sizeof(small));
		bm.first_leaf = n;
		for (l = 0; l < nlv; l++) {
			if (lv[l].end <= lv[l].start || small[l])
				continue;
			bm_add(&n, lv[l].name, 2, st, lv[l].end - lv[l].start, BM_PENDING);
			bm_add_level(&n, &lv[l], st, self);
		}
		if (nsmall >= 2) {
			u64 ow = 0;

			for (l = 0; l < nlv; l++)
				if (small[l])
					ow += lv[l].end - lv[l].start;
			bm.other[n] = 1;
			bm_add(&n, "other", 2, st, ow, BM_PENDING);
			for (l = 0; l < nlv; l++)
				if (small[l])
					bm_add_level(&n, &lv[l], st, self);
		}
		bm.end_leaf = n;
	}
	bm.n = n;
	bm.cursor = bm.first_leaf;
	for (i = bm.first_leaf; i < bm.end_leaf; i++)
		bm.pending += bm.depth[i] == 3 && bm.nodes[i].state != BM_DONE;

	bootmap_layout_tree(bm.depth, bm.weight, bm.other, bm.n,
			    (struct bootmap_rect){ 0, 0, bm.width, bm.height },
			    bms.pads, 0, bms.order, bm.rects, &s);
	kfree(s.raw);
	kfree(s.w);
	kfree(s.order);
	kfree(s.kids);
	kfree(s.out);
	kfree(s.tmp);
	return 0;
fail:
	kfree(s.raw);
	kfree(s.w);
	kfree(s.order);
	kfree(s.kids);
	kfree(s.out);
	kfree(s.tmp);
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

	/* The first frame: black, then the boxes that are already done. The
	 * kernel leaves that ran before the probes start and end now, so
	 * they fill like the others. */
	spin_lock_init(&bm.lock);
	bm_fill(0, 0, bm.width, bm.height, BOOTMAP_SURFACE);
	for (i = 1; i < bm.n; i++) {
		struct bootmap_node *nd = &bm.nodes[i];

		if (nd->state != BM_DONE)
			continue;
		if (nd->depth == 1) {
			struct bootmap_rect r = bm.rects[i];

			bm_fill(r.x, r.y, r.w, r.h, bootmap_stage_colors[nd->stage]);
		} else if (nd->depth == 3) {
			nd->start_ns = nd->end_ns = local_clock();
		}
	}
	for (i = 1; i < bm.n; i++)
		if (bm.depth[i] == 3)
			bm_update_leaf(i, local_clock());

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
	kthread_run(bm_animate, NULL, "bootmap");
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
