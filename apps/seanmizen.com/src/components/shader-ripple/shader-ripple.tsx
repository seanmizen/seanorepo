import type { FC, Ref } from 'react';
import { useContext, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three-stdlib';
import { ThemeContext } from '@/providers';
import glyphFrag from './frag-glyphs.glsl';
import frag from './frag-stippling.glsl';
import offsetSim from './frag-stippling-offset.glsl';
import posSim from './frag-stippling-pos.glsl';
import velSim from './frag-stippling-vel.glsl';
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

/* Draw a glyph set into a texture, white on clear, left to right and top
   to bottom. */
const makeAtlas = (set: GlyphSet) => {
  const chars = [...GLYPH_SETS[set]];
  const rows = Math.ceil(chars.length / ATLAS_COLS);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * ATLAS_CELL;
  canvas.height = rows * ATLAS_CELL;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${ATLAS_CELL * 0.72}px "Red Hat Mono", ui-monospace, Menlo, Consolas, monospace`;
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
  ref?: Ref<ShaderRippleHandle>;
};

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
  ref,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const { theme } = useContext(ThemeContext);

  // Read every frame by the render loop, so slider changes land without a
  // rebuild.
  const live = useRef({ params, theme, onFps });
  live.current = { params, theme, onFps };

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
    // and how far the camera has moved back from CAMERA_Z.
    const view = { w: 0, h: 0, halfX: 0, halfY: 0, zoom: 1 };
    const resize = (w: number, h: number) => {
      if (w < 1 || h < 1) return;
      renderer.setSize(w, h);
      view.w = w;
      view.h = h;
      view.zoom = h / REFERENCE_PX;
      camera.aspect = w / h;
      camera.position.z = CAMERA_Z * view.zoom;
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

    // The glyph background: one triangle that covers the whole canvas,
    // drawn before the particles.
    let atlasSet = live.current.params.glyphs;
    let atlas = makeAtlas(atlasSet);
    const gridUniforms = {
      ...rippleUniforms,
      u_atlas: { value: atlas.texture },
      u_atlasGrid: { value: new THREE.Vector2(ATLAS_COLS, atlas.rows) },
      u_glyphCount: { value: atlas.count },
      u_viewPx: { value: new THREE.Vector2() },
      u_halfExtent: { value: new THREE.Vector2() },
      u_dpr: { value: renderer.getPixelRatio() },
      u_cellSize: { value: 14 },
      u_fill: { value: 1 },
      u_gridAlpha: { value: 1 },
      u_gridIdle: { value: 0 },
      u_flicker: { value: 0 },
      u_spin: { value: 0 },
      u_calm: { value: 0 },
      u_color: uniforms.u_color,
      u_accent: uniforms.u_accent,
      u_tintEdge: uniforms.u_tintEdge,
      u_afterglow: uniforms.u_afterglow,
    };
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    );
    const gridMaterial = new THREE.ShaderMaterial({
      uniforms: gridUniforms,
      vertexShader:
        'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `${ripple}\n${glyphFrag}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const grid = new THREE.Mesh(gridGeometry, gridMaterial);
    grid.frustumCulled = false;
    grid.renderOrder = -1;
    scene.add(grid);

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

      grid.visible = p.grid;
      if (p.grid) {
        if (p.glyphs !== atlasSet) {
          atlas.texture.dispose();
          atlasSet = p.glyphs;
          atlas = makeAtlas(atlasSet);
          gridUniforms.u_atlas.value = atlas.texture;
          gridUniforms.u_atlasGrid.value.set(ATLAS_COLS, atlas.rows);
          gridUniforms.u_glyphCount.value = atlas.count;
        }
        gridUniforms.u_viewPx.value.set(view.w, view.h);
        gridUniforms.u_halfExtent.value.set(view.halfX, view.halfY);
        gridUniforms.u_dpr.value = renderer.getPixelRatio();
        gridUniforms.u_cellSize.value = p.cellSize;
        gridUniforms.u_fill.value = p.fill;
        gridUniforms.u_gridAlpha.value = p.gridAlpha;
        gridUniforms.u_gridIdle.value = p.gridIdle;
        gridUniforms.u_flicker.value = p.flicker;
        gridUniforms.u_spin.value = p.spin;
        gridUniforms.u_calm.value = p.calm;
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
      gridGeometry.dispose();
      gridMaterial.dispose();
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
