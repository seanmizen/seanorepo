import type { FC } from 'react';
import { useContext, useEffect, useRef } from 'react';
import Stats from 'stats.js';
import * as THREE from 'three';
import { GPUComputationRenderer, OrbitControls } from 'three-stdlib';
import { ThemeContext } from '@/providers';
import frag from './frag-stippling.glsl';
import posSim from './frag-stippling-pos.glsl';
import velSim from './frag-stippling-vel.glsl';
import bgImage from './IMG_4011_crop2.jpeg';
import particleTex from './particle2.png';
import ripple from './ripple.glsl';
import vert from './vert-stippling.glsl';

/* Anything a click can be aimed at. Mirrors the tabbable set the chevron
   system uses in entity-list.module.css. */
const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, label, [tabindex]:not([tabindex="-1"])';

/* Must match MAX_TAPS in ripple.glsl. */
const MAX_TAPS = 8;

/* Ink and ripple tint for each theme. */
const COLORS = {
  light: { ink: 0x000000, accent: 0xe0262b },
  dark: { ink: 0xdddddd, accent: 0x3d8bff },
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

const ShaderSean: FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  const { theme } = useContext(ThemeContext);

  const { width, height } = { width: 500, height: 500 };

  useEffect(() => {
    if (materialRef.current) {
      const { ink, accent } = COLORS[theme === 'light' ? 'light' : 'dark'];
      materialRef.current.uniforms.u_color.value.set(ink);
      materialRef.current.uniforms.u_accent.value.set(accent);
    }
  }, [theme]);

  useEffect(() => {
    if (!mountRef.current) return;

    mountRef.current.replaceChildren();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 5_000);
    camera.position.z = 20;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;

    const stats = new Stats();

    const simSize = 64;
    const gpuSim = new GPUComputationRenderer(simSize, simSize, renderer);

    const posTex = gpuSim.createTexture();
    const velTex = gpuSim.createTexture();
    if (posTex.image.data && velTex.image.data) {
      seed(
        posTex.image.data as Float32Array,
        velTex.image.data as Float32Array,
      );
    }

    const posVar = gpuSim.addVariable('u_positionTexture', posSim, posTex);
    const velVar = gpuSim.addVariable(
      'u_velocityTexture',
      `${ripple}\n${velSim}`,
      velTex,
    );

    gpuSim.setVariableDependencies(posVar, [posVar, velVar]);
    gpuSim.setVariableDependencies(velVar, [posVar, velVar]);

    const shared = { u_dt: { value: 0.78 }, u_nActiveParticles: { value: 10 } };

    // One set of ripple uniforms, shared by reference between the velocity
    // sim (the push) and the particle material (the tint).
    const taps = {
      u_now: { value: 0 },
      u_tapCount: { value: 0 },
      u_taps: {
        value: Array.from({ length: MAX_TAPS }, () => new THREE.Vector4()),
      },
    };
    let nTaps = 0;

    Object.assign(posVar.material.uniforms, shared);
    Object.assign(velVar.material.uniforms, {
      ...shared,
      ...taps,
      u_bgTexture: { value: new THREE.TextureLoader().load(bgImage) },
      u_textureOffset: { value: new THREE.Vector2(12, 12) },
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

    const colors = COLORS[theme === 'light' ? 'light' : 'dark'];
    const uniforms = {
      ...taps,
      u_width: { value: simSize },
      u_height: { value: simSize },
      u_particleSize: { value: 40 * Math.min(devicePixelRatio, 2) },
      u_nActiveParticles: { value: 1 },
      u_positionTexture: { value: null as THREE.Texture | null },
      u_bgTexture: velVar.material.uniforms.u_bgTexture,
      u_textureOffset: velVar.material.uniforms.u_textureOffset,
      u_texture: { value: new THREE.TextureLoader().load(particleTex) },
      u_color: { value: new THREE.Color(colors.ink) },
      u_accent: { value: new THREE.Color(colors.accent) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `${ripple}\n${vert}`,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
    });
    materialRef.current = material;

    scene.add(new THREE.Points(geometry, material));

    const onResize = () => {
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    addEventListener('resize', onResize);

    const startRipple = (e: MouseEvent) => {
      // The backdrop sits behind everything with pointer-events: none, so the
      // ripple has to be driven from a window listener — which means it hears
      // every click on the page, including ones aimed at a control. A click
      // that lands on something interactive was meant for that thing, not for
      // the background behind it.
      //
      // composedPath() is captured when the event is dispatched, so it still
      // holds the real ancestor chain even if React has since re-rendered the
      // target away. Walking up from e.target instead would miss the theme
      // toggle: its onClick swaps the icon <svg>, and closest() on a detached
      // node finds no <button>. This listener is also registered in the
      // capture phase so it runs before that re-render can happen.
      const clicked = e
        .composedPath()
        .some((node) => node instanceof Element && node.matches(INTERACTIVE));
      if (clicked) return;

      // Cast the click through the camera onto the z = 0 plane the particles
      // live on, so the ripple starts under the pointer from any view angle.
      // Clicks outside the canvas still land on the plane, off to the side.
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((e.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;

      // The newest click takes the oldest slot.
      taps.u_taps.value[nTaps % MAX_TAPS].set(
        hit.x,
        hit.y,
        taps.u_now.value,
        1,
      );
      nTaps++;
      taps.u_tapCount.value = Math.min(nTaps, MAX_TAPS);
    };

    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const pointer = new THREE.Vector2();
    const hit = new THREE.Vector3();

    window.addEventListener('click', startRipple, true);

    let frames = 0;
    const start = performance.now();
    const animate = () => {
      requestAnimationFrame(animate);
      taps.u_now.value = (performance.now() - start) / 1000;
      gpuSim.compute();

      const active = Math.ceil(10 * frames++);
      posVar.material.uniforms.u_nActiveParticles.value = active;
      velVar.material.uniforms.u_nActiveParticles.value = active;
      uniforms.u_nActiveParticles.value = active;
      uniforms.u_positionTexture.value =
        gpuSim.getCurrentRenderTarget(posVar).texture;

      renderer.render(scene, camera);
      stats.update();
    };
    animate();

    return () => {
      removeEventListener('resize', onResize);
      if (
        mountRef.current &&
        renderer.domElement.parentNode === mountRef.current
      ) {
        mountRef.current.removeChild(renderer.domElement);
      }
      window.removeEventListener('click', startRipple, true);
      renderer.dispose();
    };
  }, [width, height]);

  return <div ref={mountRef} />;
};

export { ShaderSean };
