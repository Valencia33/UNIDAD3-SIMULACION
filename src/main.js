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

  const postMaterial = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false });
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

  // === SINTETIZADOR DE BAJOS ===
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContext();

  const BPM = 122; 
  const stepDuration = (60 / BPM) / 4; 
  let nextStepTime = 0;
  let currentStepIndex = 0;
  let isAudioReady = false;

  document.body.addEventListener('click', () => {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    if (!isAudioReady) {
      isAudioReady = true;
      nextStepTime = audioCtx.currentTime + 0.1; 
    }
  });
  
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.5; // Un poco de más volumen para los graves
  masterGain.connect(audioCtx.destination);

  let synthFlash = 0.0; 

  function playSynth(frequency, time) {
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const vca = audioCtx.createGain();

    // Textura principal y Sub-bajo
    osc1.type = 'sawtooth';
    osc1.frequency.value = frequency;
    osc2.type = 'square';
    osc2.frequency.value = frequency * 0.5; // Una octava por debajo exacto

    filter.type = 'lowpass';
    filter.Q.value = 4.0; // Resonancia controlada para un "Acid Pluck"

    // Envolvente de volumen percusiva
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(0.6, time + 0.01);
    vca.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

    // Envolvente de filtro (hace que suene "ácido" y brillante al inicio)
    filter.frequency.setValueAtTime(50, time);
    filter.frequency.exponentialRampToValueAtTime(1200, time + 0.02);
    filter.frequency.exponentialRampToValueAtTime(100, time + 0.25);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(vca);
    vca.connect(masterGain); 

    osc1.start(time);
    osc2.start(time);
    
    osc1.stop(time + 0.3);
    osc2.stop(time + 0.3);
  }

  // Patrones de Bajos en Do Menor (Dos octavas más graves)
  const arpPatterns = {
    'KeyA': [65.41, 98.00, 77.78, 130.81], // Cm
    'KeyS': [77.78, 116.54, 98.00, 155.56], // EbMaj
    'KeyD': [87.31, 130.81, 103.83, 174.61], // Fm
    'KeyF': [98.00, 146.83, 116.54, 196.00], // Gm
    'KeyG': [116.54, 174.61, 146.83, 233.08]  // BbMaj
  };

  const activeKeys = {
    'KeyA': false, 'KeyS': false, 'KeyD': false, 'KeyF': false, 'KeyG': false
  };
  // ========================================================

  let paused = false;
  let mode = 'LAB';
  let panel;

  const applyPreset = (id) => {
    params.gravityStrength.value = 6.0;
    params.ring2Gravity.value = 4.0;
    
    if (id === 'disco') {
      params.ringRadius.value = 3.0;
      params.ring2Radius.value = 5.0;
      params.highsTurbulence.value = 0.0;
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
      : '<strong>PERF:</strong> RATÓN (Azules) · ESPACIO (Kick) · SHIFT (Slow-Mo) · Z/X/C (Lentes) · A/S/D/F/G (Arpegio Bajo)';
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

  addEventListener('pointermove', (event) => {
    if (mode === 'PERFORMANCE') {
      const x = (event.clientX / innerWidth) * 2 - 1; 
      const y = -(event.clientY / innerHeight) * 2 + 1; 
      
      params.ring2Radius.value = 6.0 + (x * 5.0); 
      params.highsTurbulence.value = Math.max(0.0, y * 20.0); 
    }
  });

  let isSpaceDown = false;
  let kickProgress = 0.0;
  
  let savedDamping = params.damping.value;
  let baseRingRadius = params.ringRadius.value;
  let baseRing2Radius = params.ring2Radius.value;
  let baseGrav = params.gravityStrength.value;
  let baseGrav2 = params.ring2Gravity.value;
  let baseSwirl = params.swirlStrength.value;
  let baseHighsSwirl = params.highsSwirl.value;

  let baseFishEye = params.fishEye.value;
  let baseAberration = params.chromaticAberration.value;
  let baseBloom = params.bloomStrength.value;
  let baseVignette = params.vignette.value;

  addEventListener('keydown', (event) => {
    if (event.repeat) return;

    if (arpPatterns[event.code] && mode === 'PERFORMANCE') {
      activeKeys[event.code] = true;
    }

    if (event.code === 'KeyP') setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB');
    if (event.code === 'KeyR') simulation.reset();
    
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      savedDamping = params.damping.value;
      params.damping.value = 0.4; 
      params.timeScale.value = 0.2; 
      params.chromaticAberration.value = 0.025; 
      panel?.refresh();
    }

    if (event.code === 'KeyZ') {
      baseSwirl = params.swirlStrength.value;
      baseHighsSwirl = params.highsSwirl.value;
      params.swirlStrength.value = -15.0; 
      params.highsSwirl.value = -20.0;
      panel?.refresh();
    }

    if (event.code === 'KeyX') {
      baseRingRadius = params.ringRadius.value;
      baseRing2Radius = params.ring2Radius.value;
      baseGrav = params.gravityStrength.value;
      baseGrav2 = params.ring2Gravity.value;

      params.ringRadius.value = 0.1;
      params.ring2Radius.value = 0.1;
      params.gravityStrength.value = 25.0; 
      params.ring2Gravity.value = 25.0;
      params.fishEye.value = -0.5; 
      panel?.refresh();
    }

    if (event.code === 'KeyC') {
      params.colorPhase.value = 1.0; 
    }

    if (event.code === 'Space') {
      event.preventDefault();
      if (!isSpaceDown) {
        isSpaceDown = true;
        baseRingRadius = params.ringRadius.value;
        baseFishEye = params.fishEye.value;
        baseAberration = params.chromaticAberration.value;
        baseBloom = params.bloomStrength.value;
        baseVignette = params.vignette.value;
      }
    }
  });

  addEventListener('keyup', (event) => {
    if (arpPatterns[event.code]) {
      activeKeys[event.code] = false;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      params.damping.value = savedDamping; 
      params.timeScale.value = 1.0; 
      if (!isSpaceDown) params.chromaticAberration.value = baseAberration;
      panel?.refresh();
    }
    
    if (event.code === 'KeyZ') {
      params.swirlStrength.value = baseSwirl; 
      params.highsSwirl.value = baseHighsSwirl;
      panel?.refresh();
    }

    if (event.code === 'KeyX') {
      params.ringRadius.value = baseRingRadius;
      params.ring2Radius.value = baseRing2Radius;
      params.gravityStrength.value = baseGrav; 
      params.ring2Gravity.value = baseGrav2;
      params.fishEye.value = baseFishEye;
      panel?.refresh();
    }

    if (event.code === 'KeyC') {
      params.colorPhase.value = 0.0; 
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

  renderer.setAnimationLoop(() => {
    if (!paused) {
      params.time.value += params.dt.value * params.timeScale.value;
      simulation.stepSimulation();
    }

    // === SCHEDULER DEL ARPEGIADOR ===
    if (isAudioReady && audioCtx.state === 'running') {
      while (nextStepTime < audioCtx.currentTime + 0.1) {
        let notePlayedThisStep = false;
        
        for (const [key, isPressed] of Object.entries(activeKeys)) {
          if (isPressed) {
            const pattern = arpPatterns[key];
            const noteFreq = pattern[currentStepIndex % pattern.length];
            playSynth(noteFreq, nextStepTime);
            notePlayedThisStep = true;
          }
        }

        if (notePlayedThisStep) {
          synthFlash = 1.0; 
        }

        nextStepTime += stepDuration; 
        currentStepIndex++;
      }
    }
    // ================================

    const transitionSpeed = (1 / 60) / 0.25;

    if (isSpaceDown) {
      kickProgress = Math.min(1.0, kickProgress + transitionSpeed);
    } else {
      kickProgress = Math.max(0.0, kickProgress - transitionSpeed);
    }

    synthFlash = Math.max(0.0, synthFlash - 0.05);

    params.kickForce.value = THREE.MathUtils.lerp(0.0, 10.0, kickProgress);
    
    if (params.ringRadius.value !== 0.1) {
        params.ringRadius.value = THREE.MathUtils.lerp(baseRingRadius, 3.8, kickProgress);
    }
    
    if (params.damping.value !== 0.4) { 
      params.chromaticAberration.value = THREE.MathUtils.lerp(baseAberration, 0.025, kickProgress);
    }
    
    if (params.fishEye.value !== -0.5) {
        params.fishEye.value = THREE.MathUtils.lerp(baseFishEye, 1.0, kickProgress);
    }

    params.bloomStrength.value = THREE.MathUtils.lerp(baseBloom, 0.020, kickProgress) + (synthFlash * 0.025);
    params.vignette.value = THREE.MathUtils.lerp(baseVignette, 2.0, kickProgress);

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