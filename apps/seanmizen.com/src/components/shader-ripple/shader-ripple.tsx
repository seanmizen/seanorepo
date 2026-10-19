import type { FC, Ref, RefObject } from 'react';
import { useContext, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three-stdlib';
import { ThemeContext } from '@/providers';
import type { EatSettings } from './eat';
import glyphLightFrag from './frag-glyph-light.glsl';
import glyphFrag from './frag-glyphs.glsl';
import frag from './frag-stippling.glsl';
import offsetSim from './frag-stippling-offset.glsl';
import posSim from './frag-stippling-pos.glsl';
import velSim from './frag-stippling-vel.glsl';
import type { HireSettings } from './hire';
import { OUTER_LOOK } from './hire';
import bgImage from './IMG_4011_crop2.jpeg';
import type { GlyphSet, RippleParams } from './params';
import { GLYPH_SETS, MAX_TAPS } from './params';
import particleTex from './particle2.png';
import ripple from './ripple.glsl';
import vert from './vert-stippling.glsl';

/* Anything a click can be aimed at, plus anything marked as UI. A click on
   one of these was meant for it, not for the background behind it. */
const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, label, [tabindex]:not([tabindex="-1"]), [data-no-ripple]';

/* Params that map straight onto a uniform of the same name. */
const RIPPLE_KEYS = [
  'reach',
  'slow',
  'fade',
  'frontWidth',
  'widthGrow',
  'wave',
  'crest',
  'wobble',
  'lobes',
  'warp',
  'warpScale',
  'warpSpeed',
  'banding',
  'nebula',
  'cloudLevel',
  'cloudSoft',
  'cloudGain',
  'nebulaScale',
  'nebulaSpeed',
  'glowFade',
  'trail',
  'trailLen',
] as const;
const SIM_KEYS = [
  'push',
  'repel',
  'chargeBase',
  'chargeGain',
  'spring',
  'springDamp',
] as const;

/* The camera looks straight down the z axis with this vertical field of
   view. At a canvas height of REFERENCE_PX it sits at CAMERA_Z; a taller
   canvas moves it back in step, so the portrait keeps its size on screen
   and a bigger canvas only shows more of the plane around it. The
   particles live on the z = 0 plane, so a click maps onto it linearly. */
const CAMERA_Z = 20;
const FOV = 75;
const REFERENCE_PX = 500;
const TAN_HALF_FOV = Math.tan(((FOV / 2) * Math.PI) / 180);

/* Glyph atlas layout: ATLAS_COLS glyphs a row, each in an ATLAS_CELL
   pixel square. */
const ATLAS_COLS = 16;
const ATLAS_CELL = 64;

/* Draw a glyph set (or the message) into a texture, white on clear, left
   to right and top to bottom. */
const makeAtlas = (set: GlyphSet, message: string) => {
  // The message set draws the message itself, in order, spaces and all;
  // a space draws nothing, so it shows as a gap.
  const chars = [...(set === 'message' ? message || ' ' : GLYPH_SETS[set])];
  const rows = Math.ceil(chars.length / ATLAS_COLS);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * ATLAS_CELL;
  canvas.height = rows * ATLAS_CELL;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${ATLAS_CELL * 0.8}px ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace`;
    chars.forEach((ch, i) => {
      const x = (i % ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2;
      const y = Math.floor(i / ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2;
      ctx.fillText(ch, x, y);
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, count: chars.length, rows };
};

type ShaderRippleHandle = {
  /* Fire `n` clicks at random points over the portrait. `heart` forces
     the heart shape; otherwise each click is a heart by `heartChance`. */
  burst: (n: number, heart?: boolean) => void;
  /* Forget every ripple in flight. */
  clear: () => void;
};

type ShaderRippleProps = {
  params: RippleParams;
  /* Particles per side of the sim texture. Changing it rebuilds the sim. */
  simSize?: number;
  /* Canvas size in CSS pixels. Changing it rebuilds the sim. */
  size?: number;
  onFps?: (fps: number) => void;
  /* Turns on the hire field: the message as text around the edges of the
     view, faded in while `reveal` is true. */
  hire?: HireSettings;
  reveal?: boolean;
  /* While true, the face is thrown: it flies to `landing` and shrinks into
     a small pulsing core on the way. When false, it flies back and opens
     out into the face again. */
  thrown?: boolean;
  /* The core lands in the middle of this element. Without it, or while it
     has no size, the core lands near the bottom middle of the view. */
  landing?: RefObject<HTMLElement | null>;
  /* Venom: once the core has landed, it reaches for the cursor and eats
     it. Without it, the core leaves the cursor alone. */
  eat?: EatSettings;
  /* Keeps every dot and glyph off the page's content: its text, icons and
     controls. See the content mask below. */
  clearOfContent?: boolean;
  /* Draws the portrait at this scale; the view around it is unchanged. */
  portraitScale?: number;
  ref?: Ref<ShaderRippleHandle>;
};

/* The throw: seconds from the face in the middle to the core landed (the
   way back takes the same), how far into it the face has become the core,
   and how far the core rises before it falls, in CSS pixels. */
const THROW_TIME = 0.35;
const CORE_BY = 0.25;
const THROW_ARC = 90;
/* With no landing element, the core lands this far above the bottom middle
   of the view, in CSS pixels. */
const LAND_FALLBACK = 40;

/* Set on the root element while the core has eaten the cursor. index.css
   hides the cursor for it. */
const EATEN_CLASS = 'cursor-eaten';

/* The core: its radius in world units (the face is about 8 across), how
   much it pulses either way, and how far its middle wanders. */
const CORE_RADIUS = 0.15;
const CORE_PULSE = 0.25;
const CORE_DRIFT = 0.07;
/* How fast the pulse and the drift wander, in rough cycles a second. */
const CORE_PACE = 0.7;

/* Smooth noise from -1 to 1: two layers of value noise, so it never
   settles into a rhythm. Each `seed` gives its own stream. */
const wander = (t: number, seed: number) => {
  const layer = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const at = (n: number) => {
      const h = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
      return 2 * (h - Math.floor(h)) - 1;
    };
    return at(i) + (at(i + 1) - at(i)) * f * f * (3 - 2 * f);
  };
  return 0.65 * layer(t) + 0.35 * layer(2.3 * t + 17);
};

/* Rougher noise from about -1 to 1: wander() with a faster wander() on
   top, so it jerks as well as drifts. */
const jitter = (t: number, seed: number) =>
  0.6 * wander(t, seed) + 0.4 * wander(3.7 * t, seed + 50);

/* Venom: the most tendrils the shader draws. eat.ts holds the tendrils
   slider to this. */
const TENDRILS_MAX = 8;
/* A tendril strikes once the cursor is this share of `reach` inside it, and
   is at most this share of `reach` long. A cursor near the edge of reach is
   just out of its grasp. */
const STRIKE_IN = 0.15;
const TENDRIL_LENGTH = 0.8;
/* A twitch kicks a tendril's tip about this share of its length off its
   course. */
const TWITCH_KICK = 0.4;
/* Venom's jump. Once the pointer has stayed inside `jump` for JUMP_DELAY
   seconds, the whole core springs onto the cursor's middle, CURSOR_MIDDLE
   CSS pixels from its hot spot, with damping ratio MASS_DAMPING. On the
   way it opens into a ring around the cursor in WRAP_OPEN seconds. A jump
   commits: it gives up only on a pointer that leaves reach.

   The swallow: once the cursor is SHUT_INSIDE of the way into the ring,
   the core stays on the cursor and the ring snaps shut in WRAP_CLOSE
   seconds, fastest at first. The shader shuts the back of the ring first
   and the far side last. The cursor is gone once the ring is down to
   HIDE_AT, while the far side still wraps it.

   The hold: once the ring is shut, a spring pulls the core home,
   HOLD_SPRING times as fast as the jump, with damping ratio HOLD_DAMPING.
   The pointer's movement drags the core: at `tug` 1, the core's speed
   closes on the pointer's speed at DRAG_RATE a second. Where the pointer
   is does not move the core, only how it moves. Once the pointer is more
   than `release` from the core, the core lets the cursor go. A cursor it
   let go must leave `jump` before the core can catch it again. */
const CURSOR_MIDDLE = { x: 5, y: 9 };
const JUMP_DELAY = 0.12;
const WRAP_OPEN = 0.1;
const WRAP_CLOSE = 0.15;
const SHUT_INSIDE = 0.6;
const HIDE_AT = 0.3;
const MASS_DAMPING = 0.5;
const HOLD_SPRING = 0.5;
const HOLD_DAMPING = 0.5;
const DRAG_RATE = 40;
/* The pointer speed the drag can take, in CSS pixels a second. A pointer
   that jumps, such as on a touchpad, must not throw the core. */
const DRAG_MAX_SPEED = 3000;
/* The core's shape bends with its speed, fully from this speed on, in CSS
   pixels a second. */
const SWAY_SPEED = 300;
/* The core's tail: TAIL_LINKS points, each on a spring behind the one
   before it, the first behind the core. The springs swing TAIL_SPRING
   times a second, with damping ratio TAIL_DAMPING. The core's dots spread
   back along the tail, so the core trails behind where it goes and swings
   on past where it stops. vert-stippling.glsl holds u_tail to this
   size. */
const TAIL_LINKS = 4;
const TAIL_SPRING = 12;
const TAIL_DAMPING = 0.6;

type Point = { x: number; y: number };

/* One step of a damped spring that pulls `p` toward `to`. `hz` is how fast
   it swings. `damping` is its damping ratio: 1 does not overshoot, and
   lower bounces more. A flow can also drag it: its speed closes on
   `flowV` at `drag` a second. */
const springStep = (
  p: Point,
  v: Point,
  to: Point,
  hz: number,
  damping: number,
  dt: number,
  drag = 0,
  flowV: Point = { x: 0, y: 0 },
) => {
  const w = 2 * Math.PI * hz;
  v.x +=
    (w * w * (to.x - p.x) - 2 * damping * w * v.x + drag * (flowV.x - v.x)) *
    dt;
  v.y +=
    (w * w * (to.y - p.y) - 2 * damping * w * v.y + drag * (flowV.y - v.y)) *
    dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
};

/* The content mask: a small texture, white wherever the page has content.
   The dots and the glyphs fade out wherever it is white. It is built from
   the line boxes of every text node, plus the boxes of the elements below,
   so it fits any page with no selectors. MASK_SCALE is texels per CSS
   pixel. MASK_PAD is the clear space around content, and MASK_SOFT is the
   distance over which that space then fades out, both in CSS pixels.
   Content inside a [data-mask="tight"] element, such as the theme toggle
   beside the thrown face, uses TIGHT_PAD and TIGHT_SOFT. */
const MASK_SCALE = 0.5;
const MASK_PAD = 16;
const MASK_SOFT = 40;
const TIGHT_PAD = 0;
const TIGHT_SOFT = 8;
const TIGHT = '[data-mask="tight"]';
const MASK_ELEMENTS = 'img, svg, video, input, button, select, textarea';
/* The computed background of an element that paints none. */
const NO_BACKGROUND = 'rgba(0, 0, 0, 0)';

const easeInCubic = (x: number) => x ** 3;
const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

const seed = (pos: Float32Array, vel: Float32Array) => {
  const n = pos.length / 4;
  for (let i = 0; i < n; i++) {
    const d = 4 * Math.sqrt(Math.random());
    const a = 2 * Math.PI * Math.random();
    const idx = 4 * i;

    pos[idx] = d * Math.cos(a);
    pos[idx + 1] = d * Math.sin(a);
    pos[idx + 2] = 0;
    pos[idx + 3] = 1;

    vel[idx] = vel[idx + 1] = vel[idx + 2] = 0;
    vel[idx + 3] = 1;
  }
};

const uniformName = (key: string) => `u_${key}`;

const ShaderRipple: FC<ShaderRippleProps> = ({
  params,
  simSize = 64,
  size = 500,
  onFps,
  hire,
  reveal = false,
  thrown = false,
  landing,
  eat,
  clearOfContent = false,
  portraitScale = 1,
  ref,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const { theme } = useContext(ThemeContext);

  // Read every frame by the render loop, so slider changes land without a
  // rebuild.
  const live = useRef({
    params,
    theme,
    onFps,
    hire,
    reveal,
    thrown,
    landing,
    eat,
    clearOfContent,
    portraitScale,
  });
  live.current = {
    params,
    theme,
    onFps,
    hire,
    reveal,
    thrown,
    landing,
    eat,
    clearOfContent,
    portraitScale,
  };

  const api = useRef<ShaderRippleHandle>({ burst: () => {}, clear: () => {} });
  useImperativeHandle(ref, () => ({
    burst: (n, heart) => api.current.burst(n, heart),
    clear: () => api.current.clear(),
  }));

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;

    mount.replaceChildren();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5_000);

    // The canvas size in CSS pixels, half the visible plane in world units,
    // how far the camera has moved back from CAMERA_Z for the canvas size,
    // and the portrait scale it was set for.
    const view = { w: 0, h: 0, halfX: 0, halfY: 0, zoom: 1, scale: 1 };
    const resize = (w: number, h: number) => {
      if (w < 1 || h < 1) return;
      renderer.setSize(w, h);
      view.w = w;
      view.h = h;
      view.zoom = h / REFERENCE_PX;
      view.scale = live.current.portraitScale;
      camera.aspect = w / h;
      // Moving back by the portrait scale too shrinks the portrait and shows
      // more plane; point sizes follow the camera, so the dots shrink with it.
      camera.position.z = (CAMERA_Z * view.zoom) / view.scale;
      camera.updateProjectionMatrix();
      view.halfY = camera.position.z * TAN_HALF_FOV;
      view.halfX = view.halfY * camera.aspect;
    };
    let observer: ResizeObserver | undefined;
    if (size === 0) {
      // The site pads every element; a canvas that fills its parent must
      // not, or it overflows by that padding.
      renderer.domElement.style.padding = '0';
      renderer.domElement.style.display = 'block';
      resize(mount.clientWidth, mount.clientHeight);
      observer = new ResizeObserver(() =>
        resize(mount.clientWidth, mount.clientHeight),
      );
      observer.observe(mount);
    } else {
      resize(size, size);
    }

    const gpuSim = new GPUComputationRenderer(simSize, simSize, renderer);

    const posTex = gpuSim.createTexture();
    const velTex = gpuSim.createTexture();
    if (posTex.image.data && velTex.image.data) {
      seed(
        posTex.image.data as Float32Array,
        velTex.image.data as Float32Array,
      );
    }

    // The ripple chunk is prepended to the shaders that use it. The GLSL
    // loader trims trailing newlines, so join with one or the next file's
    // first #define lands on the chunk's last line.
    const posVar = gpuSim.addVariable('u_positionTexture', posSim, posTex);
    const velVar = gpuSim.addVariable(
      'u_velocityTexture',
      `${ripple}\n${velSim}`,
      velTex,
    );
    // The offset sim starts at zero: every particle at home.
    const offVar = gpuSim.addVariable(
      'u_offsetTexture',
      `${ripple}\n${offsetSim}`,
      gpuSim.createTexture(),
    );
    gpuSim.setVariableDependencies(posVar, [posVar, velVar]);
    gpuSim.setVariableDependencies(velVar, [posVar, velVar]);
    gpuSim.setVariableDependencies(offVar, [posVar, offVar]);

    const shared = {
      u_dt: { value: params.dt },
      u_nActiveParticles: { value: 10 },
    };

    // One set of ripple uniforms, shared by reference between the velocity
    // sim (the push) and the particle material (the tint).
    const rippleUniforms: Record<string, THREE.IUniform> = {
      u_lookNear: { value: 1e4 },
      u_lookFar: { value: 1e4 + 1 },
      u_outerWarp: { value: 0 },
      u_outerWobble: { value: 0 },
      u_outerBanding: { value: 0 },
      u_outerNebula: { value: 0 },
      u_now: { value: 0 },
      u_tapCount: { value: 0 },
      u_taps: {
        value: Array.from({ length: MAX_TAPS }, () => new THREE.Vector4()),
      },
    };
    for (const key of RIPPLE_KEYS) {
      rippleUniforms[uniformName(key)] = { value: params[key] };
    }
    // The face's passes skip ripples that started before this time on the
    // ripple clock. It moves on when the face comes home, so ripples from
    // /projects leave the face alone. The text field sees every ripple.
    const faceTaps = { u_tapsFrom: { value: -1 } };

    // The content mask. A resize makes a new texture: a texture keeps the
    // size of its first upload.
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 1;
    maskCanvas.height = 1;
    const maskCtx = maskCanvas.getContext('2d');
    const makeMaskTexture = () => {
      const texture = new THREE.CanvasTexture(maskCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    };
    const contentMask = { value: makeMaskTexture() };
    const range = document.createRange();
    const drawMask = () => {
      if (!maskCtx) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const w = Math.max(1, Math.round(bounds.width * MASK_SCALE));
      const h = Math.max(1, Math.round(bounds.height * MASK_SCALE));
      if (maskCanvas.width !== w || maskCanvas.height !== h) {
        maskCanvas.width = w;
        maskCanvas.height = h;
        contentMask.value.dispose();
        contentMask.value = makeMaskTexture();
      }
      maskCtx.clearRect(0, 0, w, h);
      maskCtx.fillStyle = '#fff';
      maskCtx.shadowColor = '#fff';
      // Only the blur of each box goes on the canvas: the box itself is
      // drawn one canvas width to the left, off the canvas. The blur is
      // whole soft / 2 inside the box edge, and gone soft / 2 outside it,
      // so each box grows by pad + soft / 2.
      maskCtx.shadowOffsetX = w;
      type Box = { left: number; top: number; right: number; bottom: number };
      const fill = (
        { left, top, right, bottom }: Box,
        tight: Element | null,
      ) => {
        if (right <= left || bottom <= top) return;
        const pad = tight ? TIGHT_PAD : MASK_PAD;
        const soft = tight ? TIGHT_SOFT : MASK_SOFT;
        const grow = pad + soft / 2;
        maskCtx.shadowBlur = (soft / 2) * MASK_SCALE;
        maskCtx.fillRect(
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
      contentMask.value.needsUpdate = true;
    };

    const simUniforms: Record<string, THREE.IUniform> = {};
    for (const key of SIM_KEYS) {
      simUniforms[uniformName(key)] = { value: params[key] };
    }
    simUniforms.u_springBack = { value: params.springBack ? 1 : 0 };

    const bgTexture = { value: new THREE.TextureLoader().load(bgImage) };
    const textureOffset = { value: new THREE.Vector2(12, 12) };

    Object.assign(posVar.material.uniforms, shared);
    Object.assign(velVar.material.uniforms, {
      ...shared,
      ...rippleUniforms,
      ...faceTaps,
      ...simUniforms,
      u_bgTexture: bgTexture,
      u_textureOffset: textureOffset,
    });
    Object.assign(offVar.material.uniforms, {
      ...rippleUniforms,
      ...faceTaps,
      ...simUniforms,
    });

    if (gpuSim.init()) throw new Error('GPUComputation init failed');

    const n = simSize * simSize;
    const geometry = new THREE.BufferGeometry();
    const indices = new Float32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    geometry.setAttribute('a_index', new THREE.BufferAttribute(indices, 1));
    const random = new Float32Array(4 * n);
    for (let i = 0; i < random.length; i++) random[i] = Math.random();
    geometry.setAttribute('a_random', new THREE.BufferAttribute(random, 4));
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(3 * n), 3),
    );

    const uniforms = {
      ...rippleUniforms,
      ...faceTaps,
      u_contentMask: contentMask,
      u_width: { value: simSize },
      u_height: { value: simSize },
      u_particleSize: { value: 0 },
      u_nActiveParticles: { value: 1 },
      u_positionTexture: { value: null as THREE.Texture | null },
      u_offsetTexture: { value: null as THREE.Texture | null },
      u_bgTexture: bgTexture,
      u_textureOffset: textureOffset,
      u_texture: { value: new THREE.TextureLoader().load(particleTex) },
      u_color: { value: new THREE.Color() },
      u_accent: { value: new THREE.Color() },
      u_tintEdge: { value: new THREE.Vector2() },
      u_swell: { value: 0 },
      u_collapse: { value: 0 },
      u_coreSize: { value: CORE_RADIUS },
      u_coreAt: { value: new THREE.Vector2() },
      u_wrap: { value: 0 },
      u_wrapRadius: { value: 0 },
      u_massV: { value: new THREE.Vector2() },
      u_sway: { value: 0 },
      u_jumpDir: { value: new THREE.Vector2() },
      u_tail: {
        value: Array.from({ length: TAIL_LINKS }, () => new THREE.Vector2()),
      },
      u_throwAt: { value: new THREE.Vector2() },
      u_tendril: {
        value: Array.from({ length: TENDRILS_MAX }, () => new THREE.Vector4()),
      },
      u_grab: { value: 0 },
      u_tendrils: { value: 1 },
      u_tendrilShare: { value: 0 },
      u_strand: { value: 0 },
      u_wiggle: { value: 0 },
      u_rest: { value: 1 },
      u_afterglow: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `${ripple}\n${vert}`,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
    });

    scene.add(new THREE.Points(geometry, material));

    // The glyph background. A light pass works out each cell's light into a
    // small texture, one texel a cell; the glyph pass then draws every cell
    // from it. Both are one triangle that covers the target.
    const fullScreen = new THREE.BufferGeometry();
    fullScreen.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    );
    const passThrough =
      'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

    const lightTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    const lightUniforms = {
      ...rippleUniforms,
      u_tapsFrom: { value: -1 },
      u_contentMask: contentMask,
      u_viewPx: { value: new THREE.Vector2() },
      u_cellPx: { value: new THREE.Vector2() },
      u_halfExtent: { value: new THREE.Vector2() },
      u_tintEdge: uniforms.u_tintEdge,
      u_afterglow: { value: 0 },
      u_gridIdle: { value: 0 },
      u_calm: { value: 0 },
      u_hire: { value: 0 },
      u_textStrength: { value: 0 },
      u_textDrift: { value: 0 },
      u_revealFade: { value: 0 },
    };
    const lightMaterial = new THREE.ShaderMaterial({
      uniforms: lightUniforms,
      vertexShader: passThrough,
      fragmentShader: `${ripple}\n${glyphLightFrag}`,
      depthTest: false,
      depthWrite: false,
    });
    const lightScene = new THREE.Scene();
    const lightMesh = new THREE.Mesh(fullScreen, lightMaterial);
    lightMesh.frustumCulled = false;
    lightScene.add(lightMesh);

    // The atlas is redrawn when the set or the message changes.
    let atlasFor = '';
    let atlas = makeAtlas('ascii', '');
    const gridUniforms = {
      ...rippleUniforms,
      u_light: { value: lightTarget.texture },
      u_gridDims: { value: new THREE.Vector2(1, 1) },
      u_atlas: { value: atlas.texture },
      u_atlasGrid: { value: new THREE.Vector2(ATLAS_COLS, atlas.rows) },
      u_glyphCount: { value: atlas.count },
      u_cellPx: lightUniforms.u_cellPx,
      u_dpr: { value: renderer.getPixelRatio() },
      u_fill: { value: 1 },
      u_gridAlpha: { value: 1 },
      u_flicker: { value: 0 },
      u_spin: { value: 0 },
      u_message: { value: 0 },
      u_rowShift: { value: 0 },
      u_color: uniforms.u_color,
      u_accent: uniforms.u_accent,
    };
    const gridMaterial = new THREE.ShaderMaterial({
      uniforms: gridUniforms,
      vertexShader: passThrough,
      fragmentShader: `${ripple}\n${glyphFrag}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const grid = new THREE.Mesh(fullScreen, gridMaterial);
    grid.frustumCulled = false;
    grid.renderOrder = -1;
    scene.add(grid);

    // The reveal: `r` runs from 0 (no text) to 1 (the text at full
    // strength). A change of `reveal` eases it from where it is to the
    // other end.
    const revealState = {
      target: false,
      from: 0,
      r: 0,
      since: 0,
      duration: 1,
    };

    // The throw: `at` runs at a steady rate from 0 (the face in the middle)
    // to 1 (the core landed) while `thrown` is true, and back to 0 while it
    // is false. Everything the throw draws depends on `at` alone, so a turn
    // at any point plays the throw backward from there.
    // `thrown` is the value from the last frame, to see the face turn for
    // home.
    const throwState = { at: 0, thrown: false };

    // Where the core lands, in CSS pixels from the canvas's top left. It
    // keeps the last place it saw, so the way back still has a start once
    // the landing element is gone.
    const land = { x: 0, y: 0, seen: false };

    // Venom: the core rests, jumps at the cursor, swallows it, or holds
    // it. `since` is when it took that mode, `nearSince` is when the
    // pointer came inside `jump` (-1: it is outside), and `gulpAt` is when
    // the core last ate, all in real seconds. `armed` is false from when
    // the core lets a cursor go until that cursor leaves `jump`. `jumpDir`
    // is the way it last jumped, a unit vector (y down).
    type EatMode = 'rest' | 'jump' | 'swallow' | 'hold';
    const eatState = {
      mode: 'rest' as EatMode,
      since: 0,
      nearSince: -1,
      gulpAt: -1e9,
      armed: true,
      jumpDir: { x: 0, y: 0 },
    };
    // The whole core and its tail, and their speeds, in CSS pixels from
    // where the core rests (y down).
    const mass = { at: { x: 0, y: 0 }, v: { x: 0, y: 0 } };
    const tail = Array.from({ length: TAIL_LINKS }, () => ({
      at: { x: 0, y: 0 },
      v: { x: 0, y: 0 },
    }));
    // Where the pointer was last frame, in the same space, for its speed.
    const lastPointer = { x: 0, y: 0 };
    // Each tendril's tip and bend, and their speeds, in CSS pixels from
    // the core's middle (y down). `pace` and `seed` make each tendril move
    // in its own way.
    const tendrils = Array.from({ length: TENDRILS_MAX }, () => ({
      tip: { x: 0, y: 0 },
      tipV: { x: 0, y: 0 },
      bend: { x: 0, y: 0 },
      bendV: { x: 0, y: 0 },
      pace: 0.75 + 0.5 * Math.random(),
      seed: 1000 * Math.random(),
    }));

    // The cursor, in client pixels. Touch has no cursor to eat.
    const pointer = { x: 0, y: 0, in: false };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.in = true;
    };
    const onPointerLeave = () => {
      pointer.in = false;
    };
    window.addEventListener('pointermove', onPointerMove);
    document.documentElement.addEventListener('pointerleave', onPointerLeave);

    let nTaps = 0;
    let now = 0;

    const addTap = (x: number, y: number, heart?: boolean) => {
      const slots = Math.max(
        1,
        Math.min(MAX_TAPS, live.current.params.maxTaps),
      );
      const taps = rippleUniforms.u_taps.value as THREE.Vector4[];
      const { strength, heartChance } = live.current.params;
      // A negative strength tells the shader to run a heart, not a ring.
      const isHeart = heart ?? Math.random() < heartChance;
      taps[nTaps % slots].set(x, y, now, isHeart ? -strength : strength);
      nTaps++;
      rippleUniforms.u_tapCount.value = Math.min(nTaps, slots);
    };

    api.current = {
      burst: (count, heart) => {
        for (let i = 0; i < count; i++) {
          const a = 2 * Math.PI * Math.random();
          const d = 8 * Math.sqrt(Math.random());
          addTap(d * Math.cos(a), d * Math.sin(a), heart);
        }
      },
      clear: () => {
        nTaps = 0;
        rippleUniforms.u_tapCount.value = 0;
      },
    };

    const startRipple = (e: MouseEvent) => {
      // composedPath() is captured at dispatch, so it still holds the real
      // ancestor chain even if React re-renders the target away. Capture
      // phase runs this before that re-render can happen.
      const clicked = e
        .composedPath()
        .some((node) => node instanceof Element && node.matches(INTERACTIVE));
      if (clicked) return;

      // Map the click onto the particles' plane. The camera looks straight
      // at it, so this is a straight scale from the canvas centre. Clicks
      // outside the canvas land off to the side.
      const bounds = renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
      const y = 1 - ((e.clientY - bounds.top) / bounds.height) * 2;
      addTap(x * view.halfX, y * view.halfY);
    };
    window.addEventListener('click', startRipple, true);

    let frames = 0;
    let last = performance.now();
    let fpsFrames = 0;
    let fpsSince = last;
    let raf = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = performance.now();
      const p = live.current.params;

      // The ripples keep their own clock, so time scale slows them without
      // touching the sim step. Clamp the gap so a background tab does not
      // jump every ripple to its end.
      const gap = Math.min(t - last, 100) / 1000;
      now += gap * p.timeScale;
      last = t;
      rippleUniforms.u_now.value = now;

      for (const key of RIPPLE_KEYS) {
        rippleUniforms[uniformName(key)].value = p[key];
      }
      for (const key of SIM_KEYS) {
        simUniforms[uniformName(key)].value = p[key];
      }
      simUniforms.u_springBack.value = p.springBack ? 1 : 0;
      shared.u_dt.value = p.dt;
      // Point size shrinks as the camera moves back, so grow it to match.
      uniforms.u_particleSize.value =
        p.particleSize * Math.min(devicePixelRatio, 2) * view.zoom;
      uniforms.u_swell.value = p.swell;
      uniforms.u_rest.value = p.rest;
      uniforms.u_afterglow.value = p.afterglow;
      uniforms.u_tintEdge.value.set(
        p.tintLo,
        Math.max(p.tintHi, p.tintLo + 0.001),
      );

      const dark = live.current.theme !== 'light';
      uniforms.u_color.value.set(dark ? p.darkInk : p.lightInk);
      uniforms.u_accent.value.set(dark ? p.darkAccent : p.lightAccent);

      if (live.current.portraitScale !== view.scale) resize(view.w, view.h);

      // Often enough to follow a scroll, a resize or a section opening.
      if (live.current.clearOfContent && frames % 4 === 0) drawMask();

      // The reveal follows `reveal`, in real seconds.
      const h = live.current.hire;
      const wantReveal = Boolean(h && live.current.reveal);
      const realNow = t / 1000;
      if (wantReveal !== revealState.target) {
        revealState.target = wantReveal;
        revealState.from = revealState.r;
        revealState.since = realNow;
        const distance = wantReveal ? 1 - revealState.r : revealState.r;
        revealState.duration = Math.max(0.05, (h?.revealTime ?? 1) * distance);
      }
      const progress = Math.min(
        1,
        (realNow - revealState.since) / revealState.duration,
      );
      revealState.r =
        revealState.from +
        ((revealState.target ? 1 : 0) - revealState.from) *
          easeOutCubic(progress);

      // The throw moves `at` toward its end at a steady rate.
      const thrown = live.current.thrown;
      if (throwState.thrown && !thrown) faceTaps.u_tapsFrom.value = now;
      throwState.thrown = thrown;
      const step = (thrown ? gap : -gap) / THROW_TIME;
      throwState.at = Math.min(1, Math.max(0, throwState.at + step));
      const at = throwState.at;

      // The face falls into its core by CORE_BY of the way: slowly at
      // first, then faster and faster. Played backward, it bursts out fast
      // and slows.
      uniforms.u_collapse.value = easeInCubic(Math.min(1, at / CORE_BY));

      const bounds = renderer.domElement.getBoundingClientRect();
      const worldPerPx = (2 * view.halfY) / Math.max(view.h, 1);
      const slot = live.current.landing?.current;
      if (slot) {
        const box = slot.getBoundingClientRect();
        land.seen = box.width > 0;
        land.x = box.left + box.width / 2 - bounds.left;
        land.y = box.top + box.height / 2 - bounds.top;
      }
      if (!land.seen) {
        land.x = view.w / 2;
        land.y = view.h - LAND_FALLBACK;
      }

      // The path, in CSS pixels from the middle with y up: x moves at a
      // steady speed, and y = a at + b at^2 tops out THROW_ARC above the
      // start and ends `drop` below it.
      const drop = Math.max(0, land.y - view.h / 2);
      const a =
        2 * THROW_ARC + 2 * Math.sqrt(THROW_ARC * THROW_ARC + THROW_ARC * drop);
      const b = -drop - a;
      uniforms.u_throwAt.value.set(
        (land.x - view.w / 2) * at * worldPerPx,
        (a * at + b * at * at) * worldPerPx,
      );

      // Venom, once the core has landed. Its tendrils strike at a cursor
      // that comes inside `reach`, to feel for it. Once the pointer has
      // stayed inside `jump` for a moment, the whole core jumps onto the
      // cursor, opens into a ring around it, and swallows it. Then it
      // holds the hidden cursor and pulls it home, until the pointer is
      // `release` from the core.
      const e = live.current.eat;
      const cx = pointer.x - bounds.left - land.x;
      const cy = pointer.y - bounds.top - land.y;
      const d = Math.hypot(cx, cy);
      const prey = { x: cx + CURSOR_MIDDLE.x, y: cy + CURSOR_MIDDLE.y };
      const pointerV = {
        x: gap > 0 ? (cx - lastPointer.x) / gap : 0,
        y: gap > 0 ? (cy - lastPointer.y) / gap : 0,
      };
      const pointerSpeed = Math.hypot(pointerV.x, pointerV.y);
      if (pointerSpeed > DRAG_MAX_SPEED) {
        pointerV.x *= DRAG_MAX_SPEED / pointerSpeed;
        pointerV.y *= DRAG_MAX_SPEED / pointerSpeed;
      }
      lastPointer.x = cx;
      lastPointer.y = cy;
      const setMode = (mode: EatMode) => {
        eatState.mode = mode;
        eatState.since = realNow;
      };
      const letGo = () => {
        setMode('rest');
        eatState.armed = false;
        eatState.nearSince = -1;
      };
      if (!e || at < 1 || !pointer.in) {
        if (eatState.mode !== 'rest') setMode('rest');
        eatState.armed = true;
        eatState.nearSince = -1;
      } else if (eatState.mode === 'rest') {
        if (d >= e.jump) {
          eatState.armed = true;
          eatState.nearSince = -1;
        } else if (!eatState.armed) {
          // A cursor the core let go must leave `jump` first.
        } else if (eatState.nearSince < 0) {
          eatState.nearSince = realNow;
        } else if (realNow - eatState.nearSince >= JUMP_DELAY) {
          setMode('jump');
          const gapToPrey = Math.hypot(prey.x - mass.at.x, prey.y - mass.at.y);
          eatState.jumpDir.x = (prey.x - mass.at.x) / Math.max(gapToPrey, 1);
          eatState.jumpDir.y = (prey.y - mass.at.y) / Math.max(gapToPrey, 1);
        }
      } else if (eatState.mode === 'jump') {
        if (d > Math.max(e.reach, e.jump)) {
          letGo();
        } else if (
          Math.hypot(prey.x - mass.at.x, prey.y - mass.at.y) <
          (1 - SHUT_INSIDE) * e.ring
        ) {
          setMode('swallow');
        }
      } else if (eatState.mode === 'swallow') {
        if (realNow - eatState.since >= WRAP_CLOSE) setMode('hold');
      } else if (Math.hypot(cx - mass.at.x, cy - mass.at.y) > e.release) {
        letGo();
      }
      const since = realNow - eatState.since;
      let wrap = 0;
      if (eatState.mode === 'jump') wrap = Math.min(1, since / WRAP_OPEN);
      if (eatState.mode === 'swallow') {
        wrap = (1 - Math.min(1, since / WRAP_CLOSE)) ** 2;
      }
      const hidden =
        eatState.mode === 'hold' ||
        (eatState.mode === 'swallow' && wrap < HIDE_AT);
      if (
        eatState.mode === 'swallow' &&
        hidden &&
        eatState.gulpAt < eatState.since
      ) {
        eatState.gulpAt = realNow;
      }
      document.documentElement.classList.toggle(EATEN_CLASS, hidden);

      // The whole core springs to its prey and stays on it through the
      // swallow. In the hold, a spring pulls it home and the pointer's
      // movement drags it. At rest, it springs home. Each tail link
      // springs after the one before it.
      const steps = Math.ceil(gap * 240);
      const jumpHz = e?.jumpSpring ?? 3;
      const onPrey = eatState.mode === 'jump' || eatState.mode === 'swallow';
      const holding = eatState.mode === 'hold';
      for (let i = 0; i < steps; i++) {
        springStep(
          mass.at,
          mass.v,
          onPrey ? prey : { x: 0, y: 0 },
          holding ? HOLD_SPRING * jumpHz : jumpHz,
          holding ? HOLD_DAMPING : MASS_DAMPING,
          gap / steps,
          holding ? (e?.tug ?? 0) * DRAG_RATE : 0,
          pointerV,
        );
        for (const [k, link] of tail.entries()) {
          springStep(
            link.at,
            link.v,
            k === 0 ? mass.at : tail[k - 1].at,
            TAIL_SPRING,
            TAIL_DAMPING,
            gap / steps,
          );
        }
      }

      // Each tip springs toward the cursor, swung off the line to it and
      // stretched by noise of its own. Each bend springs after its tip,
      // more slowly, so the tendril whips. Now and then a twitch kicks a
      // tip. A tendril that lets go springs back with no bounce. They
      // feel for the cursor at rest, grab it in a jump, and let go once
      // the core holds it.
      let reachFor = 0;
      if (e && eatState.mode === 'rest' && at >= 1 && pointer.in) {
        reachFor = smoothstep(e.reach, (1 - STRIKE_IN) * e.reach, d);
      }
      if (eatState.mode === 'jump') reachFor = 1;
      const rx = cx - mass.at.x;
      const ry = cy - mass.at.y;
      const count = e ? Math.min(e.tendrils, TENDRILS_MAX) : 0;
      let longest = 0;
      for (const [k, td] of tendrils.entries()) {
        const out = e && k < count ? reachFor : 0;
        const t = realNow * (e?.flailPace ?? 1) * td.pace;
        const toTip = { x: 0, y: 0 };
        let hz = 1.5 * (e?.spring ?? 3) * td.pace;
        let damping = 1;
        if (e && out > 0) {
          const angle =
            Math.atan2(ry, rx) +
            ((e.flail * Math.PI) / 180) * jitter(t, td.seed);
          const length =
            Math.min(Math.hypot(rx, ry), TENDRIL_LENGTH * e.reach) *
            out *
            (1 + e.stretch * jitter(t, td.seed + 1));
          toTip.x = length * Math.cos(angle);
          toTip.y = length * Math.sin(angle);
          hz = e.spring * td.pace;
          damping = e.damping;
          if (Math.random() < e.twitch * gap) {
            const kick = TWITCH_KICK * length * 2 * Math.PI * hz;
            const way = 2 * Math.PI * Math.random();
            td.tipV.x += kick * Math.cos(way);
            td.tipV.y += kick * Math.sin(way);
          }
        }
        const fan = count > 1 ? (2 * k) / (count - 1) - 1 : 0;
        const side = (e?.spread ?? 0) * (fan + 0.5 * jitter(t, td.seed + 2));
        for (let i = 0; i < steps; i++) {
          const dt = gap / steps;
          springStep(td.tip, td.tipV, toTip, hz, damping, dt);
          const toBend = {
            x: 0.5 * td.tip.x - side * td.tip.y,
            y: 0.5 * td.tip.y + side * td.tip.x,
          };
          springStep(td.bend, td.bendV, toBend, 0.6 * hz, damping, dt);
        }
        // To world units, y up.
        uniforms.u_tendril.value[k].set(
          td.tip.x * worldPerPx,
          -td.tip.y * worldPerPx,
          td.bend.x * worldPerPx,
          -td.bend.y * worldPerPx,
        );
        longest = Math.max(longest, Math.hypot(td.tip.x, td.tip.y));
      }
      uniforms.u_grab.value = longest * worldPerPx;
      if (e) {
        uniforms.u_tendrils.value = count;
        uniforms.u_tendrilShare.value = e.share;
        uniforms.u_strand.value = e.strand * worldPerPx;
        uniforms.u_wiggle.value = e.wiggle * worldPerPx;
      }
      // The gulp: a quick swell that dies away.
      const sinceGulp = realNow - eatState.gulpAt;
      const gulp =
        (e?.gulp ?? 0) * Math.min(1, sinceGulp * 25) * Math.exp(-sinceGulp * 7);

      // The core pulses and wanders about its middle.
      const pace = realNow * CORE_PACE;
      uniforms.u_coreSize.value =
        CORE_RADIUS * (1 + CORE_PULSE * wander(pace, 1)) * (1 + gulp);
      uniforms.u_coreAt.value.set(
        CORE_DRIFT * wander(pace, 2) + mass.at.x * worldPerPx,
        CORE_DRIFT * wander(pace, 3) - mass.at.y * worldPerPx,
      );
      uniforms.u_wrap.value = wrap;
      uniforms.u_wrapRadius.value = (e?.ring ?? 0) * worldPerPx;
      // To world units, y up.
      uniforms.u_massV.value.set(mass.v.x * worldPerPx, -mass.v.y * worldPerPx);
      uniforms.u_sway.value = Math.min(
        1,
        Math.hypot(mass.v.x, mass.v.y) / SWAY_SPEED,
      );
      uniforms.u_jumpDir.value.set(eatState.jumpDir.x, -eatState.jumpDir.y);
      for (const [k, link] of tail.entries()) {
        uniforms.u_tail.value[k].set(
          (link.at.x - mass.at.x) * worldPerPx,
          -(link.at.y - mass.at.y) * worldPerPx,
        );
      }

      // Crossfade a click front from the inner look to the nebula look.
      if (h) {
        rippleUniforms.u_lookNear.value = h.crossfade - 3;
        rippleUniforms.u_lookFar.value = h.crossfade + 3;
        rippleUniforms.u_outerWarp.value = OUTER_LOOK.warp;
        rippleUniforms.u_outerWobble.value = OUTER_LOOK.wobble;
        rippleUniforms.u_outerBanding.value = OUTER_LOOK.banding;
        rippleUniforms.u_outerNebula.value = OUTER_LOOK.nebula;
      } else {
        rippleUniforms.u_lookNear.value = 1e4;
        rippleUniforms.u_lookFar.value = 1e4 + 1;
      }

      const showGrid = h ? revealState.r > 0.0001 : p.grid;
      grid.visible = showGrid;
      if (showGrid) {
        const glyphs = h ? 'message' : p.glyphs;
        const message = h ? h.message : p.message;
        if (`${glyphs}\n${message}` !== atlasFor) {
          atlas.texture.dispose();
          atlasFor = `${glyphs}\n${message}`;
          atlas = makeAtlas(glyphs, message);
          gridUniforms.u_atlas.value = atlas.texture;
          gridUniforms.u_atlasGrid.value.set(ATLAS_COLS, atlas.rows);
          gridUniforms.u_glyphCount.value = atlas.count;
        }

        // Text sets in narrow cells, like a terminal; other sets are square.
        const isText = glyphs === 'message';
        const cellH = h ? h.letterSize : p.cellSize;
        const cellW = isText ? cellH * (h ? 0.6 : p.textWidth) : cellH;
        const cols = Math.max(1, Math.ceil(view.w / cellW));
        const rows = Math.max(1, Math.ceil(view.h / cellH));
        if (lightTarget.width !== cols || lightTarget.height !== rows) {
          lightTarget.setSize(cols, rows);
        }
        gridUniforms.u_gridDims.value.set(cols, rows);
        lightUniforms.u_cellPx.value.set(cellW, cellH);
        lightUniforms.u_viewPx.value.set(view.w, view.h);
        lightUniforms.u_halfExtent.value.set(view.halfX, view.halfY);
        gridUniforms.u_dpr.value = renderer.getPixelRatio();
        gridUniforms.u_message.value = isText ? 1 : 0;

        if (h) {
          lightUniforms.u_hire.value = 1;
          lightUniforms.u_afterglow.value = 0.6;
          lightUniforms.u_textStrength.value = h.textStrength;
          lightUniforms.u_textDrift.value = h.textDrift;
          lightUniforms.u_revealFade.value = revealState.r;
          gridUniforms.u_fill.value = 1;
          gridUniforms.u_gridAlpha.value = 1;
          gridUniforms.u_flicker.value = 0;
          gridUniforms.u_spin.value = 6;
          gridUniforms.u_rowShift.value = 3;
        } else {
          lightUniforms.u_hire.value = 0;
          lightUniforms.u_afterglow.value = p.afterglow;
          lightUniforms.u_gridIdle.value = p.gridIdle;
          lightUniforms.u_calm.value = p.calm;
          gridUniforms.u_fill.value = p.fill;
          gridUniforms.u_gridAlpha.value = p.gridAlpha;
          gridUniforms.u_flicker.value = p.flicker;
          gridUniforms.u_spin.value = p.spin;
          gridUniforms.u_rowShift.value = p.rowShift;
        }

        renderer.setRenderTarget(lightTarget);
        renderer.render(lightScene, camera);
        renderer.setRenderTarget(null);
      }

      gpuSim.compute();

      const active = Math.ceil(10 * frames++);
      posVar.material.uniforms.u_nActiveParticles.value = active;
      velVar.material.uniforms.u_nActiveParticles.value = active;
      uniforms.u_nActiveParticles.value = active;
      uniforms.u_positionTexture.value =
        gpuSim.getCurrentRenderTarget(posVar).texture;
      uniforms.u_offsetTexture.value =
        gpuSim.getCurrentRenderTarget(offVar).texture;

      renderer.render(scene, camera);

      fpsFrames++;
      if (t - fpsSince >= 1000) {
        live.current.onFps?.((fpsFrames * 1000) / (t - fpsSince));
        fpsFrames = 0;
        fpsSince = t;
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('click', startRipple, true);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener(
        'pointerleave',
        onPointerLeave,
      );
      document.documentElement.classList.remove(EATEN_CLASS);
      gpuSim.dispose();
      geometry.dispose();
      material.dispose();
      fullScreen.dispose();
      gridMaterial.dispose();
      lightMaterial.dispose();
      lightTarget.dispose();
      atlas.texture.dispose();
      contentMask.value.dispose();
      observer?.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // Only the sim's shape rebuilds it. Every other param is read live,
    // through `live`.
  }, [simSize, size]);

  // A fill stage (size 0) covers its positioned parent; the canvas then
  // tracks that size.
  return (
    <div
      ref={mountRef}
      style={
        size === 0 ? { position: 'absolute', inset: 0, padding: 0 } : undefined
      }
    />
  );
};

export type { ShaderRippleHandle };
export { ShaderRipple };
