/* SPDX-License-Identifier: GPL-2.0 */
/*
 * bootmap: the squarified treemap, in C, for the kernel.
 *
 * This is the same algorithm as src/layout/treemap.zig, step for step
 * (REQ-BOOTMAP-001). test/layout-parity.sh compiles this file in
 * userspace and compares its rectangles with the Zig ones. If you change
 * one, change the other.
 */
#ifndef BOOTMAP_LAYOUT_H
#define BOOTMAP_LAYOUT_H

#ifdef __KERNEL__
#include <linux/types.h>
#else
#include <stdint.h>
typedef uint32_t u32;
typedef uint64_t u64;
typedef int32_t s32;
#endif

typedef unsigned __int128 bootmap_u128;

struct bootmap_rect {
	s32 x, y, w, h;
};

#define BOOTMAP_WEIGHT_TOTAL 65536ULL
#define BOOTMAP_MAX_SIDE 8192
#define BOOTMAP_MAX_ITEMS 65536

/* floor(sqrt(d)) + 16. The kernel uses int_sqrt(). */
u64 bootmap_leaf_weight(u64 duration_us);

/* out[i] = max(1, w[i] * BOOTMAP_WEIGHT_TOTAL / sum(w)). */
void bootmap_normalize(const u64 *weights, u32 *out, u32 n);

/* order = 0..n-1, then sorted by weight (largest first), then by index. */
void bootmap_make_order(const u32 *weights, u32 *order, u32 n, int sorted);

/* out[i] = the rectangle of item i in area. */
void bootmap_squarify(struct bootmap_rect area, const u32 *weights,
		      const u32 *order, u32 n, struct bootmap_rect *out);

/* Scratch space for bootmap_layout_tree: each array has n items. */
struct bootmap_scratch {
	u64 *raw;
	u32 *w;
	u32 *order;
	u32 *kids;
	struct bootmap_rect *out;
};

/*
 * Lay out a tree in pre-order: depth[i] and weight[i] for each node, node 0
 * is the root. pads[d] is the inset of the children of a node at depth d
 * (bootmap.pad). The sort rule comes from src/model/plan.zig.
 */
void bootmap_layout_tree(const unsigned char *depth, const u64 *weight, u32 n,
			 struct bootmap_rect area, const unsigned char pads[3],
			 struct bootmap_rect *rects, struct bootmap_scratch *s);

static inline struct bootmap_rect bootmap_inset(struct bootmap_rect r, s32 pad)
{
	if (r.w <= 2 * pad || r.h <= 2 * pad)
		return r;
	r.x += pad;
	r.y += pad;
	r.w -= 2 * pad;
	r.h -= 2 * pad;
	return r;
}

#endif
