import type { FC, Ref } from 'react';
import { useContext, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three-stdlib';
import bgImage from '@/components/shader-ripple/IMG_4011_crop2.jpeg';
import type { GlyphSet, RippleParams } from '@/components/shader-ripple/params';
import { GLYPH_SETS, MAX_TAPS } from '@/components/shader-ripple/params';
import particleTex from '@/components/shader-ripple/particle2.png';
import { ThemeContext } from '@/providers';
import glyphLightFrag from './frag-glyph-light.glsl';
import glyphFrag from './frag-glyphs.glsl';
import frag from './frag-stippling.glsl';
import offsetSim from './frag-stippling-offset.glsl';
import posSim from './frag-stippling-pos.glsl';
import velSim from './frag-stippling-vel.glsl';
import type { HireSettings } from './hire';
import { OUTER_LOOK } from './hire';
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
  /* While true, every dot of the face falls into a small core that pulses.
     When false, the dots burst back out into the face. */
  collapse?: boolean;
  /* Elements whose combined box the hire field keeps clear of text. */
  clearSelector?: string;
  /* Draws the portrait at this scale; the view around it is unchanged. */
  portraitScale?: number;
  ref?: Ref<ShaderRippleHandle>;
};

/* The collapse: seconds to fall into the core, and to burst back out. */
const COLLAPSE_IN = 0.6;
const COLLAPSE_OUT = 0.9;
/* The core's size against the face's, how much it pulses, and the seconds
   for one pulse. */
const CORE = 0.07;
const CORE_PULSE = 0.25;
const PULSE_SECONDS = 1.8;

const easeInCubic = (x: number) => x ** 3;
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
  collapse = false,
  clearSelector,
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
    collapse,
    clearSelector,
    portraitScale,
  });
  live.current = {
    params,
    theme,
    onFps,
    hire,
    reveal,
    collapse,
    clearSelector,
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
      ...simUniforms,
      u_bgTexture: bgTexture,
      u_textureOffset: textureOffset,
    });
    Object.assign(offVar.material.uniforms, {
      ...rippleUniforms,
      ...simUniforms,
    });

    if (gpuSim.init()) throw new Error('GPUComputation init failed');

    const n = simSize * simSize;
    const geometry = new THREE.BufferGeometry();
    const indices = new Float32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    geometry.setAttribute('a_index', new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(3 * n), 3),
    );

    const uniforms = {
      ...rippleUniforms,
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
      u_core: { value: 1 },
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
      u_clearFace: { value: 0 },
      u_clearSoft: { value: 1 },
      u_clearRect: { value: new THREE.Vector4() },
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

    // The collapse: `c` runs from 0 (the face) to 1 (the core). Going in,
    // the dots fall faster and faster. Coming out, they burst and slow.
    const collapseState = {
      target: false,
      from: 0,
      c: 0,
      since: 0,
      duration: 1,
    };

    // The content box the text keeps clear of, in world units.
    const clearBox = new THREE.Vector4();
    const measureClear = () => {
      clearBox.set(0, 0, 0, 0);
      const selector = live.current.clearSelector;
      if (!selector) return;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      // Measure each element's contents, not its box: a block is as wide as
      // its container, but its text may take a third of that.
      const range = document.createRange();
      for (const el of document.querySelectorAll(selector)) {
        range.selectNodeContents(el);
        const box = range.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.right);
        bottom = Math.max(bottom, box.bottom);
      }
      if (right <= left) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const toX = (x: number) =>
        ((x - bounds.left) / bounds.width) * 2 * view.halfX - view.halfX;
      const toY = (y: number) =>
        view.halfY - ((y - bounds.top) / bounds.height) * 2 * view.halfY;
      clearBox.set(toX(left), toY(bottom), toX(right), toY(top));
    };

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
      now += (Math.min(t - last, 100) / 1000) * p.timeScale;
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
        // The page has just changed (a navigation), so measure now rather
        // than a few frames late.
        measureClear();
      }
      const progress = Math.min(
        1,
        (realNow - revealState.since) / revealState.duration,
      );
      revealState.r =
        revealState.from +
        ((revealState.target ? 1 : 0) - revealState.from) *
          easeOutCubic(progress);

      // The collapse follows `collapse`, in real seconds.
      const wantCollapse = Boolean(live.current.collapse);
      if (wantCollapse !== collapseState.target) {
        collapseState.target = wantCollapse;
        collapseState.from = collapseState.c;
        collapseState.since = realNow;
        const distance = wantCollapse ? 1 - collapseState.c : collapseState.c;
        collapseState.duration = Math.max(
          0.05,
          (wantCollapse ? COLLAPSE_IN : COLLAPSE_OUT) * distance,
        );
      }
      const fall = Math.min(
        1,
        (realNow - collapseState.since) / collapseState.duration,
      );
      const ease = collapseState.target ? easeInCubic : easeOutCubic;
      collapseState.c =
        collapseState.from +
        ((collapseState.target ? 1 : 0) - collapseState.from) * ease(fall);
      uniforms.u_collapse.value = collapseState.c;
      uniforms.u_core.value =
        CORE *
        (1 + CORE_PULSE * Math.sin((2 * Math.PI * realNow) / PULSE_SECONDS));

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
          // Often enough to follow a scroll or a resize.
          if (frames % 4 === 0) measureClear();
          lightUniforms.u_hire.value = 1;
          lightUniforms.u_afterglow.value = 0.6;
          lightUniforms.u_textStrength.value = h.textStrength;
          lightUniforms.u_textDrift.value = h.textDrift;
          lightUniforms.u_revealFade.value = revealState.r;
          lightUniforms.u_clearFace.value = h.clearFace;
          lightUniforms.u_clearSoft.value = h.clearSoft;
          lightUniforms.u_clearRect.value.copy(clearBox);
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
      gpuSim.dispose();
      geometry.dispose();
      material.dispose();
      fullScreen.dispose();
      gridMaterial.dispose();
      lightMaterial.dispose();
      lightTarget.dispose();
      atlas.texture.dispose();
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
