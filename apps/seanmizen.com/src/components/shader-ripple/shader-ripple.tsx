import type { FC, Ref } from 'react';
import { useContext, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three-stdlib';
import { ThemeContext } from '@/providers';
import bgImage from '../shader-sean/IMG_4011_crop2.jpeg';
import particleTex from '../shader-sean/particle2.png';
import frag from './frag-stippling.glsl';
import offsetSim from './frag-stippling-offset.glsl';
import posSim from './frag-stippling-pos.glsl';
import velSim from './frag-stippling-vel.glsl';
import type { RippleParams } from './params';
import { MAX_TAPS } from './params';
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

/* The camera looks straight down the z axis from here, with this vertical
   field of view. The particles live on the z = 0 plane, so the visible
   half-height of that plane is fixed, and a click maps onto it linearly. */
const CAMERA_Z = 20;
const FOV = 75;
const HALF_EXTENT = CAMERA_Z * Math.tan(((FOV / 2) * Math.PI) / 180);

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
    renderer.setSize(size, size);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5_000);
    camera.position.z = CAMERA_Z;

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

      // Map the click onto the particles' plane. The canvas is square and
      // the camera fixed, so this is a straight scale from the canvas
      // centre. Clicks outside the canvas land off to the side.
      const bounds = renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
      const y = 1 - ((e.clientY - bounds.top) / bounds.height) * 2;
      addTap(x * HALF_EXTENT, y * HALF_EXTENT);
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
      uniforms.u_particleSize.value =
        p.particleSize * Math.min(devicePixelRatio, 2);
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
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // Only the sim's shape rebuilds it. Every other param is read live,
    // through `live`.
  }, [simSize, size]);

  return <div ref={mountRef} />;
};

export type { ShaderRippleHandle };
export { ShaderRipple };
