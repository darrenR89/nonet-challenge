// Cube transitions.
// In: yellow cells grow to cover the screen, shrink into the cube's 54 squares laid flat as a net,
// the six 3x3 panels fold together, then the digits appear over a pulse of the grid.
// Out (pause): the cube unfolds, its squares grow back into yellow cells over the screen,
// the start screen goes in underneath, and the cells shrink away.
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const ease = t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const tween = (ms, fn) => new Promise(done => {
  const t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms);
    fn(ease(t));
    if (t < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
});

// a face's transform at fold k (0 flat, 1 folded); each side hinges on the front, the back on the right
function foldT(fi, k, h) {
  const A = 90 * k, Z = `translateZ(${h}px)`;
  const R = `${Z} translateX(${h}px) rotateY(${A}deg) translateX(${h}px)`;
  return [Z,
    `${R} translateX(${h}px) rotateY(${A}deg) translateX(${h}px)`,
    R,
    `${Z} translateX(${-h}px) rotateY(${-A}deg) translateX(${-h}px)`,
    `${Z} translateY(${-h}px) rotateX(${A}deg) translateY(${-h}px)`,
    `${Z} translateY(${h}px) rotateX(${-A}deg) translateY(${h}px)`][fi];
}

export function makeTransitions({cubeEl, faceEls, stageEl, view, apply}) {
  const H = 90; // half the cube's side, as in style.css
  let busy = false;
  const stickers = () => [...cubeEl.querySelectorAll('.st')];

  // the cube laid flat, facing the viewer, small enough to fit the screen; k=1 is the normal view
  function pose(k) {
    const {rx, ry, scaleK} = view();
    const fit = Math.min(1, (innerWidth - 32) / (8 * H * scaleK));
    const s = scaleK * (fit + (1 - fit) * k);
    cubeEl.style.transform = `translateX(${-H * s * (1 - k)}px) scale(${s}) rotateX(${rx * k}deg) rotateY(${ry * k}deg)`;
    faceEls.forEach((el, fi) => { el.style.transform = foldT(fi, k, H) });
  }
  function settle() {
    cubeEl.classList.remove('tx-run');
    faceEls.forEach((el, fi) => { el.style.transform = foldT(fi, 1, H) });
    apply();
  }

  // the screen split into large cells, one per square of the cube
  function slots() {
    const W = innerWidth, Hh = innerHeight, port = Hh >= W;
    const cols = port ? 6 : 9, rows = port ? 9 : 6, w = W / cols, h = Hh / rows;
    const out = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({x: i * w, y: j * h, w, h});
    return out;
  }
  function layer() {
    const L = document.createElement('div');
    L.className = 'tx-layer';
    document.body.appendChild(L);
    return L;
  }
  function cellsIn(L, list, color) {
    return list.map(r => {
      const c = document.createElement('i');
      Object.assign(c.style, {left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, background: color});
      L.appendChild(c);
      return c;
    });
  }
  // pairs screen cells with squares so paths cross as little as possible: both sorted left to right, top to bottom
  const order = rs => rs.map((r, i) => ({r, i})).sort((a, b) => (a.r.x + a.r.w / 2) - (b.r.x + b.r.w / 2) || (a.r.y - b.r.y)).map(o => o.i);
  const shadeColor = () => getComputedStyle(cubeEl).getPropertyValue('--cell-top').trim() || '#3b3e47';
  const yellow = () => getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim() || '#f5c12e';

  function pulse() {
    const p = document.createElement('div');
    p.className = 'tx-pulse';
    stageEl.appendChild(p);
    stageEl.classList.add('gridflash');
    setTimeout(() => stageEl.classList.remove('gridflash'), 520);
    setTimeout(() => p.remove(), 1100);
  }

  // big numbers over the cube, ticking down a second at a time; input is blocked until Start!
  async function countdown() {
    const o = document.createElement('div');
    o.className = 'tx-count';
    o.setAttribute('role', 'status');
    o.setAttribute('aria-live', 'assertive');
    document.body.appendChild(o);
    for (const v of ['5', '4', '3', '2', '1']) {
      o.innerHTML = `<b>${v}</b>`;
      await wait(1000);
    }
    o.innerHTML = '<b class="go">Start!</b>';
    o.classList.add('done');
    setTimeout(() => o.remove(), 700);
  }

  // ready: the cube being in place (today's cube may still be loading), a promise or a function
  // that starts it. hold: shown over the yellow before the cube comes in; it resolves true to go
  // on, or false to go back, which shrinks the yellow away again.
  const start = r => (typeof r === 'function' ? r() : r);
  async function enter({hold, before, ready, done} = {}) {
    if (busy) return;
    if (reduce()) {
      busy = true;
      if (hold && !(await hold())) { busy = false; return }
      before?.(); await start(ready); await countdown(); busy = false; done?.(); return;
    }
    busy = true;
    const L = layer(), S = slots(), Y = yellow();
    const cs = cellsIn(L, S, Y);
    const cx = innerWidth / 2, cy = innerHeight / 2, far = Math.hypot(cx, cy);
    cs.forEach((c, i) => {
      const r = S[i], d = Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) / far;
      c.animate([{transform: 'scale(0)', borderRadius: '40%'}, {transform: 'scale(1.03)', borderRadius: '6px'}],
        {duration: 360, delay: d * 220, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards'});
    });
    await wait(600);
    if (hold && !(await hold())) {
      cs.forEach((c, i) => {
        const r = S[i], d = 1 - Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) / far;
        c.getAnimations().forEach(x => x.commitStyles?.());
        c.getAnimations().forEach(x => x.cancel());
        c.animate([{transform: 'scale(1)'}, {transform: 'scale(0)', borderRadius: '40%'}],
          {duration: 320, delay: d * 200, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards'});
      });
      await wait(560);
      L.remove();
      busy = false;
      return;
    }
    before?.();
    await start(ready);
    await wait(30);
    // lay the cube flat where the cells will land, digits hidden
    cubeEl.classList.add('tx-run', 'tx-nodigits');
    pose(0);
    faceEls.forEach(el => el.style.setProperty('--shade', 'var(--cell-top)'));
    const st = stickers(), T = st.map(s => s.getBoundingClientRect()).map(b => ({x: b.left, y: b.top, w: b.width, h: b.height}));
    cubeEl.style.visibility = 'hidden';
    const a = order(S), b = order(T), shade = shadeColor(), rad = `${10 * (T[0].w / 50)}px`;
    a.forEach((si, n) => {
      const ti = b[n], c = cs[si], r = T[ti], s = S[si];
      c.getAnimations().forEach(x => x.cancel());
      c.animate([
        {left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px`, background: Y, borderRadius: '6px'},
        {left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, background: shade, borderRadius: rad},
      ], {duration: 620, delay: (n % 9) * 12, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards'});
    });
    await wait(620 + 8 * 12 + 40);
    cubeEl.style.visibility = '';
    cs.forEach(c => c.remove());
    // the panels fold together while the cube turns to its usual view
    await tween(760, k => pose(k));
    settle();
    cubeEl.classList.remove('tx-nodigits');
    cubeEl.classList.add('tx-digits');
    st.forEach((s, i) => s.style.setProperty('--d', `${(i % 9) * 22 + Math.floor(i / 9) * 30}ms`));
    pulse();
    L.remove();
    setTimeout(() => cubeEl.classList.remove('tx-digits'), 900);
    await wait(500);
    await countdown();
    busy = false;
    done?.();
  }

  async function leave({covered, done} = {}) {
    if (busy) return;
    if (reduce()) { covered?.(); done?.(); return }
    busy = true;
    const L = layer();
    cubeEl.classList.add('tx-run', 'tx-nodigits');
    faceEls.forEach(el => el.style.setProperty('--shade', 'var(--cell-top)'));
    await tween(480, k => pose(1 - k));
    const st = stickers(), T = st.map(s => s.getBoundingClientRect()).map(b => ({x: b.left, y: b.top, w: b.width, h: b.height}));
    const S = slots(), Y = yellow(), shade = shadeColor(), rad = `${10 * (T[0].w / 50)}px`;
    const a = order(S), b = order(T);
    const cs = new Array(S.length);
    a.forEach((si, n) => {
      const r = T[b[n]], s = S[si];
      const c = cellsIn(L, [r], shade)[0];
      cs[si] = c;
      c.animate([
        {left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, background: shade, borderRadius: rad},
        {left: `${s.x}px`, top: `${s.y}px`, width: `${s.w * 1.03}px`, height: `${s.h * 1.03}px`, background: Y, borderRadius: '6px'},
      ], {duration: 520, delay: (n % 9) * 10, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards'});
    });
    cubeEl.style.visibility = 'hidden';
    await wait(520 + 8 * 10 + 30);
    covered?.();
    cubeEl.style.visibility = '';
    settle();
    cubeEl.classList.remove('tx-nodigits');
    await wait(60);
    const cx = innerWidth / 2, cy = innerHeight / 2, far = Math.hypot(cx, cy);
    cs.forEach((c, i) => {
      const r = S[i], d = 1 - Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) / far;
      c.getAnimations().forEach(x => x.commitStyles?.());
      c.getAnimations().forEach(x => x.cancel());
      c.animate([{transform: 'scale(1)'}, {transform: 'scale(0)', borderRadius: '40%'}],
        {duration: 320, delay: d * 200, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards'});
    });
    await wait(560);
    L.remove();
    busy = false;
    done?.();
  }

  return {enter, leave, get busy() { return busy }};
}
