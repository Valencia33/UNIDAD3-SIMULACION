import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  color,
  hash,
  instanceIndex,
  instancedArray,
  max,
  mix,
  mod,
  step,
  uint,
  uv,
  vec3,
  vec4,
  sin,
  cos
} from 'three/tsl';

export function createSimulation({ renderer, scene, params, count = 131072 }) {
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const p = positionBuffer.element(i);
    const v = velocityBuffer.element(i);

    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const r3 = hash(i.add(uint(37)));
    
    p.assign(vec3(r1, r2, r3).sub(0.5).mul(params.boundsSize.mul(0.45)));
    v.assign(vec3(0.0));
  })().compute(count).setName('Initialize Particles');

  const updateParticles = Fn(() => {
    const p = positionBuffer.element(instanceIndex);
    const v = velocityBuffer.element(instanceIndex);

    const dt = params.dt.mul(params.timeScale);
    const force = vec3(0.0).toVar();

    const pID = hash(instanceIndex);
    const isHigh = step(0.5, pID); 
    const isGrave = step(pID, 0.5); 

    const pXZ = p.mul(vec3(1.0, 0.0, 1.0));
    const distXZ = max(pXZ.length(), 0.1);
    const currentDir = pXZ.div(distXZ);
    const swirlDir = vec3(p.z.mul(-1.0), 0.0, p.x).normalize();

    // GRAVES 
    const ringTarget = currentDir.mul(params.ringRadius);
    const graveForce = ringTarget.sub(p).mul(params.gravityStrength);
    graveForce.addAssign(currentDir.mul(params.kickForce));
    graveForce.addAssign(swirlDir.mul(params.swirlStrength));

    // AGUDOS 
    const ring2Target = currentDir.mul(params.ring2Radius);
    const agudoForce = ring2Target.sub(p).mul(params.ring2Gravity);
    agudoForce.addAssign(swirlDir.mul(params.highsSwirl));

    const t = params.time.mul(2.0);
    const noiseForce = vec3(
      sin(p.y.mul(2.0).add(t)),
      cos(p.z.mul(2.0).sub(t)),
      sin(p.x.mul(2.0).add(t))
    );
    agudoForce.addAssign(noiseForce.mul(params.highsTurbulence));

    force.addAssign(graveForce.mul(isGrave));
    force.addAssign(agudoForce.mul(isHigh));

    force.addAssign(v.mul(params.damping).mul(-1.0));

    v.addAssign(force.mul(dt));

    const speed = v.length();
    If(speed.greaterThan(params.maxSpeed), () => {
      v.assign(v.normalize().mul(params.maxSpeed));
    });

    p.addAssign(v.mul(dt));

    const half = params.boundsSize.mul(0.5);
    p.assign(mod(p.add(half), params.boundsSize).sub(half));
  })().compute(count).setName('Update Particles');

  // RENDER: PALETA GALÁCTICA PURA
  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = params.particleSize;

  material.colorNode = Fn(() => {
    const pID = hash(instanceIndex);
    const isHigh = step(0.5, pID);

    const speed = velocityBuffer.toAttribute().length();
    const speedNorm = speed.div(params.maxSpeed).clamp(0.0, 1.0);
    
    // tColor recorre el gradiente basado en velocidad y el ID de la partícula
    const tColor = speedNorm.add(pID.mul(0.5)).mod(1.0);

    // 1. NEBULOSA (Graves): Vacío Oscuro -> Violeta -> Rosa Cósmico
    const cG1 = color('#0a001a');
    const cG2 = color('#6600ff');
    const cG3 = color('#ff0051');
    const rgbGrave = mix(
      mix(cG1, cG2, tColor.mul(2.0).clamp(0.0, 1.0)),
      cG3,
      tColor.sub(0.5).mul(2.0).clamp(0.0, 1.0)
    );

    // 2. ESTRELLAS (Agudos): Espacio Profundo -> Cyan -> Estrella Blanca
    const cA1 = color('#001569');
    const cA2 = color('#00f2ff');
    const cA3 = color('#cb82ff');
    const rgbAgudo = mix(
      mix(cA1, cA2, tColor.mul(2.0).clamp(0.0, 1.0)),
      cA3,
      tColor.sub(0.5).mul(2.0).clamp(0.0, 1.0)
    );

    // Mutación con la tecla C (Intercambia paletas)
    const finalGrave = mix(rgbGrave, rgbAgudo, params.colorPhase);
    const finalAgudo = mix(rgbAgudo, rgbGrave, params.colorPhase);

    const rgbFinal = mix(finalGrave, finalAgudo, isHigh);
    
    // Hacemos que la "nebulosa" base sea muy brillante
    const brightness = speedNorm.mul(1.5).add(0.8); 
    
    return vec4(rgbFinal.mul(brightness), 1.0);
  })();

  material.opacityNode = step(uv().xy.sub(0.5).length(), 0.5);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  function reset() {
    renderer.compute(initParticles);
  }

  function stepSimulation() {
    renderer.compute(updateParticles);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    scene.remove(mesh);
  }

  return { count, positionBuffer, velocityBuffer, reset, stepSimulation, dispose };
}