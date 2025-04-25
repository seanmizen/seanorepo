import { useEffect, useRef, useContext } from "react";
import * as THREE from "three";
import { OrbitControls, GPUComputationRenderer } from "three-stdlib";
import Stats from "stats.js";
import { ThemeContext } from "../../providers/Theme";

import bgImage from "./IMG_4011_crop2.jpeg";
import particleTex from "./particle2.png";

// GLSL sources – no “?raw”
import vert from "./vert-stippling.glsl";
import frag from "./frag-stippling.glsl";
import posSim from "./frag-stippling-pos.glsl";
import velSim from "./frag-stippling-vel.glsl";

const ShaderSean = () => {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const materialRef = useRef(null);

  const { theme } = useContext(ThemeContext);

  const { width, height } = { width: 500, height: 500 };

  const ripple = useRef({
    time: null,
    origin: new THREE.Vector2(width / 2, height / 2),
  });

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.u_color.value.set(
        theme === "light" ? 0x000000 : 0x99bbff
      );
    }
  }, [theme]);

  useEffect(() => {
    mountRef.current?.replaceChildren();
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
    // mountRef.current.appendChild(stats.dom);

    const simSize = 64;
    const gpuSim = new GPUComputationRenderer(simSize, simSize, renderer);

    const posTex = gpuSim.createTexture();
    const velTex = gpuSim.createTexture();
    seed(posTex.image.data, velTex.image.data);

    const posVar = gpuSim.addVariable("u_positionTexture", posSim, posTex);
    const velVar = gpuSim.addVariable("u_velocityTexture", velSim, velTex);

    gpuSim.setVariableDependencies(posVar, [posVar, velVar]);
    gpuSim.setVariableDependencies(velVar, [posVar, velVar]);

    const shared = { u_dt: { value: 0.78 }, u_nActiveParticles: { value: 10 } };
    Object.assign(posVar.material.uniforms, shared);
    Object.assign(velVar.material.uniforms, {
      ...shared,
      u_bgTexture: { value: new THREE.TextureLoader().load(bgImage) },
      u_textureOffset: { value: new THREE.Vector2(12, 12) },
    });

    if (gpuSim.init()) throw new Error("GPUComputation init failed");

    const n = simSize * simSize;
    const geometry = new THREE.BufferGeometry();
    const indices = new Float32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    geometry.setAttribute("a_index", new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(3 * n), 3)
    );

    const uniforms = {
      u_width: { value: simSize },
      u_height: { value: simSize },
      u_particleSize: { value: 40 * Math.min(devicePixelRatio, 2) },
      u_nActiveParticles: { value: 1 },
      u_positionTexture: { value: null },
      u_bgTexture: velVar.material.uniforms.u_bgTexture,
      u_textureOffset: velVar.material.uniforms.u_textureOffset,
      u_texture: { value: new THREE.TextureLoader().load(particleTex) },
      u_color: {
        value: new THREE.Color(theme === "light" ? 0x000000 : 0x99bbff),
      },
      u_rippleOrigin: { value: ripple.current.origin.clone() },
      u_rippleTime: { value: -1 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vert,
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
    addEventListener("resize", onResize);

    const startRipple = (e) => {
      ripple.current.time = performance.now();

      const canvas = renderer.domElement;
      const bounds = canvas.getBoundingClientRect();

      // Allow clicks outside canvas
      const clampedX = Math.max(
        0,
        Math.min(e.clientX - bounds.left, bounds.width)
      );
      const clampedY = Math.max(
        0,
        Math.min(e.clientY - bounds.top, bounds.height)
      );

      const x = (clampedX / bounds.width) * canvas.width;
      const y = (clampedY / bounds.height) * canvas.height;

      ripple.current.origin.set(x, canvas.height - y);
    };

    window.addEventListener("click", startRipple);

    let frames = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      gpuSim.compute();

      const now = performance.now();

      if (ripple.current.time != null)
        uniforms.u_rippleTime.value = (now - ripple.current.time) / 1000;
      else uniforms.u_rippleTime.value = -1;

      uniforms.u_rippleOrigin.value.copy(ripple.current.origin);

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
      removeEventListener("resize", onResize);
      mountRef.current?.removeChild(renderer.domElement) || null;
      window.removeEventListener("click", startRipple);
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} />;
};

const seed = (pos, vel) => {
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

export { ShaderSean };
