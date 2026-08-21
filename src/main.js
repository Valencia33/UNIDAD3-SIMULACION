import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
// Importamos la trigonometría necesaria para el caleidoscopio (atan, mod, abs, cos, sin, mix)
import { Fn, uv, texture, vec2, vec3, vec4, length, max, atan, mod, abs, cos, sin, mix, uniform, float } from 'three/tsl';
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
  // Uniforms del Caleidoscopio
  params.kaleidoscope = uniform(0.0);      // mezcla 0..1, disparada con V
  params.kaleidoSegments = uniform(6.0);   // nº de espejos / rebanadas
  params.kaleidoSpin = uniform(0.15);      // velocidad orbital del punto de muestreo
  params.kaleidoOffset = uniform(0.12);    // qué tan lejos del centro se toma la muestra

  const simulation = createSimulation({ renderer, scene, params, count: PARTICLE_COUNT });

  const axes = new THREE.AxesHelper(1.5);
  scene.add(axes);

  // SISTEMA DE POST-PROCESAMIENTO
  const renderTarget = new THREE.RenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType });
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  postCamera.position.z = 1; 

  const postMaterial = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
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

    // =======================================
    // MAGIA CALEIDOSCÓPICA (Coordenadas Polares)
    // =======================================
    // Un caleidoscopio real no refleja el centro exacto de la escena (que ya es
    // simétrico por los anillos de partículas — reflejarlo ahí apenas se nota).
    // En su lugar toma una muestra DESPLAZADA del "tubo" y la hace orbitar en
    // el tiempo, como el fragmento de vidrio que cae dentro del tubo mientras
    // este gira. Eso es lo que le da vida y lo hace ver como un caleidoscopio
    // real en vez de una simetría estática y redundante.
    const orbitAngle = params.time.mul(params.kaleidoSpin);
    const orbitOffset = vec2(cos(orbitAngle), sin(orbitAngle)).mul(params.kaleidoOffset);
    const kSource = centered.add(orbitOffset);

    const angle = atan(kSource.y, kSource.x);
    const radius = length(kSource).mul(distortion);
    const segments = params.kaleidoSegments;
    const slice = float(Math.PI * 2.0).div(segments);
    
    // Convertimos el ángulo en un espejo circular
    const modAngle = mod(angle.add(Math.PI), slice);
    const symAngle = abs(modAngle.sub(slice.div(2.0))); 
    
    // Devolvemos a coordenadas Cartesianas (X, Y)
    const kCentered = vec2(cos(symAngle), sin(symAngle)).mul(radius);
    const kUv = kCentered.add(0.5);
    
    // Mezcla suave entre el UV normal distorsionado y el Caleidoscopio
    const finalUv = mix(distortedUv, kUv, params.kaleidoscope);

    // Aberración cromática usando el mapa final doblado
    const ca = params.chromaticAberration;
    const uvR = finalUv.add(dir.mul(ca));
    const uvG = finalUv;
    const uvB = finalUv.sub(dir.mul(ca));

    const r = texture(texTarget, uvR).r;
    const g = texture(texTarget, uvG).g;
    const b = texture(texTarget, uvB).b;
    const baseColor = vec3(r, g, b);

    // Bloom Exagerado
    const bRad = params.bloomStrength;
    const bRadNeg = bRad.mul(-1.0);
    
    const blur1 = texture(texTarget, finalUv.add(vec2(bRad, bRad))).rgb;
    const blur2 = texture(texTarget, finalUv.add(vec2(bRadNeg, bRad))).rgb;
    const blur3 = texture(texTarget, finalUv.add(vec2(bRad, bRadNeg))).rgb;
    const blur4 = texture(texTarget, finalUv.add(vec2(bRadNeg, bRadNeg))).rgb;
    
    const blur = blur1.add(blur2).add(blur3).add(blur4).div(4.0);
    const bloomColor = baseColor.add(blur.mul(1.5)); 

    const vignette = dist.mul(params.vignette).negate().add(1.0).clamp(0.0, 1.0);

    return vec4(bloomColor.mul(vignette).clamp(0.0, 1.0), 1.0);
  })();

  // baseState es ahora la ÚNICA fuente de verdad para los valores "base": los
  // sliders del panel escriben aquí directamente (ver ui/labPanel.js). Cada
  // frame recalculamos los params reales combinando baseState + los efectos
  // de teclado, así que las teclas de Performance ya NO dependen del modo.
  const baseState = {
    ringRadius: params.ringRadius.value,
    gravityStrength: params.gravityStrength.value,
    ring2Radius: params.ring2Radius.value,
    ring2Gravity: params.ring2Gravity.value,
    swirlStrength: params.swirlStrength.value,
    highsSwirl: params.highsSwirl.value,
    highsTurbulence: params.highsTurbulence.value,
    fishEye: params.fishEye.value,
    chromaticAberration: params.chromaticAberration.value,
    bloomStrength: params.bloomStrength.value,
    vignette: params.vignette.value,
    damping: params.damping.value
  };

  // ESTADO DE TECLAS (ya no se filtran por modo: ver keydown/keyup más abajo)
  let isSpaceDown = false;
  let isCDown = false;
  let isZDown = false;
  let isXDown = false;
  let isVDown = false;
  let isShiftDown = false;
  
  let kickProgress = 0.0;
  let colorProgress = 0.0;
  let vProgress = 0.0;

  // El ratón sigue controlando Agudos SOLO en Performance: si también lo hiciera
  // en LAB, cada movimiento del mouse pelearía con lo que acabas de ajustar
  // en los sliders. Guardamos su último valor aparte en vez de pisar el param.
  let mouseRing2Radius = null;
  let mouseHighsTurbulence = null;

  let paused = false;
  let mode = 'LAB';
  let panel;

  const applyPreset = (id) => {
    baseState.gravityStrength = 6.0;
    baseState.ring2Gravity = 4.0;
    
    if (id === 'disco') {
      baseState.ringRadius = 3.0;
      baseState.ring2Radius = 5.0;
      baseState.highsTurbulence = 0.0;
    } else if (id === 'storm') {
      baseState.ring2Radius = 8.0;
      baseState.highsTurbulence = 15.0;
      baseState.swirlStrength = 6.0;
    }
    panel?.refresh();
  };

  const setMode = (next) => {
    mode = next;
    const lab = mode === 'LAB';
    panel.setVisible(lab);
    axes.visible = lab;
    hud.innerHTML = lab
      ? '<strong>LAB</strong> · P: performance · R: reset · Espacio/Shift/Z/X/C/V funcionan aquí también'
      : '<strong>PERF:</strong> RATÓN (Agudos) · ESPACIO (Kick) · SHIFT (Slow-Mo) · Z/X (Físicas) · V (Caleidoscopio) · C (Color)';
  };

  panel = createLabPanel({
    params,
    baseState,
    onReset: () => simulation.reset(),
    onPreset: applyPreset,
    onModeChange: () => setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB'),
    onPauseChange: () => paused = !paused
  });

  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.append(hud);
  setMode('LAB');

  addEventListener('pointermove', (event) => {
    if (mode === 'PERFORMANCE') {
      const normX = event.clientX / innerWidth;
      const normY = event.clientY / innerHeight;
      
      mouseRing2Radius = THREE.MathUtils.lerp(2.0, 12.0, normX); 
      
      const invertedY = 1.0 - normY;
      mouseHighsTurbulence = Math.max(0.0, Math.pow(invertedY, 3) * 40.0); 
    }
  });

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyP') setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB');
    if (event.code === 'KeyR') simulation.reset();

    // Estos disparadores ahora funcionan igual en LAB y en PERFORMANCE.
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') isShiftDown = true;
    if (event.code === 'KeyZ') isZDown = true;
    if (event.code === 'KeyX') isXDown = true;
    if (event.code === 'KeyC') isCDown = true;
    if (event.code === 'KeyV') isVDown = true;
    if (event.code === 'Space') {
      event.preventDefault();
      isSpaceDown = true;
    }
  });

  addEventListener('keyup', (event) => {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') isShiftDown = false;
    if (event.code === 'KeyZ') isZDown = false;
    if (event.code === 'KeyX') isXDown = false;
    if (event.code === 'KeyC') isCDown = false;
    if (event.code === 'KeyV') isVDown = false;
    if (event.code === 'Space') isSpaceDown = false;
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderTarget.setSize(innerWidth, innerHeight); 
  });

  // ==========================================
  // SCRIPT DE PRUEBAS BASE (TECLAS 1, 2, 3, 4, 5 y 0)
  // ==========================================
  window.addEventListener('keydown', (event) => {
    // Usamos event.key para que funcione con los números de arriba y el teclado numérico
    const key = event.key;
    let changed = false;

    if (key === '1') {
      console.log("Prueba 1: Magnitud Cero (Calma total)");
      params.gravityStrength.value = 0.0;
      params.swirlStrength.value = 0.0;
      params.highsSwirl.value = 0.0;
      params.highsTurbulence.value = 0.0;
      changed = true;
    }
    
    if (key === '2') {
      console.log("Prueba 2: Inversión de Signo (Repulsión)");
      params.gravityStrength.value = -6.0;
      changed = true;
    }
    
    if (key === '3') {
      console.log("Prueba 3: Límite de Velocidad");
      params.maxSpeed.value = 0.5; // Todo se mueve ultra lento
      params.swirlStrength.value = 50.0; // Fuerza brutal para forzar el límite
      changed = true;
    }
    
    if (key === '4') {
      console.log("Prueba 4: Turbulencia Aislada");
      params.gravityStrength.value = 0.0; 
      params.swirlStrength.value = 0.0;
      params.highsTurbulence.value = 40.0; // Solo caos en agudos
      changed = true;
    }
    
    if (key === '5') {
      console.log("Prueba 5: Sin Fricción (Caos inestable)");
      params.damping.value = 0.0;
      changed = true;
    }

    if (key === '0') {
      console.log("RESET DE PRUEBAS");
      params.gravityStrength.value = 6.0;
      params.swirlStrength.value = 2.0;
      params.highsSwirl.value = 3.0;
      params.highsTurbulence.value = 0.0;
      params.maxSpeed.value = 12.0;
      params.damping.value = 0.15;
      changed = true;
    }

    // El truco maestro: forzar la actualización en la "base intocable" y mover los sliders
    if (changed) {
      baseState.gravityStrength = params.gravityStrength.value;
      baseState.swirlStrength = params.swirlStrength.value;
      baseState.highsSwirl = params.highsSwirl.value;
      baseState.highsTurbulence = params.highsTurbulence.value;
      baseState.damping = params.damping.value;
      
      if (panel) panel.refresh(); // Esto actualiza la interfaz visualmente
    }
  });
  // ==========================================

  simulation.reset();

  renderer.setAnimationLoop(() => {
    if (!paused) {
      params.time.value += params.dt.value * params.timeScale.value;
      simulation.stepSimulation();
    }

    // ---- Progreso suave de los triggers de teclado (corre en ambos modos) ----
    const dtFrames = 1 / 60;
    if (isSpaceDown) kickProgress = Math.min(1.0, kickProgress + (dtFrames / 0.15));
    else kickProgress = Math.max(0.0, kickProgress - (dtFrames / 0.25));

    if (isCDown) colorProgress = Math.min(1.0, colorProgress + (dtFrames / 0.2));
    else colorProgress = Math.max(0.0, colorProgress - (dtFrames / 0.2));

    if (isVDown) vProgress = Math.min(1.0, vProgress + (dtFrames / 0.15));
    else vProgress = Math.max(0.0, vProgress - (dtFrames / 0.25));

    // ---- Combinamos baseState (sliders/presets) + efectos de teclado ----
    let curRingRadius = baseState.ringRadius;
    let curGrav = baseState.gravityStrength;
    let curGrav2 = baseState.ring2Gravity;
    let curRing2Radius = (mode === 'PERFORMANCE' && mouseRing2Radius !== null)
      ? mouseRing2Radius
      : baseState.ring2Radius;
    let curHighsTurbulence = (mode === 'PERFORMANCE' && mouseHighsTurbulence !== null)
      ? mouseHighsTurbulence
      : baseState.highsTurbulence;
    let curSwirl = baseState.swirlStrength;
    let curHighsSwirl = baseState.highsSwirl;
    let curFishEye = baseState.fishEye;
    let curAberration = baseState.chromaticAberration;
    let curBloom = baseState.bloomStrength;
    let curVignette = baseState.vignette;
    let curDamping = baseState.damping;
    let curTimeScale = 1.0;

    if (isShiftDown) {
      curDamping = 0.4;
      curTimeScale = 0.05;
    }
    if (isZDown) {
      curSwirl = -25.0;
      curHighsSwirl = -30.0;
    }
    if (isXDown) {
      curRingRadius = 0.1;
      curRing2Radius = 0.1;
      curGrav = 35.0;
      curGrav2 = 35.0;
      curFishEye = -1.2;
    }

    params.kickForce.value = THREE.MathUtils.lerp(0.0, 15.0, kickProgress);
    if (!isXDown) {
      curRingRadius = THREE.MathUtils.lerp(curRingRadius, 4.5, kickProgress);
      curFishEye = THREE.MathUtils.lerp(curFishEye, 2.5, kickProgress);
    }
    if (!isShiftDown) {
      curAberration = THREE.MathUtils.lerp(curAberration, 0.12, kickProgress);
    }
    
    curBloom = THREE.MathUtils.lerp(curBloom, 0.050, kickProgress);
    curVignette = THREE.MathUtils.lerp(curVignette, 2.0, kickProgress);

    params.ringRadius.value = curRingRadius;
    params.gravityStrength.value = curGrav;
    params.ring2Gravity.value = curGrav2;
    params.ring2Radius.value = curRing2Radius;
    params.swirlStrength.value = curSwirl;
    params.highsSwirl.value = curHighsSwirl;
    params.highsTurbulence.value = curHighsTurbulence;
    params.fishEye.value = curFishEye;
    params.chromaticAberration.value = curAberration;
    params.bloomStrength.value = curBloom;
    params.vignette.value = curVignette;
    params.damping.value = curDamping;
    params.timeScale.value = curTimeScale;
    params.colorPhase.value = THREE.MathUtils.lerp(0.0, 1.0, colorProgress);
    params.kaleidoscope.value = THREE.MathUtils.lerp(0.0, 1.0, vProgress);

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