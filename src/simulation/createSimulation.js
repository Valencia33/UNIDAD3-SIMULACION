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

    // EL SPLIT DE FRECUENCIAS
    const pID = hash(instanceIndex);
    const isHigh = step(0.5, pID); 
    const isGrave = step(pID, 0.5); 

    const pXZ = p.mul(vec3(1.0, 0.0, 1.0));
    const distXZ = max(pXZ.length(), 0.1);
    const currentDir = pXZ.div(distXZ);
    const swirlDir = vec3(p.z.mul(-1.0), 0.0, p.x).normalize();

    // GRAVES (Anillo Morado)
    const ringTarget = currentDir.mul(params.ringRadius);
    const graveForce = ringTarget.sub(p).mul(params.gravityStrength);
    graveForce.addAssign(currentDir.mul(params.kickForce));
    graveForce.addAssign(swirlDir.mul(params.swirlStrength));

    // AGUDOS (Anillo Azul)
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

    // APLICAR
    force.addAssign(graveForce.mul(isGrave));
    force.addAssign(agudoForce.mul(isHigh));

    // FRICCIÓN
    force.addAssign(v.mul(params.damping).mul(-1.0));

    // INTEGRACIÓN
    v.addAssign(force.mul(dt));

    const speed = v.length();
    If(speed.greaterThan(params.maxSpeed), () => {
      v.assign(v.normalize().mul(params.maxSpeed));
    });

    p.addAssign(v.mul(dt));

    const half = params.boundsSize.mul(0.5);
    p.assign(mod(p.add(half), params.boundsSize).sub(half));
  })().compute(count).setName('Update Particles');

  // RENDER (Color Palette)
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
    const isGrave = step(pID, 0.5);

    const speed = velocityBuffer.toAttribute().length();
    const speedNorm = speed.div(params.maxSpeed).clamp(0.0, 1.0);
    const tColor = speedNorm.mul(0.5).add(pID.mul(0.2));

    const aG = vec3(0.5, 0.1, 0.6);
    const bG = vec3(0.4, 0.2, 0.4);
    const cG = vec3(1.0, 1.0, 1.0);
    const dG = vec3(0.0, 0.33, 0.67);
    const rgbGrave = aG.add(bG.mul(cos(cG.mul(tColor).add(dG).mul(6.28318))));

    const aA = vec3(0.1, 0.6, 0.8);
    const bA = vec3(0.1, 0.4, 0.4);
    const cA = vec3(1.0, 1.0, 1.0);
    const dA = vec3(0.5, 0.2, 0.0);
    const rgbAgudo = aA.add(bA.mul(cos(cA.mul(tColor).add(dA).mul(6.28318))));

    const rgbFinal = mix(rgbGrave, rgbAgudo, isHigh);
    const brightness = speedNorm.mul(1.5).add(0.5);
    
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