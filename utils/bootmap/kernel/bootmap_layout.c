// SPDX-License-Identifier: GPL-2.0
/*
 * bootmap: the squarified treemap, in C. See bootmap_layout.h.
 * Each function has the name of its twin in src/layout/treemap.zig.
 */
#include "bootmap_layout.h"

#ifdef __KERNEL__
#include <linux/math.h>
#include <linux/minmax.h>
#else
#define int_sqrt(x) bootmap_isqrt(x)
#define max(a, b) ((a) > (b) ? (a) : (b))
#define min(a, b) ((a) < (b) ? (a) : (b))

/* floor(sqrt(x)), with integers only, as the kernel's int_sqrt(). */
static u64 bootmap_isqrt(u64 x)
{
	u64 r = 0, bit = 1ULL << 62;

	while (bit > x)
		bit >>= 2;
	while (bit) {
		if (x >= r + bit) {
			x -= r + bit;
			r = (r >> 1) + bit;
		} else {
			r >>= 1;
		}
		bit >>= 2;
	}
	return r;
}
#endif

u64 bootmap_leaf_weight(u64 duration_us)
{
	return (u64)int_sqrt(duration_us) + 16;
}

void bootmap_normalize(const u64 *weights, u32 *out, u32 n)
{
	u64 sum = 0;
	u32 i;

	for (i = 0; i < n; i++)
		sum += weights[i];
	for (i = 0; i < n; i++) {
		u64 v;

		if (sum == 0) {
			out[i] = 1;
			continue;
		}
		v = (u64)(((bootmap_u128)weights[i] * BOOTMAP_WEIGHT_TOTAL) / sum);
		out[i] = (u32)max(v, (u64)1);
	}
}

static int bootmap_before(const u32 *w, u32 a, u32 b)
{
	if (w[a] != w[b])
		return w[a] > w[b];
	return a < b;
}

void bootmap_make_order(const u32 *weights, u32 *order, u32 n, int sorted)
{
	u32 i, j, v;

	for (i = 0; i < n; i++)
		order[i] = i;
	if (!sorted)
		return;
	for (i = 1; i < n; i++) {
		v = order[i];
		for (j = i; j > 0 && bootmap_before(weights, v, order[j - 1]); j--)
			order[j] = order[j - 1];
		order[j] = v;
	}
}

struct bootmap_frac {
	bootmap_u128 num, den;
};

static int bootmap_gt(struct bootmap_frac a, struct bootmap_frac b)
{
	return a.num * b.den > b.num * a.den;
}

static struct bootmap_frac bootmap_worst(u64 s, u64 a, u64 r, u64 sum,
					 u64 mn, u64 mx)
{
	bootmap_u128 s2 = (bootmap_u128)s * s;
	bootmap_u128 sum2 = (bootmap_u128)sum * sum;
	struct bootmap_frac f1 = { s2 * mx * r, sum2 * a };
	struct bootmap_frac f2 = { sum2 * a, s2 * mn * r };

	return bootmap_gt(f1, f2) ? f1 : f2;
}

void bootmap_squarify(struct bootmap_rect area, const u32 *weights,
		      const u32 *order, u32 n, struct bootmap_rect *out)
{
	struct bootmap_rect free = area;
	u64 left = 0;
	u32 i = 0, j, k;

	for (k = 0; k < n; k++)
		left += weights[k];

	while (i < n) {
		int wide;
		u64 shrt, lng, a, sum, mn, mx, t, cum;

		if (free.w <= 0 || free.h <= 0) {
			for (; i < n; i++)
				out[order[i]] = (struct bootmap_rect){ free.x, free.y, 0, 0 };
			return;
		}
		wide = free.w >= free.h;
		shrt = (u64)(wide ? free.h : free.w);
		lng = (u64)(wide ? free.w : free.h);
		a = shrt * lng;

		sum = mn = mx = weights[order[i]];
		for (j = i + 1; j < n; j++) {
			u64 w = weights[order[j]];
			u64 n_sum = sum + w;
			u64 n_min = min(mn, w);
			u64 n_max = max(mx, w);

			if (bootmap_gt(bootmap_worst(shrt, a, left, n_sum, n_min, n_max),
				       bootmap_worst(shrt, a, left, sum, mn, mx)))
				break;
			sum = n_sum;
			mn = n_min;
			mx = n_max;
		}

		t = (j == n) ? lng : (sum * lng) / left;

		cum = 0;
		for (k = i; k < j; k++) {
			u64 s0 = (cum * shrt) / sum, s1;

			cum += weights[order[k]];
			s1 = (cum * shrt) / sum;
			if (wide)
				out[order[k]] = (struct bootmap_rect){
					free.x, free.y + (s32)s0, (s32)t, (s32)(s1 - s0) };
			else
				out[order[k]] = (struct bootmap_rect){
					free.x + (s32)s0, free.y, (s32)(s1 - s0), (s32)t };
		}

		if (wide) {
			free.x += (s32)t;
			free.w -= (s32)t;
		} else {
			free.y += (s32)t;
			free.h -= (s32)t;
		}
		left -= sum;
		i = j;
	}
}

/* The same constants as pads and sort_children in src/model/plan.zig. */
static const s32 bootmap_pads[] = { 6, 3, 2 };
static const int bootmap_sort[] = { 0, 0, 1 };

void bootmap_layout_tree(const unsigned char *depth, const u64 *weight, u32 n,
			 struct bootmap_rect area, struct bootmap_rect *rects,
			 struct bootmap_scratch *s)
{
	u32 i, j, c;

	if (n == 0)
		return;
	rects[0] = area;
	for (i = 0; i < n; i++) {
		unsigned int d = min(depth[i], (unsigned char)2);

		/* The children of i: the nodes after it, one level deeper,
		 * until a node at the depth of i or less. */
		c = 0;
		for (j = i + 1; j < n && depth[j] > depth[i]; j++)
			if (depth[j] == depth[i] + 1)
				s->kids[c++] = j;
		if (c == 0)
			continue;
		for (j = 0; j < c; j++)
			s->raw[j] = weight[s->kids[j]];
		bootmap_normalize(s->raw, s->w, c);
		bootmap_make_order(s->w, s->order, c, bootmap_sort[d]);
		bootmap_squarify(bootmap_inset(rects[i], bootmap_pads[d]), s->w,
				 s->order, c, s->out);
		for (j = 0; j < c; j++)
			rects[s->kids[j]] = s->out[j];
	}
}
