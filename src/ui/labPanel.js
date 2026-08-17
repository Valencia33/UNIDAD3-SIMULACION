function rangeRow(parent, label, object, key, min, max, step, onInput, getValue) {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const lab = document.createElement('label');
  const name = document.createElement('span');
  const value = document.createElement('span');
  value.className = 'value';
  name.textContent = label;
  lab.append(name, value);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(object[key]);
  const refresh = () => {
    object[key] = Number(input.value);
    value.textContent = Number(input.value).toFixed(step < 0.01 ? 3 : 2);
    onInput?.(object[key]);
  };
  input.addEventListener('input', refresh);
  refresh();
  wrap.append(lab, input);
  parent.append(wrap);
  return {
    input,
    refresh() {
      if (getValue) {
        const next = Number(getValue());
        object[key] = next;
        input.value = String(next);
        value.textContent = next.toFixed(step < 0.01 ? 3 : 2);
      }
    }
  };
}

function button(parent, label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
}

export function createLabPanel({ params, onReset, onPreset, onModeChange, onPauseChange }) {
  const refreshers = [];
  const panel = document.createElement('aside');
  panel.className = 'panel';
  
  panel.innerHTML = `
    <style>
      .desc { font-size: 10px; color: #8892b0; margin-top: -6px; margin-bottom: 12px; line-height: 1.3; }
    </style>
    <h1>U3 · LesAlpx Instrument</h1>
    <p>Post-Procesamiento Activo.</p>
  `;

  const state = {
    ringRadius: params.ringRadius.value,
    gravityStrength: params.gravityStrength.value,
    swirlStrength: params.swirlStrength.value,
    
    ring2Radius: params.ring2Radius.value,
    ring2Gravity: params.ring2Gravity.value,
    highsSwirl: params.highsSwirl.value,
    highsTurbulence: params.highsTurbulence.value,
    
    damping: params.damping.value,

    fishEye: params.fishEye.value,
    chromaticAberration: params.chromaticAberration.value,
    bloomStrength: params.bloomStrength.value,
    vignette: params.vignette.value
  };

  const gravesGroup = document.createElement('div');
  gravesGroup.className = 'group';
  gravesGroup.innerHTML = `
    <h2>1. Graves (Moradas)</h2>
    <p class="desc">Conforma la base rítmica. Espacio hace estallar este anillo (kick).</p>
  `;
  panel.append(gravesGroup);
  refreshers.push(rangeRow(gravesGroup, 'Radio Anillo', state, 'ringRadius', 0, 10, 0.1, (v) => params.ringRadius.value = v, () => params.ringRadius.value));
  refreshers.push(rangeRow(gravesGroup, 'Atracción a Base', state, 'gravityStrength', 0, 10, 0.1, (v) => params.gravityStrength.value = v, () => params.gravityStrength.value));
  refreshers.push(rangeRow(gravesGroup, 'Vel. Rotación', state, 'swirlStrength', -10, 10, 0.1, (v) => params.swirlStrength.value = v, () => params.swirlStrength.value));

  const agudosGroup = document.createElement('div');
  agudosGroup.className = 'group';
  agudosGroup.innerHTML = `
    <h2>2. Agudos (Azules)</h2>
    <p class="desc">En Performance, el Ratón controla su radio y turbulencia.</p>
  `;
  panel.append(agudosGroup);
  refreshers.push(rangeRow(agudosGroup, 'Radio Anillo 2', state, 'ring2Radius', 0, 15, 0.1, (v) => params.ring2Radius.value = v, () => params.ring2Radius.value));
  refreshers.push(rangeRow(agudosGroup, 'Atracción a Anillo 2', state, 'ring2Gravity', 0, 10, 0.1, (v) => params.ring2Gravity.value = v, () => params.ring2Gravity.value));
  refreshers.push(rangeRow(agudosGroup, 'Caos / Turbulencia', state, 'highsTurbulence', 0, 20, 0.1, (v) => params.highsTurbulence.value = v, () => params.highsTurbulence.value));

  const physicsGroup = document.createElement('div');
  physicsGroup.className = 'group';
  physicsGroup.innerHTML = `
    <h2>3. Globales</h2>
  `;
  panel.append(physicsGroup);
  refreshers.push(rangeRow(physicsGroup, 'Fricción (Damping)', state, 'damping', 0, 1, 0.01, (v) => params.damping.value = v, () => params.damping.value));

  const postGroup = document.createElement('div');
  postGroup.className = 'group';
  postGroup.innerHTML = `
    <h2>4. Lente (Post-Procesamiento)</h2>
    <p class="desc">Distorsión de barril, separación RGB y resplandor.</p>
  `;
  panel.append(postGroup);
  refreshers.push(rangeRow(postGroup, 'Fish Eye', state, 'fishEye', -0.5, 1.0, 0.01, (v) => params.fishEye.value = v, () => params.fishEye.value));
  refreshers.push(rangeRow(postGroup, 'Aberración Crom.', state, 'chromaticAberration', 0, 0.05, 0.001, (v) => params.chromaticAberration.value = v, () => params.chromaticAberration.value));
  refreshers.push(rangeRow(postGroup, 'Bloom (Glow)', state, 'bloomStrength', 0, 0.02, 0.001, (v) => params.bloomStrength.value = v, () => params.bloomStrength.value));
  refreshers.push(rangeRow(postGroup, 'Viñeta', state, 'vignette', 0, 2.0, 0.05, (v) => params.vignette.value = v, () => params.vignette.value));

  const actions = document.createElement('div');
  actions.className = 'group';
  actions.innerHTML = '<h2>Acciones</h2>';
  panel.append(actions);
  button(actions, 'Reset', onReset);
  button(actions, 'LAB / PERFORMANCE', () => onModeChange());

  document.body.append(panel);

  return {
    element: panel,
    setVisible(visible) { panel.classList.toggle('hidden', !visible); },
    refresh() { for (const item of refreshers) item.refresh(); }
  };
}