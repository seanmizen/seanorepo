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
 *   bootmap.fill=rows-up|raster|spiral, bootmap.fill_ms=250,
 *   bootmap.outline=0, bootmap.empty=dim|black|white|#rrggbb,
 *   bootmap.spawn=plan|start, bootmap.gap=1, bootmap.pad=1,1,1,
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
#include <linux/ctype.h>
#include <linux/efi.h>
#include <linux/uaccess.h>
#include <trace/events/initcall.h>

#include "bootmap_layout.h"
#include "bootmap_palette.h"
#include "bootmap_font.h"

#define BOOTMAP_NAME_LEN 48
#define BOOTMAP_STAGES 5
#define BOOTMAP_STAGE_KERNEL 2

enum bootmap_state { BM_PENDING, BM_ACTIVE, BM_DONE, BM_FAILED };

static const char *const bootmap_stage_names[BOOTMAP_STAGES] = {
	"firmware", "loader", "kernel", "initrd", "systemd",
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
	int labels;		/* 0 all, 1 areas, 2 none */
	bool font_4x6;
	bool cut;		/* overflow=cut */
	int fit;		/* enum bm_fit */
	u32 fit_n;		/* for fit=chars:N and fit=percent:N */
	int ink;		/* 0 inverse, 1 white, 2 black */
	int color_by;		/* enum bm_color_by */
	u32 palette;
	u32 jitter;
} bms = {
	.fill = BM_ROWS_UP, .fill_ms = 250, .outline = 0, .empty = 0x000000,
	.empty_dim = true, .spawn_plan = true,
	.gap = 1, .pads = { 1, 1, 1 }, .warn_ms = 500,
	.order = BOOTMAP_ORDER_BOOT, .other = 10,
	.fit = 1, .jitter = 12,
};

/* text.Fit and color.By, in the same order. */
enum bm_fit { BM_FIT_ANY, BM_FIT_WHOLE, BM_FIT_WORD, BM_FIT_WORDS, BM_FIT_CHARS, BM_FIT_PERCENT };
enum bm_color_by { BM_C_STAGE, BM_C_GROUP, BM_C_KIND, BM_C_HASH, BM_C_TIME, BM_C_DURATION, BM_C_MONO };

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


/* One initcall, from early_initcall on. The probes update it before the
 * picture exists (the picture needs the EFI variable, at postcore). */
struct bm_ic {
	initcall_t fn;
	unsigned char level;
	unsigned char state;
	u64 start_ns, end_ns;
	u32 last_us;		/* the time of the last boot */
	char name[BOOTMAP_NAME_LEN];
};

struct bootmap_node {
	char name[BOOTMAP_NAME_LEN];
	unsigned char depth;
	unsigned char stage;
	unsigned char state;
	s32 ic;			/* a kernel leaf: its initcall (bm.ics), or -1 */
	u32 expected_us;	/* the time of the last boot, 0 if not known */
	u64 start_ns, end_ns;
	bool spawned;		/* the outline and the empty colour are drawn */
	u32 late0, late1;	/* the late pixels: [late0, late1) are yellow */
	bool full;		/* the box is solid: nothing more to draw */
	u32 drawn;		/* the pixels of the interior that are painted */
	u32 parent;
	u16 gidx;		/* a group: its place among the groups of its stage */
	u16 kids;		/* the number of children */
	bool titled;		/* the title strip is drawn */
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
	bool handoff;		/* the daemon draws now: the kernel stops */
	bool drawing;		/* the picture exists (bootmap_draw_init) */
	struct bm_ic *ics;	/* every initcall, in link order */
	u32 nic;
	u32 *ic_node;		/* the leaf of each initcall, or 0 */
	u32 ic_cursor;
	u32 names_hash;		/* FNV-1a of the initcall names: the times of
				 * the last boot are for this kernel only */
	bool have_times;
	u64 start_kernel_us;
	u32 initrd_leaf;	/* 0: no initrd stage */
	u32 header_h;
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

static int __init bootmap_setup_labels(char *s)
{
	bms.labels = !strcmp(s, "areas") ? 1 : !strcmp(s, "none") ? 2 : 0;
	return 1;
}
__setup("bootmap.labels=", bootmap_setup_labels);

static int __init bootmap_setup_font(char *s)
{
	bms.font_4x6 = !strcmp(s, "4x6");
	return 1;
}
__setup("bootmap.font=", bootmap_setup_font);

static int __init bootmap_setup_overflow(char *s)
{
	bms.cut = !strcmp(s, "cut");
	return 1;
}
__setup("bootmap.overflow=", bootmap_setup_overflow);

static int __init bootmap_setup_fit(char *s)
{
	if (!strcmp(s, "any"))
		bms.fit = BM_FIT_ANY;
	else if (!strcmp(s, "whole"))
		bms.fit = BM_FIT_WHOLE;
	else if (!strcmp(s, "word"))
		bms.fit = BM_FIT_WORD;
	else if (!strcmp(s, "words"))
		bms.fit = BM_FIT_WORDS;
	else if (!strncmp(s, "chars:", 6) && !kstrtou32(s + 6, 10, &bms.fit_n))
		bms.fit = BM_FIT_CHARS;
	else if (!strncmp(s, "percent:", 8) && !kstrtou32(s + 8, 10, &bms.fit_n))
		bms.fit = BM_FIT_PERCENT;
	return 1;
}
__setup("bootmap.fit=", bootmap_setup_fit);

static int __init bootmap_setup_ink(char *s)
{
	bms.ink = !strcmp(s, "white") ? 1 : !strcmp(s, "black") ? 2 : 0;
	return 1;
}
__setup("bootmap.ink=", bootmap_setup_ink);

static int __init bootmap_setup_color(char *s)
{
	static const char *const names[] = { "stage", "group", "kind", "hash", "time", "duration", "mono" };
	int i;

	for (i = 0; i < ARRAY_SIZE(names); i++)
		if (!strcmp(s, names[i]))
			bms.color_by = i;
	return 1;
}
__setup("bootmap.color=", bootmap_setup_color);

static int __init bootmap_setup_palette(char *s)
{
	u32 i;

	for (i = 0; i < BOOTMAP_PALETTES; i++)
		if (!strcmp(s, bootmap_pal_names[i]))
			bms.palette = i;
	return 1;
}
__setup("bootmap.palette=", bootmap_setup_palette);

static int __init bootmap_setup_jitter(char *s)
{
	if (kstrtou32(s, 10, &bms.jitter))
		pr_warn("bootmap: bad number in an option\n");
	bms.jitter = min_t(u32, bms.jitter, 2 * BOOTMAP_JITTER_MAX);
	return 1;
}
__setup("bootmap.jitter=", bootmap_setup_jitter);

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

/* A palette colour (stop) with the jitter of the name: leafColor in
 * src/render/canvas.zig, from the table of bootmap_palette.h. */
static u32 bm_pal(u32 stop, const char *name)
{
	u32 p = min_t(u32, bms.palette, BOOTMAP_PALETTES - 1);
	s32 j = bms.jitter, v = 0;

	stop %= bootmap_pal_len[p];
	if (j && name)
		v = (s32)(bm_fnv1a(name) % (u32)(j + 1)) - j / 2;
	return bootmap_pal_shade[p][stop][v + BOOTMAP_JITTER_MAX];
}

/* The kind of a leaf: kindOf in src/render/canvas.zig. */
static u32 bm_kind(const struct bootmap_node *nd)
{
	static const char *const kinds[] = { ".service", ".mount", ".socket", ".timer", ".path" };
	size_t n = strlen(nd->name);
	int i;

	if (nd->stage == BOOTMAP_STAGE_KERNEL)
		return 0;
	for (i = 0; i < ARRAY_SIZE(kinds); i++) {
		size_t k = strlen(kinds[i]);

		if (n >= k && !strcmp(nd->name + n - k, kinds[i]))
			return i + 1;
	}
	return 6;
}

/* The colour of a leaf. hash, time and duration need floating point (a
 * ramp): the kernel uses the stage colour for them, and the daemon draws
 * them at the handoff. */
static u32 bm_leaf_color(const struct bootmap_node *nd)
{
	u32 p = min_t(u32, bms.palette, BOOTMAP_PALETTES - 1);

	switch (bms.color_by) {
	case BM_C_GROUP:
		return bm_pal(bm.nodes[nd->parent].gidx, nd->name);
	case BM_C_KIND:
		return bm_pal(bm_kind(nd), nd->name);
	case BM_C_MONO:
		return bm_pal(bootmap_pal_len[p] / 2, nd->name);
	default:
		return bm_pal(nd->stage, nd->name);
	}
}

/* ---- Text: the rules of src/render/text.zig ---- */

struct bm_font {
	u32 w, h;
	const unsigned char *rows;
};

static struct bm_font bm_font(void)
{
	if (bms.font_4x6)
		return (struct bm_font){ BOOTMAP_FONT_MINI_4X6_W, BOOTMAP_FONT_MINI_4X6_H, bootmap_font_mini_4x6 };
	return (struct bm_font){ BOOTMAP_FONT_F6X8_W, BOOTMAP_FONT_F6X8_H, bootmap_font_f6x8 };
}

#define BM_MAX_LINES 32

struct bm_broken {
	u32 n, shown, splits;
	bool first_split;
	u32 start[BM_MAX_LINES], len[BM_MAX_LINES];
};

static bool bm_isword(char c)
{
	return isalnum(c);
}

/* breakLines in src/render/text.zig. */
static void bm_break(const char *s, u32 slen, u32 per_line, u32 max_lines,
		     bool cut, struct bm_broken *r)
{
	u32 i = 0, lines = cut ? min_t(u32, max_lines, 1) : max_lines;
	u32 first_end = slen, j;

	memset(r, 0, sizeof(*r));
	for (j = 0; j < slen; j++)
		if (!bm_isword(s[j])) {
			first_end = j + 1;
			break;
		}
	while (r->n < lines && r->n < BM_MAX_LINES && i < slen && per_line > 0) {
		u32 end = min(i + per_line, slen);

		if (end < slen && bm_isword(s[end - 1])) {
			bool has_word = false;
			u32 k;

			j = end;
			while (j > i && bm_isword(s[j - 1]))
				j--;
			for (k = i; k < j; k++)
				has_word |= bm_isword(s[k]);
			if (j > i && has_word && !cut) {
				end = j;
			} else {
				r->splits++;
				if (end < first_end)
					r->first_split = true;
			}
		}
		r->start[r->n] = i;
		r->len[r->n] = end - i;
		r->n++;
		i = end;
	}
	r->shown = i;
	if (i < first_end)
		r->first_split = true;
}

/* fits in src/render/text.zig. */
static bool bm_fits(int fit, u32 slen, const struct bm_broken *r)
{
	switch (fit) {
	case BM_FIT_ANY:
		return r->shown > 0;
	case BM_FIT_WHOLE:
		return r->shown == slen;
	case BM_FIT_WORD:
		return !r->first_split;
	case BM_FIT_WORDS:
		return r->shown == slen && r->splits == 0;
	case BM_FIT_CHARS:
		return r->shown >= min(bms.fit_n, slen);
	default:
		return r->shown * 100 >= bms.fit_n * slen;
	}
}

/* The place of pixel (x, y) in the fill order of the area: it is filled
 * when the place is less than the painted count. Used for inverse ink,
 * because the kernel paints only new pixels and cannot repaint a box. */
static u32 bm_fill_index(s32 ix, s32 iy, s32 iw, s32 ih, s32 x, s32 y)
{
	s32 r, x0, y0, w, h, q;
	u32 off = 0;

	if (bms.fill == BM_RASTER)
		return (y - iy) * iw + (x - ix);
	if (bms.fill == BM_ROWS_UP)
		return (iy + ih - 1 - y) * iw + (iw - 1);
	r = min(min(x - ix, y - iy), min(ix + iw - 1 - x, iy + ih - 1 - y));
	for (q = 0; q < r; q++) {
		w = iw - 2 * q;
		h = ih - 2 * q;
		off += h == 1 ? w : w == 1 ? h : 2 * w + 2 * h - 4;
	}
	x0 = ix + r;
	y0 = iy + r;
	w = iw - 2 * r;
	h = ih - 2 * r;
	if (y == y0)
		return off + (x - x0);
	if (x == x0 + w - 1)
		return off + w + (y - y0 - 1);
	if (y == y0 + h - 1)
		return off + w + (h - 1) + (x0 + w - 2 - x);
	return off + w + (h - 1) + (w - 1) + (y0 + h - 2 - y);
}

/* Draw text in (x, y, w, h). ink: a solid colour, or with inverse, the
 * empty colour on painted pixels and `base` on the others. */
static void bm_text(s32 x, s32 y, s32 w, s32 h, const char *s, bool cut, int fit,
		    bool inverse, u32 solid, u32 base, u32 empty,
		    s32 ix, s32 iy, s32 iw, s32 ih, u32 painted, bool all_painted)
{
	struct bm_font f = bm_font();
	struct bm_broken r;
	u32 slen = strlen(s), line_h = f.h + 1, l, c, gx, gy;

	if (w < (s32)f.w || h < (s32)f.h || !slen)
		return;
	bm_break(s, slen, w / f.w, (h + 1) / line_h, cut, &r);
	if (!bm_fits(fit, slen, &r))
		return;
	for (l = 0; l < r.n; l++)
		for (c = 0; c < r.len[l]; c++) {
			unsigned char ch = s[r.start[l] + c];

			for (gy = 0; gy < f.h; gy++) {
				unsigned char bits = f.rows[ch * f.h + gy];

				for (gx = 0; gx < f.w; gx++) {
					s32 px = x + (s32)(c * f.w + gx), py = y + (s32)(l * line_h + gy);
					u32 col = solid;

					if (!((bits >> (7 - gx)) & 1))
						continue;
					if (px < 0 || py < 0 || px >= (s32)bm.width || py >= (s32)bm.height)
						continue;
					if (inverse) {
						bool filled = all_painted ||
							bm_fill_index(ix, iy, iw, ih, px, py) < painted;

						col = filled ? empty : base;
					}
					bm.fb[(size_t)py * bm.stride + px] = col;
				}
			}
		}
}

/* The title strip of a node, or a rectangle with w = 0. */
static struct bootmap_rect bm_header(u32 i)
{
	struct bootmap_rect in = bootmap_inset(bm.rects[i], bms.pads[min_t(u32, bm.depth[i], 2)]);
	const struct bootmap_node *nd = &bm.nodes[i];

	if (!bm.header_h || !(nd->depth == 1 || (nd->depth == 2 && nd->kids > 1)) ||
	    in.h <= (s32)bm.header_h)
		return (struct bootmap_rect){ 0, 0, 0, 0 };
	return (struct bootmap_rect){ in.x, in.y, in.w, bm.header_h };
}

/* drawHeader in src/render/canvas.zig: the name, in the stage colour, on
 * black. */
static void bm_draw_title(u32 i)
{
	struct bootmap_rect h = bm_header(i);
	struct bootmap_node *nd = &bm.nodes[i];

	if (nd->titled || h.w <= 0)
		return;
	nd->titled = true;
	bm_fill(h.x, h.y, h.w, h.h, BOOTMAP_SURFACE);
	bm_text(h.x, h.y, h.w, h.h - 1, nd->name, true, BM_FIT_ANY, false,
		bm_pal(nd->stage, NULL), 0, 0, 0, 0, 0, 0, 0, false);
}

/* The name of a leaf, 1 px inside its interior. */
static void bm_leaf_label(const struct bootmap_node *nd, s32 ix, s32 iy, s32 iw,
			  s32 ih, u32 base, u32 empty, u32 painted, bool all)
{
	if (bms.labels != 0)
		return;
	bm_text(ix + 1, iy + 1, iw - 2, ih - 2, nd->name, bms.cut, bms.fit,
		bms.ink == 0, bms.ink == 1 ? 0xffffff : 0, base, empty,
		ix, iy, iw, ih, painted, all);
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

/* permille() in src/render/style.zig. expected_us is the time of the last
 * boot (the EFI variable), or 0. */
static u32 bm_permille(const struct bootmap_node *nd, u64 now_ns)
{
	u64 fill_us = (u64)bms.fill_ms * 1000;
	u64 span = max_t(u64, nd->expected_us, fill_us);
	u64 start = nd->start_ns / 1000, now = now_ns / 1000, end, at_end;

	if (now < start)
		return 0;
	if (nd->state != BM_DONE || now < nd->end_ns / 1000)
		return bm_active_at(now - start, span);
	end = nd->end_ns / 1000;
	at_end = bm_active_at(end - start, span);
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
		/* The titles appear with the first box of their area. */
		bm_draw_title(nd->parent);
		bm_draw_title(bm.nodes[nd->parent].parent);
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
	       now_ns - nd->start_ns > 1000 * max_t(u64, 2 * (u64)nd->expected_us,
						    (u64)bms.warn_ms * 1000);
	if (late && !nd->late1)
		nd->late0 = nd->late1 = nd->drawn;
	if (p >= 1000) {
		bm_fill(r.x, r.y, w, h, color);
		if (bms.late_keep && nd->late1 > nd->late0)
			bm_fill_range(r.x + o, r.y + o, w - 2 * o, h - 2 * o,
				      nd->late0, nd->late1, BOOTMAP_WARNING);
		bm_leaf_label(nd, r.x + o, r.y + o, w - 2 * o, h - 2 * o, color,
			      bms.empty_dim ? bm_scale(color, 25) : bms.empty, 0, true);
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
	bm_leaf_label(nd, r.x + o, r.y + o, w - 2 * o, h - 2 * o, color,
		      bms.empty_dim ? bm_scale(color, 25) : bms.empty, nd->drawn, false);
	return false;
}

/* The animation thread: it redraws the leaves that are filling. */
static int bm_animate(void *unused)
{
	for (;;) {
		u64 now = local_clock();
		bool all_full = true;
		u32 i;

		if (READ_ONCE(bm.handoff))
			break;
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
	pr_info("bootmap: the kernel stops drawing (%s)\n",
		READ_ONCE(bm.handoff) ? "handoff" : "every box is full");
	return 0;
}

/* The tracepoint probes. They are not __init: a module load after boot
 * also fires initcall_start, and .init.text is free by then. */

static s32 bm_find(initcall_t fn)
{
	u32 k, i;

	if (!bm.live || READ_ONCE(bm.handoff))
		return -1;
	/* Initcalls run in link order, so the next one is almost always at
	 * the cursor. */
	for (k = 0; k < bm.nic; k++) {
		i = (bm.ic_cursor + k) % bm.nic;
		if (bm.ics[i].fn == fn && bm.ics[i].state < BM_DONE)
			return i;
	}
	return -1;
}

/* Copy the state of an initcall to its leaf, and draw the leaf. */
static void bm_sync_leaf(s32 ic, u64 now)
{
	u32 i;

	if (!bm.drawing || !bm.ic_node[ic])
		return;
	i = bm.ic_node[ic];
	bm.nodes[i].state = bm.ics[ic].state;
	bm.nodes[i].start_ns = bm.ics[ic].start_ns;
	bm.nodes[i].end_ns = bm.ics[ic].end_ns;
	bm_update_leaf(i, now);
}

static void bm_on_start(void *data, initcall_t fn)
{
	s32 ic = bm_find(fn);

	if (ic < 0)
		return;
	bm.ic_cursor = ic;
	spin_lock(&bm.lock);
	bm.ics[ic].state = BM_ACTIVE;
	bm.ics[ic].start_ns = local_clock();
	bm_sync_leaf(ic, bm.ics[ic].start_ns);
	spin_unlock(&bm.lock);
}

static void bm_on_finish(void *data, initcall_t fn, int ret)
{
	s32 ic = bm_find(fn);

	if (ic < 0)
		return;
	/* A non-zero return is almost always "no such hardware here", not a
	 * failure (vm/collect-trace.py has the same rule). */
	spin_lock(&bm.lock);
	bm.ics[ic].state = BM_DONE;
	bm.ics[ic].end_ns = local_clock();
	bm_sync_leaf(ic, bm.ics[ic].end_ns);
	spin_unlock(&bm.lock);
	if (--bm.pending == 0) {
		bm.live = false;
		/* The kernel runs the initrd's /init next. Its box fills until
		 * the daemon takes over (handoff). */
		if (bm.initrd_leaf && bm.drawing) {
			spin_lock(&bm.lock);
			bm.nodes[bm.initrd_leaf].state = BM_ACTIVE;
			bm.nodes[bm.initrd_leaf].start_ns = local_clock();
			spin_unlock(&bm.lock);
		}
	}
}

/* Build the tree: root, the stages, and under the kernel stage one group
 * for each level with one leaf for each initcall. */

static u32 bm_last[4];	/* the last node added at each depth */

static void bm_add(u32 *n, const char *name, unsigned char depth,
		   unsigned char stage, u64 weight, unsigned char state)
{
	struct bootmap_node *nd = &bm.nodes[*n];

	if (depth > 0) {
		nd->parent = bm_last[depth - 1];
		bm.nodes[nd->parent].kids++;
	}
	if (depth == 2)
		nd->gidx = bm.nodes[nd->parent].kids - 1;
	if (depth < 4)
		bm_last[depth] = *n;
	strscpy(nd->name, name, sizeof(nd->name));
	nd->ic = -1;
	nd->depth = depth;
	nd->stage = stage;
	nd->state = state;
	bm.depth[*n] = depth;
	bm.weight[*n] = weight;
	(*n)++;
}

static int __init bootmap_init(void);

static const char *const bm_level_names[] = {
	"early", "pure", "core", "postcore", "arch", "subsys", "fs", "rootfs", "device", "late",
};
#define BM_LEVELS ARRAY_SIZE(bm_level_names)

/* The weight of an initcall: leafWeight of its last time, or 1 for all
 * when the kernel has no times (every box the same size). */
static u64 bm_ic_weight(u32 ic)
{
	return bm.have_times ? bootmap_leaf_weight(bm.ics[ic].last_us) : 1;
}

/* Add one leaf for each initcall of a level. */
static void __init bm_add_level(u32 *n, int level, unsigned char st)
{
	u32 ic;

	for (ic = 0; ic < bm.nic; ic++) {
		if (bm.ics[ic].level != level)
			continue;
		bm_add(n, bm.ics[ic].name, 3, st, bm_ic_weight(ic), bm.ics[ic].state);
		bm.nodes[*n - 1].ic = ic;
		bm.nodes[*n - 1].expected_us = bm.have_times ? bm.ics[ic].last_us : 0;
		bm.nodes[*n - 1].start_ns = bm.ics[ic].start_ns;
		bm.nodes[*n - 1].end_ns = bm.ics[ic].end_ns;
		bm.ic_node[ic] = *n - 1;
	}
}

static u64 __init bm_level_weight(int level)
{
	u64 w = 0;
	u32 ic;

	for (ic = 0; ic < bm.nic; ic++)
		if (bm.ics[ic].level == level)
			w += bm_ic_weight(ic);
	return w;
}

static int __init bootmap_build(void)
{
	struct bootmap_scratch s;
	u32 n = 0, total;
	int st, l;
	bool small[BM_LEVELS];
	u64 kw, skw;
	int nsmall;

	bm.header_h = bms.labels == 2 ? 0 : bm_font().h + 1;
	total = 1 + 2 + 1 + 2 + BOOTMAP_STAGES + BM_LEVELS + bm.nic;
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

		if (st == 3 && sw) {
			/* The initrd: one box, as in vm/collect-trace.py. */
			bm_add(&n, "initrd", 1, st, sw, BM_PENDING);
			bm_add(&n, "initramfs", 2, st, 1, BM_PENDING);
			bm.initrd_leaf = n;
			bm_add(&n, "initramfs", 3, st, 1, BM_PENDING);
			continue;
		}
		if (st != BOOTMAP_STAGE_KERNEL) {
			/* The stages before the kernel are complete. */
			if (sw)
				bm_add(&n, bootmap_stage_names[st], 1, st, sw,
				       st < BOOTMAP_STAGE_KERNEL ? BM_DONE : BM_PENDING);
			continue;
		}
		bm_add(&n, "kernel", 1, st, max_t(u64, sw, 1), BM_ACTIVE);
		/* start_kernel ran before any initcall. With times, it has the
		 * weight of its time. Without, weight 8, so it is a box. */
		skw = bm.have_times ? bootmap_leaf_weight(bm.start_kernel_us) : 8;
		bm_add(&n, "start_kernel", 2, st, skw, BM_DONE);
		bm_add(&n, "start_kernel", 3, st, 1, BM_DONE);
		bm.nodes[n - 1].start_ns = 0;
		bm.nodes[n - 1].end_ns = bm.start_kernel_us * 1000;
		/* The small levels go into one "other" group, the last group
		 * (the rule of mergeSmall in src/model/plan.zig). start_kernel
		 * is never small. */
		kw = skw;
		for (l = 0; l < BM_LEVELS; l++)
			kw += bm_level_weight(l);
		nsmall = 0;
		for (l = 0; l < BM_LEVELS; l++) {
			u64 w = bm_level_weight(l);

			small[l] = w && w * 1000 < (u64)bms.other * kw;
			nsmall += small[l];
		}
		if (nsmall < 2)
			memset(small, 0, sizeof(small));
		bm.first_leaf = n;
		for (l = 0; l < BM_LEVELS; l++) {
			u64 w = bm_level_weight(l);

			if (!w || small[l])
				continue;
			bm_add(&n, bm_level_names[l], 2, st, w, BM_PENDING);
			bm_add_level(&n, l, st);
		}
		if (nsmall >= 2) {
			u64 ow = 0;

			for (l = 0; l < BM_LEVELS; l++)
				if (small[l])
					ow += bm_level_weight(l);
			bm.other[n] = 1;
			bm_add(&n, "other", 2, st, ow, BM_PENDING);
			for (l = 0; l < BM_LEVELS; l++)
				if (small[l])
					bm_add_level(&n, l, st);
		}
		bm.end_leaf = n;
	}
	bm.n = n;

	bootmap_layout_tree(bm.depth, bm.weight, bm.other, bm.n,
			    (struct bootmap_rect){ 0, 0, bm.width, bm.height },
			    bms.pads, bm.header_h, bms.order, bm.rects, &s);
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

	/* Version 2: the header has the hash of the initcall names and the
	 * number of initcalls. A line has the initcall (-1: none) and the
	 * expected time, before the name. */
	seq_printf(m, "bootmap 2 %u %u %u %08x %u\n", bm.width, bm.height, bm.n,
		   bm.names_hash, bm.nic);
	for (i = 0; i < bm.n; i++) {
		const struct bootmap_node *nd = &bm.nodes[i];
		const struct bootmap_rect *r = &bm.rects[i];

		seq_printf(m, "%u %u %u %d %d %d %d %u %llu %llu %d %u %s\n", i, nd->depth,
			   nd->stage, r->x, r->y, r->w, r->h, nd->state,
			   nd->start_ns / 1000, nd->end_ns / 1000, nd->ic,
			   nd->expected_us, nd->name);
	}
	return 0;
}

/* The EFI variable with the initcall times of the last boot. bootmapd
 * writes it at the end of each boot (efivarfs). Its data: u32 magic, u32
 * names hash, u32 count, then u32 microseconds per initcall, in link order. */
static const efi_guid_t bootmap_guid =
	EFI_GUID(0x4b2a8f1e, 0x6d3c, 0x4b7a, 0x9e, 0x2f, 0x1c, 0x5d, 0x8a, 0x7b, 0x3e, 0x90);
#define BOOTMAP_TIMES_MAGIC 0x31544d42	/* "BMT1" */

static void __init bm_read_times(void)
{
	static efi_char16_t name[] = L"BootmapTimes";
	unsigned long size = 12 + 4 * (unsigned long)bm.nic;
	u32 attr, *buf, i;
	efi_status_t status;

	if (!efi_enabled(EFI_RUNTIME_SERVICES) ||
	    !efi_rt_services_supported(EFI_RT_SUPPORTED_GET_VARIABLE))
		return;
	buf = kmalloc(size, GFP_KERNEL);
	if (!buf)
		return;
	status = efi.get_variable(name, (efi_guid_t *)&bootmap_guid, &attr, &size, buf);
	if (status == EFI_SUCCESS && size == 12 + 4 * (unsigned long)bm.nic &&
	    buf[0] == BOOTMAP_TIMES_MAGIC && buf[1] == bm.names_hash && buf[2] == bm.nic) {
		for (i = 0; i < bm.nic; i++)
			bm.ics[i].last_us = buf[3 + i];
		bm.have_times = true;
	}
	pr_info("bootmap: initcall times of the last boot: %s\n",
		bm.have_times ? "yes" : status == EFI_NOT_FOUND ? "none" : "not for this kernel");
	kfree(buf);
}

/* early_initcall: record every initcall from now on. The picture comes at
 * postcore (bootmap_draw_init): the EFI calls need efi_rts_wq, which
 * efipostcore_init makes. */
static int __init bootmap_init(void)
{
	initcall_entry_t *starts[] = {
		__initcall_start, __initcall0_start, __initcall1_start, __initcall2_start,
		__initcall3_start, __initcall4_start, __initcall5_start,
		__initcallrootfs_start, __initcall6_start, __initcall7_start, __initcall_end,
	};
	initcall_entry_t *e, *self = NULL;
	u32 ic = 0, l;
	int err;

	if (bm.off)
		return 0;
	err = bootmap_map_fb();
	if (err)
		return 0;
	bm.nic = __initcall_end - __initcall_start;
	bm.ics = kcalloc(bm.nic, sizeof(*bm.ics), GFP_KERNEL);
	bm.ic_node = kcalloc(bm.nic, sizeof(u32), GFP_KERNEL);
	if (!bm.ics || !bm.ic_node)
		return 0;
	for (e = __initcall_start; e < __initcall0_start; e++)
		if (initcall_from_entry(e) == bootmap_init)
			self = e;
	bm.names_hash = 0x811c9dc5;
	for (l = 0; l < BM_LEVELS; l++)
		for (e = starts[l]; e < starts[l + 1]; e++, ic++) {
			struct bm_ic *x = &bm.ics[ic];
			const char *c;

			x->fn = initcall_from_entry(e);
			x->level = l;
			snprintf(x->name, sizeof(x->name), "%ps", x->fn);
			for (c = x->name; ; c++) {
				bm.names_hash ^= (unsigned char)*c;
				bm.names_hash *= 0x01000193;
				if (!*c)
					break;
			}
			/* The early initcalls up to this one ran before the
			 * probes: they are done. */
			if (self && e <= self) {
				x->state = BM_DONE;
				x->start_ns = x->end_ns = local_clock();
			} else {
				bm.pending++;
			}
		}
	bm.start_kernel_us = local_clock() / 1000;
	spin_lock_init(&bm.lock);
	bm.live = true;
	err = register_trace_initcall_start(bm_on_start, NULL);
	if (!err)
		err = register_trace_initcall_finish(bm_on_finish, NULL);
	if (err) {
		pr_err("bootmap: cannot attach to the initcall tracepoints: %d\n", err);
		bm.live = false;
	}
	return 0;
}
early_initcall(bootmap_init);

/* postcore_initcall_sync: after efipostcore_init. Read the times, lay out
 * the picture, and draw the first frame: the initcalls that ran since
 * early_initcall fill at once, and from now on each one fills live. */
static int __init bootmap_draw_init(void)
{
	u32 i;

	if (!bm.live)
		return 0;
	bm_read_times();
	if (bootmap_build()) {
		pr_err("bootmap: no memory for the picture\n");
		return 0;
	}
	spin_lock(&bm.lock);
	bm_fill(0, 0, bm.width, bm.height, BOOTMAP_SURFACE);
	for (i = 1; i < bm.n; i++) {
		struct bootmap_node *nd = &bm.nodes[i];

		if (nd->depth == 1 && nd->state == BM_DONE) {
			struct bootmap_rect r = bm.rects[i];

			bm_fill(r.x, r.y, r.w, r.h, bm_pal(nd->stage, NULL));
		}
	}
	for (i = 1; i < bm.n; i++)
		if (bm.depth[i] == 3)
			bm_update_leaf(i, local_clock());
	if (bms.spawn_plan)
		for (i = 1; i < bm.n; i++)
			bm_draw_title(i);
	bm.drawing = true;
	spin_unlock(&bm.lock);
	pr_info("bootmap: %u boxes, %u initcalls, on %ux%u\n", bm.n, bm.nic,
		bm.width, bm.height);
	kthread_run(bm_animate, NULL, "bootmap");
	return 0;
}
postcore_initcall_sync(bootmap_draw_init);

static int bootmap_open(struct inode *inode, struct file *file)
{
	return single_open(file, bootmap_show, NULL);
}

/* "handoff": the daemon has the screen now. The kernel stops drawing. */
static ssize_t bootmap_write(struct file *file, const char __user *buf,
			     size_t len, loff_t *pos)
{
	char cmd[16];
	size_t n = min(len, sizeof(cmd) - 1);

	if (copy_from_user(cmd, buf, n))
		return -EFAULT;
	cmd[n] = '\0';
	if (!strncmp(cmd, "handoff", 7))
		WRITE_ONCE(bm.handoff, true);
	return len;
}

static const struct proc_ops bootmap_proc_ops = {
	.proc_open = bootmap_open,
	.proc_read = seq_read,
	.proc_lseek = seq_lseek,
	.proc_release = single_release,
	.proc_write = bootmap_write,
};

static int __init bootmap_proc_init(void)
{
	if (bm.n)
		proc_create("bootmap", 0644, NULL, &bootmap_proc_ops);
	return 0;
}
fs_initcall(bootmap_proc_init);
