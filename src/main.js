import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { Fn, uv, texture, vec2, vec3, vec4, length, max } from 'three/tsl';
import './styles.css';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

const PARTICLE_COUNT = 131072;

async function main() {
  const mount = document.querySelector('#app');

  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Este proyecto requiere WebGPU para ejecutar compute shaders.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050607');

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(0, 14, 0.01); 

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  mount.appendChild(renderer.domElement);
  await renderer.init();

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.target.set(0, 0, 0);

  const params = createParameters();
  const simulation = createSimulation({ renderer, scene, params, count: PARTICLE_COUNT });

  const axes = new THREE.AxesHelper(1.5);
  scene.add(axes);

  // SISTEMA DE POST-PROCESAMIENTO
  const renderTarget = new THREE.RenderTarget(innerWidth, innerHeight);

  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  postCamera.position.z = 1; 

  const postMaterial = new THREE.MeshBasicMaterial({
    depthWrite: false,
    depthTest: false
  });
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial);
  postScene.add(postQuad);

  const texTarget = renderTarget.texture;

  postMaterial.colorNode = Fn(() => {
    const vUv = uv();
    const centered = vUv.sub(0.5);
    const dist = length(centered);
    
    const safeDist = max(dist, 0.0001);
    const dir = centered.div(safeDist);

    const distortion = dist.mul(dist).mul(params.fishEye).add(1.0);
    const distortedUv = centered.mul(distortion).add(0.5);

    const ca = params.chromaticAberration;
    const uvR = distortedUv.add(dir.mul(ca));
    const uvG = distortedUv;
    const uvB = distortedUv.sub(dir.mul(ca));

    const r = texture(texTarget, uvR).r;
    const g = texture(texTarget, uvG).g;
    const b = texture(texTarget, uvB).b;
    const baseColor = vec3(r, g, b);

    const bRad = params.bloomStrength;
    const bRadNeg = bRad.mul(-1.0);
    
    const blur1 = texture(texTarget, distortedUv.add(vec2(bRad, bRad))).rgb;
    const blur2 = texture(texTarget, distortedUv.add(vec2(bRadNeg, bRad))).rgb;
    const blur3 = texture(texTarget, distortedUv.add(vec2(bRad, bRadNeg))).rgb;
    const blur4 = texture(texTarget, distortedUv.add(vec2(bRadNeg, bRadNeg))).rgb;
    
    const blur = blur1.add(blur2).add(blur3).add(blur4).div(4.0);
    const bloomColor = baseColor.add(blur.mul(0.9));

    const vignette = dist.mul(params.vignette).negate().add(1.0).clamp(0.0, 1.0);

    return vec4(bloomColor.mul(vignette), 1.0);
  })();

  // UI y Controles
  let paused = false;
  let mode = 'LAB';
  let panel;

  const applyPreset = (id) => {
    params.gravityStrength.value = 6.0;
    params.ring2Gravity.value = 4.0;
    
    if (id === 'disco') {
      params.ringRadius.value = 3.0;
      params.ring2Radius.value = 5.0;
      params.highsTurbulence.value = 0.5;
    } else if (id === 'storm') {
      params.ring2Radius.value = 8.0;
      params.highsTurbulence.value = 15.0;
      params.swirlStrength.value = 6.0;
    }
    panel?.refresh();
  };

  const setMode = (next) => {
    mode = next;
    const lab = mode === 'LAB';
    panel.setVisible(lab);
    axes.visible = lab;
    hud.innerHTML = lab
      ? '<strong>LAB</strong> · P: performance · R: reset'
      : '<strong>PERFORMANCE</strong> · RATÓN: Azules · ESPACIO: Kick Moradas · SHIFT: Freeze';
  };

  panel = createLabPanel({
    params,
    onReset: () => simulation.reset(),
    onPreset: applyPreset,
    onModeChange: () => setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB'),
    onPauseChange: () => paused = !paused
  });

  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.append(hud);
  setMode('LAB');

  // INTERACCIONES
  addEventListener('pointermove', (event) => {
    if (mode === 'PERFORMANCE') {
      const x = (event.clientX / innerWidth) * 2 - 1;
      const y = -(event.clientY / innerHeight) * 2 + 1;
      params.ring2Radius.value = 5.0 + (x * 3.0); 
      params.highsTurbulence.value = (y + 1) * 3.0; 
    }
  });

  // SISTEMA DE TRANSICIÓN SUAVE (LERP) PARA LA BARRA ESPACIADORA
  let isSpaceDown = false;
  let kickProgress = 0.0;
  
  let savedDamping = params.damping.value;
  let baseRingRadius = params.ringRadius.value;
  let baseFishEye = params.fishEye.value;
  let baseAberration = params.chromaticAberration.value;
  let baseBloom = params.bloomStrength.value;
  let baseVignette = params.vignette.value;

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyP') setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB');
    if (event.code === 'KeyR') simulation.reset();
    
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      savedDamping = params.damping.value;
      params.damping.value = 0.95; 
      params.chromaticAberration.value = 0.025;
      panel?.refresh();
    }

    if (event.code === 'Space') {
      event.preventDefault();
      if (!isSpaceDown) {
        isSpaceDown = true;
        // Guardamos la configuración del LAB como punto de partida
        baseRingRadius = params.ringRadius.value;
        baseFishEye = params.fishEye.value;
        baseAberration = params.chromaticAberration.value;
        baseBloom = params.bloomStrength.value;
        baseVignette = params.vignette.value;
      }
    }
  });

  addEventListener('keyup', (event) => {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      params.damping.value = savedDamping; 
      // Si no estamos pulsando espacio, restauramos la aberración cromática
      if (!isSpaceDown) params.chromaticAberration.value = baseAberration;
      panel?.refresh();
    }
    if (event.code === 'Space') {
      isSpaceDown = false;
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderTarget.setSize(innerWidth, innerHeight); 
  });

  simulation.reset();

  // FRAME LOOP
  renderer.setAnimationLoop(() => {
    if (!paused) {
      params.time.value += params.dt.value * params.timeScale.value;
      simulation.stepSimulation();
    }

    // --- LÓGICA DE TRANSICIÓN (0.25 segundos) ---
    // A 60 FPS (dt aprox 1/60), para llegar de 0 a 1 en 0.25s:
    const transitionSpeed = (1 / 60) / 0.25;

    if (isSpaceDown) {
      kickProgress = Math.min(1.0, kickProgress + transitionSpeed);
    } else {
      kickProgress = Math.max(0.0, kickProgress - transitionSpeed);
    }

    // Interpolar (Lerp) todos los valores en cada frame
    params.kickForce.value = THREE.MathUtils.lerp(0.0, 10.0, kickProgress);
    params.ringRadius.value = THREE.MathUtils.lerp(baseRingRadius, 3.8, kickProgress);
    
    // Si Shift no está pisando la aberración, la animamos normalmente
    if (params.damping.value !== 0.95) {
      params.chromaticAberration.value = THREE.MathUtils.lerp(baseAberration, 0.025, kickProgress);
    }
    
    params.fishEye.value = THREE.MathUtils.lerp(baseFishEye, 1.0, kickProgress);
    params.bloomStrength.value = THREE.MathUtils.lerp(baseBloom, 0.020, kickProgress);
    params.vignette.value = THREE.MathUtils.lerp(baseVignette, 2.0, kickProgress);
    // ---------------------------------------------

    orbit.update();

    renderer.setRenderTarget(renderTarget);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(postScene, postCamera);
  });
}

main().catch((error) => {
  console.error(error);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:16px;white-space:pre-wrap;color:#fff;z-index:50';
  pre.textContent = String(error?.stack || error);
  document.body.append(pre);
});