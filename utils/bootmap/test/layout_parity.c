/*
 * Read the plan text from `bootmap plan` on stdin. Lay it out with
 * kernel/bootmap_layout.c. Print one rectangle per node, as `bootmap rects`
 * does. test/layout-parity.sh compares the two outputs.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../kernel/bootmap_layout.h"

int main(void)
{
	char magic[32];
	int version, w, h;
	unsigned int n, i;

	if (scanf("%31s %d %d %d %u", magic, &version, &w, &h, &n) != 5 ||
	    strcmp(magic, "bootmap-plan") != 0 || version != 1) {
		fprintf(stderr, "layout_parity: stdin is not bootmap-plan 1\n");
		return 2;
	}
	unsigned char *depth = calloc(n, 1);
	u64 *weight = calloc(n, sizeof(*weight));
	struct bootmap_rect *rects = calloc(n, sizeof(*rects));
	struct bootmap_scratch s = {
		.raw = calloc(n, sizeof(u64)),
		.w = calloc(n, sizeof(u32)),
		.order = calloc(n, sizeof(u32)),
		.kids = calloc(n, sizeof(u32)),
		.out = calloc(n, sizeof(struct bootmap_rect)),
	};
	for (i = 0; i < n; i++) {
		unsigned int d;
		unsigned long long wt;
		char name[512];

		if (scanf("%u %llu %511s", &d, &wt, name) != 3) {
			fprintf(stderr, "layout_parity: bad node line %u\n", i);
			return 2;
		}
		depth[i] = (unsigned char)d;
		weight[i] = wt;
	}
	bootmap_layout_tree(depth, weight, n, (struct bootmap_rect){ 0, 0, w, h }, rects, &s);
	for (i = 0; i < n; i++)
		printf("%d %d %d %d\n", rects[i].x, rects[i].y, rects[i].w, rects[i].h);
	return 0;
}
