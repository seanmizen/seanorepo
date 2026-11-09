import type { FC } from 'react';
import { useContext, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ThemeContext } from '@/providers';
import type { Theme } from '@/types';
import { HOME_PARAMS } from '../shader-ripple';
import { contentMasks, MASK_OPACITY } from '../shader-ripple/content-mask';
import frag from './frag.glsl';
import lineFrag from './line-frag.glsl';
import lineVert from './line-vert.glsl';

/* One entry of public/thirty/index.json. `yarn thirty:bake` writes it. */
type City = {
  file: string;
  url: string;
  size: number;
  steps: number;
  bytes: number;
};

const TEXELS = 256;
const SECONDS = 60;
const vert = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

/* A baked file of size bytes, unzipped. The dev server sends a .gz file
   with Content-Encoding: gzip, so the browser has already unzipped it.
   Unzip only a file of another size. */
const baked = async (url: string, size: number) => {
  const raw = await (await fetch(url)).blob();
  const data =
    raw.size === size
      ? raw
      : new Response(raw.stream().pipeThrough(new DecompressionStream('gzip')));
  return new Uint8Array(await data.arrayBuffer());
};

/* Ink and accent, the same as the face shader. */
const colours = (theme: Theme) =>
  theme === 'dark'
    ? [HOME_PARAMS.darkInk, HOME_PARAMS.darkAccent]
    : [HOME_PARAMS.lightInk, HOME_PARAMS.lightAccent];

/* The baked cities are London. A page that shows one credits its data. */
export const THIRTY_CREDIT =
  'The background is a transit network for London from thirty. Data: © OpenStreetMap contributors (ODbL), GHSL © European Union (CC BY 4.0), Copernicus DEM © ESA/DLR/Airbus.';

type ThirtyBgProps = {
  /* The index of the city in index.json. Absent: a random city. */
  city?: number;
  /* Draw the last frame at once. */
  end?: boolean;
  /* Fade the city out. */
  hidden?: boolean;
};

/* A baked thirty city behind the page: dots of unmet demand shrink as the
   lines of the transit network appear. It plays for SECONDS, then the last
   frame stays. Without WebGL 2 it draws nothing. While hidden, the city
   fades out over 1 s. */
const ThirtyBg: FC<ThirtyBgProps> = ({ city, end, hidden = false }) => {
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
    // The canvas fades in once the city's first frame is drawn, so London
    // does not appear in one frame. With reduced motion it shows at once.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    canvas.style.opacity = '0';
    if (!still) canvas.style.transition = 'opacity 1s ease-out';
    mount.appendChild(canvas);
    // The dots and lines clear the page text, as the face shader does.
    const { contentMask, tightMask, drawMask } = contentMasks(canvas);

    const uniforms = {
      city: { value: null as THREE.DataTexture | null },
      res: { value: new THREE.Vector2() },
      px: { value: 1 },
      cells: { value: 1 },
      steps: { value: 1 },
      t: { value: 0 },
      ink: { value: new THREE.Color() },
      accent: { value: new THREE.Color() },
      content: contentMask.texture,
      tight: tightMask.texture,
      maskOpacity: { value: MASK_OPACITY },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    // The lines draw over the dots. All lines are at one depth and the depth
    // test passes only a nearer fragment, so each pixel gets one line. Where
    // lines cross or a line turns, the alpha does not add up.
    const lineMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: lineVert,
      fragmentShader: lineFrag,
      transparent: true,
      premultipliedAlpha: true,
      depthFunc: THREE.LessDepth,
      side: THREE.DoubleSide,
    });
    const lineGeometry = new THREE.BufferGeometry();
    const lineMesh = new THREE.Mesh(lineGeometry, lineMaterial);
    lineMesh.frustumCulled = false;
    const scene = new THREE.Scene().add(
      new THREE.Mesh(geometry, material),
      lineMesh,
    );
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
      drawMask();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    // The frame loop stops at the end, so a scroll, a change to the page, the
    // end of a transition or the fonts loading redraws the mask itself, at
    // most once a frame. Opening a section can change only an attribute.
    let pending = 0;
    const scroll = () => {
      pending ||= requestAnimationFrame(() => {
        pending = 0;
        drawMask();
        draw();
      });
    };
    addEventListener('scroll', scroll, { capture: true, passive: true });
    const changes = new MutationObserver(scroll);
    changes.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    addEventListener('transitionend', scroll, true);
    document.fonts.ready.then(scroll);

    // A hidden tab runs no animation frames, and one frame moves time at
    // most 0.1 s, so the run pauses while the tab is hidden. The loop stops
    // at the end of the run.
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      uniforms.t.value = Math.min(1, uniforms.t.value + dt / SECONDS);
      draw();
      raf = uniforms.t.value < 1 ? requestAnimationFrame(frame) : 0;
    };

    let gone = false;
    const load = async () => {
      const list: City[] = await (await fetch('/thirty/index.json')).json();
      const pick = list[city ?? Math.floor(Math.random() * list.length)];
      const bytes = await baked(`/thirty/${pick.file}`, pick.bytes);
      if (gone) return;
      const n = TEXELS * TEXELS * 2;
      const texture = new THREE.DataTexture(
        bytes.subarray(0, n),
        TEXELS,
        TEXELS,
        THREE.RGFormat,
      );
      texture.needsUpdate = true;
      // The lines, as the bake writes them: step, point count, then points.
      // Each segment is a quad. The newest lines come first, so they draw
      // on top. Every browser is little-endian, as the file is.
      const v = new Uint16Array(bytes.buffer, n);
      const polys: [number, Uint16Array][] = [];
      for (let k = 0; k < v.length; k += 2 + 2 * v[k + 1])
        polys.push([v[k], v.subarray(k + 2, k + 2 + 2 * v[k + 1])]);
      const [a, b, corner, appear, index] = [[], [], [], [], []] as number[][];
      for (const [step, p] of polys.sort((x, y) => y[0] - x[0]))
        for (let k = 2; k < p.length; k += 2) {
          index.push(...[0, 1, 2, 2, 1, 3].map((i) => appear.length + i));
          for (const c of [0, -1, 0, 1, 1, -1, 1, 1]) corner.push(c);
          for (let i = 0; i < 4; i++) {
            a.push(p[k - 2] / 65535, p[k - 1] / 65535);
            b.push(p[k] / 65535, p[k + 1] / 65535);
            appear.push(step);
          }
        }
      const attr = (x: number[], size: number) =>
        new THREE.Float32BufferAttribute(x, size);
      lineGeometry.setAttribute('a', attr(a, 2));
      lineGeometry.setAttribute('b', attr(b, 2));
      lineGeometry.setAttribute('corner', attr(corner, 2));
      lineGeometry.setAttribute('appear', attr(appear, 1));
      lineGeometry.setIndex(index);
      uniforms.city.value = texture;
      uniforms.cells.value = pick.size;
      uniforms.steps.value = pick.steps;
      // With reduced motion, or for end, draw the last frame once.
      if (end || still) uniforms.t.value = 1;
      drawMask();
      paint.current();
      canvas.style.opacity = '1';
      raf = requestAnimationFrame(frame);
    };
    // A background has no place to show an error. It draws nothing.
    load().catch(() => {});

    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      removeEventListener('scroll', scroll, { capture: true });
      changes.disconnect();
      removeEventListener('transitionend', scroll, true);
      cancelAnimationFrame(pending);
      contentMask.texture.value.dispose();
      tightMask.texture.value.dispose();
      uniforms.city.value?.dispose();
      material.dispose();
      geometry.dispose();
      lineMaterial.dispose();
      lineGeometry.dispose();
      renderer.dispose();
      canvas.remove();
      paint.current = () => {};
    };
  }, [city, end]);

  useEffect(() => {
    paint.current();
  }, [theme]);

  return (
    <div
      ref={mountRef}
      className="shader-container"
      aria-hidden="true"
      style={{ opacity: hidden ? 0 : 1, transition: 'opacity 1s ease-out' }}
    />
  );
};

export { ThirtyBg };
