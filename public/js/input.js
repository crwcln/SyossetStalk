// Keyboard + touch controls. One shared state object the game loop reads every frame.
export function createInput() {
  const st = {
    keys: new Set(),
    stick: { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 },
    sneak: false,
    sprintHeld: false,
    grabHeld: false,
  };

  const zone = document.getElementById('stickZone');
  const base = document.getElementById('stickBase');
  const knob = document.getElementById('stickKnob');
  const bSneak = document.getElementById('btnSneak');
  const bSprint = document.getElementById('btnSprint');
  const bGrab = document.getElementById('btnGrab');

  const RADIUS = 46;

  function placeBase(x, y) {
    if (!base) return;
    const r = zone.getBoundingClientRect();
    base.style.left = (x - r.left) + 'px';
    base.style.top = (y - r.top) + 'px';
    base.classList.remove('hidden');
  }

  function moveKnob(dx, dy) {
    if (!knob) return;
    const m = Math.hypot(dx, dy);
    const k = m > RADIUS ? RADIUS / m : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  function endStick() {
    st.stick.active = false;
    st.stick.id = null;
    st.stick.x = 0;
    st.stick.y = 0;
    if (base) base.classList.add('hidden');
    if (knob) knob.style.transform = 'translate(0,0)';
  }

  if (zone) {
    zone.addEventListener('pointerdown', (e) => {
      if (st.stick.active) return;
      st.stick.active = true;
      st.stick.id = e.pointerId;
      st.stick.ox = e.clientX;
      st.stick.oy = e.clientY;
      placeBase(e.clientX, e.clientY);
      zone.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (!st.stick.active || e.pointerId !== st.stick.id) return;
      const dx = e.clientX - st.stick.ox;
      const dy = e.clientY - st.stick.oy;
      const m = Math.hypot(dx, dy);
      const clamped = m > RADIUS ? RADIUS / m : 1;
      st.stick.x = (dx * clamped) / RADIUS;
      st.stick.y = (dy * clamped) / RADIUS;
      if (m < 6) { st.stick.x = 0; st.stick.y = 0; }
      moveKnob(dx, dy);
      e.preventDefault();
    });
    const up = (e) => {
      if (e.pointerId !== st.stick.id) return;
      endStick();
      e.preventDefault();
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('pointerleave', (e) => {
      if (st.stick.active && e.pointerId === st.stick.id && e.buttons === 0) endStick();
    });
  }

  function setSneak(v) {
    st.sneak = v;
    if (bSneak) bSneak.classList.toggle('on', v);
  }

  bSneak?.addEventListener('click', () => setSneak(!st.sneak));

  const sprintOn = (e) => { st.sprintHeld = true; bSprint?.classList.add('on'); e?.preventDefault?.(); };
  const sprintOff = (e) => { st.sprintHeld = false; bSprint?.classList.remove('on'); e?.preventDefault?.(); };
  bSprint?.addEventListener('pointerdown', sprintOn);
  bSprint?.addEventListener('pointerup', sprintOff);
  bSprint?.addEventListener('pointercancel', sprintOff);
  bSprint?.addEventListener('pointerleave', sprintOff);

  const grabOn = (e) => {
    st.grabHeld = true;
    if (bGrab) bGrab.classList.add('on');
    e?.preventDefault?.();
  };
  const grabOff = (e) => {
    st.grabHeld = false;
    if (bGrab) bGrab.classList.remove('on');
    e?.preventDefault?.();
  };
  bGrab?.addEventListener('pointerdown', grabOn);
  bGrab?.addEventListener('pointerup', grabOff);
  bGrab?.addEventListener('pointercancel', grabOff);
  bGrab?.addEventListener('pointerleave', grabOff);

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    st.keys.add(k);
    if (k === 'c') setSneak(!st.sneak);
    if (k === 'shift') st.sprintHeld = true;
    if (k === 'e' || k === ' ') st.grabHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    st.keys.delete(k);
    if (k === 'shift') st.sprintHeld = false;
    if (k === 'e' || k === ' ') st.grabHeld = false;
  });
  window.addEventListener('blur', () => {
    st.keys.clear();
    st.sprintHeld = false;
    st.grabHeld = false;
    endStick();
    bSprint?.classList.remove('on');
    bGrab?.classList.remove('on');
  });

  function read() {
    let x = 0;
    let y = 0;
    const k = st.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    if (st.stick.active) { x += st.stick.x; y += st.stick.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      sneak: st.sneak,
      sprint: st.sprintHeld,
      grab: st.grabHeld,
    };
  }

  function reset() {
    st.keys.clear();
    st.sprintHeld = false;
    st.grabHeld = false;
    endStick();
    setSneak(false);
    bSprint?.classList.remove('on');
    bGrab?.classList.remove('on');
  }

  return { read, reset, state: st, setSneak };
}
