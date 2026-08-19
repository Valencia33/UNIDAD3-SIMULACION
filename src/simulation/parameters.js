import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export function createParameters() {
  return {
    dt: uniform(1 / 60),
    timeScale: uniform(1.0),
    initialSpeed: uniform(0.35),
    maxSpeed: uniform(12.0),
    boundsSize: uniform(10.0),
    particleSize: uniform(0.04),

    time: uniform(0.0),

    // GRAVES (Anillo Morado)
    ringRadius: uniform(3.0),
    gravityStrength: uniform(6.0),
    swirlStrength: uniform(2.0),
    kickForce: uniform(0.0), 

    // AGUDOS (Anillo Azul)
    ring2Radius: uniform(5.0), 
    ring2Gravity: uniform(4.0), 
    highsSwirl: uniform(3.0), 
    highsTurbulence: uniform(0.0),

    // GLOBALES
    damping: uniform(0.15),
    colorPhase: uniform(0.0), // 0.0 Normal, 1.0 Mutación Galáctica

    // POST-PROCESAMIENTO
    fishEye: uniform(0.25),
    chromaticAberration: uniform(0.008), 
    bloomStrength: uniform(0.006), 
    vignette: uniform(0.85) 
  };
}