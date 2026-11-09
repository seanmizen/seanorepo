import type { FC } from 'react';
import { useContext, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ThemeContext } from '@/providers';
import type { Theme } from '@/types';
import { HOME_PARAMS } from '../shader-ripple';
import { contentMasks, MASK_OPACITY } from '../shader-ripple/content-mask';
import { INTERACTIVE } from '../shader-ripple/shader-ripple';
import frag from './frag.glsl';
import lineFrag from './line-frag.glsl';
import lineVert from './line-vert.glsl';
import { baked } from './reach';

/* One entry of public/thirty/index.json. `yarn thirty:bake` writes it. */
type City = {
  file: string;
  url: string;
  size: number;
  steps: number;
  bytes: number;
  graph: number;
  walk: string;
};

const TEXELS = 256;
const SECONDS = 20;
const FADE = 0.3; // Seconds for the contour to fade in, out or across.
const vert = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

/* A time texture of the contour, a byte for each cell. 255: no area.
   Linear filtering gives the area a smooth edge. */
const reachTexture = () => {
  const t = new THREE.DataTexture(
    new Uint8Array(TEXELS * TEXELS).fill(255),
    TEXELS,
    TEXELS,
    THREE.RedFormat,
  );
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
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
};

/* A baked thirty city behind the page: dots of unmet demand shrink as the
   lines of the transit network appear. It plays for SECONDS, then the last
   frame stays. Without WebGL 2 it draws nothing.
   A click (or a tap) on the background turns the 30-minute contour on or
   off. It shows where the network and a walk reach in 30 min from the cell
   under the cursor, or from the tapped cell. reach-worker.ts finds it. */
const ThirtyBg: FC<ThirtyBgProps> = ({ city, end }) => {
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
      reachOld: { value: reachTexture() },
      reachNew: { value: reachTexture() },
      reachMix: { value: 1 },
      reachShow: { value: 0 },
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
    // most 0.1 s, so the run pauses while the tab is hidden. The loop runs
    // only while the run, a fade or a cross-fade moves.
    let raf = 0;
    let last = performance.now();
    let showTo = 0;
    const moving = () =>
      uniforms.t.value < 1 ||
      uniforms.reachShow.value !== showTo ||
      uniforms.reachMix.value < 1;
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      uniforms.t.value = Math.min(1, uniforms.t.value + dt / SECONDS);
      const show = uniforms.reachShow.value;
      uniforms.reachShow.value =
        show + Math.max(-dt / FADE, Math.min(dt / FADE, showTo - show));
      uniforms.reachMix.value = Math.min(
        1,
        uniforms.reachMix.value + dt / FADE,
      );
      draw();
      raf = moving() ? requestAnimationFrame(frame) : 0;
    };
    const animate = () => {
      if (raf || !uniforms.city.value || !moving()) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    // The contour. The worker starts at the first click. It gets one cell at
    // a time, at most once a frame, and only a cell it has not just had.
    let worker: Worker | null = null;
    let init = () => {};
    let on = false;
    let busy = false;
    let want = -1;
    let sent = -1;
    let ask = 0;
    const send = () => {
      ask = 0;
      if (!worker || busy || want < 0 || want === sent) return;
      busy = true;
      sent = want;
      worker.postMessage(want);
    };
    const aim = (x: number, y: number) => {
      const r = mount.getBoundingClientRect();
      const side = Math.min(r.width, r.height);
      const u = (x - r.left - r.width / 2) / side + 0.5;
      const v = (y - r.top - r.height / 2) / side + 0.5;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return;
      const n = uniforms.cells.value;
      want = Math.floor(v * n) * n + Math.floor(u * n);
      ask ||= requestAnimationFrame(send);
    };
    // A new area cross-fades from the area on screen. While a cross-fade
    // runs, the new area changes in place and the fade goes on.
    const found = ({ data }: MessageEvent<Uint8Array>) => {
      busy = false;
      ask ||= requestAnimationFrame(send);
      if (!on) return;
      if (uniforms.reachMix.value >= 1) {
        const { reachOld, reachNew } = uniforms;
        [reachOld.value, reachNew.value] = [reachNew.value, reachOld.value];
        uniforms.reachMix.value = 0;
      }
      uniforms.reachNew.value.image.data?.set(data);
      uniforms.reachNew.value.needsUpdate = true;
      animate();
    };
    const click = (e: MouseEvent) => {
      const ui = e
        .composedPath()
        .some((node) => node instanceof Element && node.matches(INTERACTIVE));
      if (ui || !uniforms.city.value) return;
      on = !on;
      showTo = on ? 1 : 0;
      // From off, start from no area, so the first area fades in.
      if (on && !uniforms.reachShow.value) {
        uniforms.reachNew.value.image.data?.fill(255);
        uniforms.reachNew.value.needsUpdate = true;
        uniforms.reachMix.value = 1;
      }
      if (on) {
        if (!worker) init();
        sent = -1;
        aim(e.clientX, e.clientY);
      }
      animate();
    };
    const hover = (e: PointerEvent) => {
      if (on && e.pointerType !== 'touch') aim(e.clientX, e.clientY);
    };
    addEventListener('click', click, true);
    addEventListener('pointermove', hover, { passive: true });

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
      const v = new Uint16Array(bytes.buffer, n, (pick.graph - n) / 2);
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
      init = () => {
        worker = new Worker(new URL('./reach-worker.ts', import.meta.url));
        worker.onmessage = found;
        worker.postMessage({
          walk: `/thirty/${pick.walk}`,
          size: 8 * pick.size * pick.size,
          net: new Uint16Array(bytes.buffer.slice(pick.graph)),
        });
      };
      // With reduced motion, or for end, draw the last frame once.
      if (end || matchMedia('(prefers-reduced-motion: reduce)').matches)
        uniforms.t.value = 1;
      drawMask();
      paint.current();
      animate();
    };
    // A background has no place to show an error. It draws nothing.
    load().catch(() => {});

    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(ask);
      worker?.terminate();
      removeEventListener('click', click, true);
      removeEventListener('pointermove', hover);
      observer.disconnect();
      removeEventListener('scroll', scroll, { capture: true });
      changes.disconnect();
      removeEventListener('transitionend', scroll, true);
      cancelAnimationFrame(pending);
      contentMask.texture.value.dispose();
      tightMask.texture.value.dispose();
      uniforms.city.value?.dispose();
      uniforms.reachOld.value.dispose();
      uniforms.reachNew.value.dispose();
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

  return <div ref={mountRef} className="shader-container" aria-hidden="true" />;
};

export { ThirtyBg };
