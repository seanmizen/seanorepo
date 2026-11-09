import * as THREE from 'three';

/* The content mask: a small texture, white wherever the page has content.
   The dots and the glyphs fade out wherever it is white. It is built from
   the line boxes of every text node, plus the boxes of the elements below,
   so it fits any page with no selectors. MASK_SCALE is texels per CSS
   pixel. MASK_PAD is the clear space around content, and MASK_SOFT is the
   distance over which that space then fades out, both in CSS pixels.
   Content inside a [data-mask="tight"] element, such as the theme toggle,
   goes on a second mask with TIGHT_PAD and TIGHT_SOFT. Only the glyphs
   fade out there. The dots draw over it, so the face and the core pass
   over the toggle, which sits below this canvas. */
const MASK_SCALE = 0.5;
const MASK_PAD = 16;
const MASK_SOFT = 40;
/* How much the content mask hides: 1 clears content fully, 0 not at all. */
export const MASK_OPACITY = 0.8;
const TIGHT_PAD = 0;
const TIGHT_SOFT = 8;
const TIGHT = '[data-mask="tight"]';
const MASK_ELEMENTS = 'img, svg, video, input, button, select, textarea';
/* The computed background of an element that paints none. */
const NO_BACKGROUND = 'rgba(0, 0, 0, 0)';

/* The content masks of a canvas, and drawMask, which redraws both from the
   page. Each mask is a texture uniform: { value }. */
export const contentMasks = (canvas: HTMLCanvasElement) => {
  // The content masks: one canvas and one texture each. A resize makes a
  // new texture: a texture keeps the size of its first upload.
  const makeMask = () => {
    const mask = document.createElement('canvas');
    mask.width = 1;
    mask.height = 1;
    const make = () => {
      const texture = new THREE.CanvasTexture(mask);
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    };
    const texture = { value: make() };
    const ctx = mask.getContext('2d');
    const start = (w: number, h: number) => {
      if (!ctx) return;
      if (mask.width !== w || mask.height !== h) {
        mask.width = w;
        mask.height = h;
        texture.value.dispose();
        texture.value = make();
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#fff';
      // Only the blur of each box goes on the canvas: the box itself is
      // drawn one canvas width to the left, off the canvas. The blur is
      // whole soft / 2 inside the box edge, and gone soft / 2 outside it,
      // so each box grows by pad + soft / 2.
      ctx.shadowOffsetX = w;
    };
    return { ctx, texture, start };
  };
  const contentMask = makeMask();
  const tightMask = makeMask();
  const range = document.createRange();
  const drawMask = () => {
    const bounds = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(bounds.width * MASK_SCALE));
    const h = Math.max(1, Math.round(bounds.height * MASK_SCALE));
    contentMask.start(w, h);
    tightMask.start(w, h);
    type Box = { left: number; top: number; right: number; bottom: number };
    const fill = ({ left, top, right, bottom }: Box, tight: Element | null) => {
      const ctx = (tight ? tightMask : contentMask).ctx;
      if (!ctx || right <= left || bottom <= top) return;
      const pad = tight ? TIGHT_PAD : MASK_PAD;
      const soft = tight ? TIGHT_SOFT : MASK_SOFT;
      const grow = pad + soft / 2;
      ctx.shadowBlur = (soft / 2) * MASK_SCALE;
      ctx.fillRect(
        (left - bounds.left - grow) * MASK_SCALE - w,
        (top - bounds.top - grow) * MASK_SCALE,
        (right - left + 2 * grow) * MASK_SCALE,
        (bottom - top + 2 * grow) * MASK_SCALE,
      );
    };
    // One box a line of text, so a paragraph clears its own shape and
    // not the whole width of its column. A parent that clips its text,
    // such as screen reader text, clips the box too.
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/\S/.test(node.nodeValue ?? '')) continue;
      const parent = node.parentElement;
      const clip =
        parent && getComputedStyle(parent).overflow !== 'visible'
          ? parent.getBoundingClientRect()
          : null;
      const tight = parent?.closest(TIGHT) ?? null;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        fill(
          clip
            ? {
                left: Math.max(box.left, clip.left),
                top: Math.max(box.top, clip.top),
                right: Math.min(box.right, clip.right),
                bottom: Math.min(box.bottom, clip.bottom),
              }
            : box,
          tight,
        );
      }
    }
    // One whole box for each control, icon and image, and for anything
    // that paints its own background, such as a code block or a swatch.
    for (const el of document.body.getElementsByTagName('*')) {
      if (
        el.matches(MASK_ELEMENTS) ||
        getComputedStyle(el).backgroundColor !== NO_BACKGROUND
      ) {
        fill(el.getBoundingClientRect(), el.closest(TIGHT));
      }
    }
    contentMask.texture.value.needsUpdate = true;
    tightMask.texture.value.needsUpdate = true;
  };
  return { contentMask, tightMask, drawMask };
};
