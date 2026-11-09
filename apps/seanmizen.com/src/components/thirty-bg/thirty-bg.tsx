import type { FC } from 'react';
import { useContext, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ThemeContext } from '@/providers';
import type { Theme } from '@/types';
import { HOME_PARAMS } from '../shader-ripple';
import frag from './frag.glsl';

/* One entry of public/thirty/index.json. `yarn thirty:bake` writes it. */
type City = { file: string; url: string; size: number; steps: number };

const TEXELS = 256;
const SECONDS = 20;
const vert = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

/* Ink and accent, the same as the face shader. */
const colours = (theme: Theme) =>
  theme === 'dark'
    ? [HOME_PARAMS.darkInk, HOME_PARAMS.darkAccent]
    : [HOME_PARAMS.lightInk, HOME_PARAMS.lightAccent];

type ThirtyBgProps = {
  /* The index of the city in index.json. Absent: a random city. */
  city?: number;
};

/* A baked thirty city behind the page: dots of unmet demand shrink as the
   lines of the transit network appear. It plays for SECONDS, then the last
   frame stays. Without WebGL 2 it draws nothing. */
const ThirtyBg: FC<ThirtyBgProps> = ({ city }) => {
  const { theme } = useContext(ThemeContext);
  const mountRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const paint = useRef(() => {});

  useEffect(() => {
    const mount = mountRef.current;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true });
    if (!mount || !gl) return;
    const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(canvas);

    const uniforms = {
      city: { value: null as THREE.DataTexture | null },
      res: { value: new THREE.Vector2() },
      px: { value: 1 },
      cells: { value: 1 },
      steps: { value: 1 },
      t: { value: 0 },
      ink: { value: new THREE.Color() },
      accent: { value: new THREE.Color() },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vert,
      fragmentShader: frag,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const scene = new THREE.Scene().add(new THREE.Mesh(geometry, material));
    const camera = new THREE.Camera();
    const draw = () => uniforms.city.value && renderer.render(scene, camera);
    paint.current = () => {
      const [ink, accent] = colours(themeRef.current);
      uniforms.ink.value.set(ink);
      uniforms.accent.value.set(accent);
      draw();
    };

    const resize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.getDrawingBufferSize(uniforms.res.value);
      uniforms.px.value = renderer.getPixelRatio();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // A hidden tab runs no animation frames, and one frame moves time at
    // most 0.1 s, so the run pauses while the tab is hidden.
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      uniforms.t.value = Math.min(1, uniforms.t.value + dt / SECONDS);
      draw();
      if (uniforms.t.value < 1) raf = requestAnimationFrame(frame);
    };

    let gone = false;
    const load = async () => {
      const list: City[] = await (await fetch('/thirty/index.json')).json();
      const pick = list[city ?? Math.floor(Math.random() * list.length)];
      const raw = await (await fetch(`/thirty/${pick.file}`)).blob();
      // The dev server sends a .gz file with Content-Encoding: gzip, so the
      // browser has already unzipped it. Unzip only a file of another size.
      const data =
        raw.size === TEXELS * TEXELS * 4
          ? raw
          : new Response(
              raw.stream().pipeThrough(new DecompressionStream('gzip')),
            );
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (gone) return;
      const texture = new THREE.DataTexture(bytes, TEXELS, TEXELS);
      texture.needsUpdate = true;
      uniforms.city.value = texture;
      uniforms.cells.value = pick.size;
      uniforms.steps.value = pick.steps;
      // With reduced motion, draw the last frame once.
      if (matchMedia('(prefers-reduced-motion: reduce)').matches)
        uniforms.t.value = 1;
      paint.current();
      last = performance.now();
      if (uniforms.t.value < 1) raf = requestAnimationFrame(frame);
    };
    // A background has no place to show an error. It draws nothing.
    load().catch(() => {});

    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      uniforms.city.value?.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
      paint.current = () => {};
    };
  }, [city]);

  useEffect(() => {
    paint.current();
  }, [theme]);

  return <div ref={mountRef} className="shader-container" aria-hidden="true" />;
};

export { ThirtyBg };
