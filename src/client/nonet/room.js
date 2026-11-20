// The room behind the cube: a faint box ruled in the cube's own 60px cells, 11 by 11 by 11, with the
// cube floating in the middle. It turns with the view (the same orthographic rotateX then rotateY as the
// cube) and only its far three sides are drawn, like the inside of a box.
// Depth of field: the camera is focused on the cube, so a line goes softer and fainter the further it is
// in front of or behind the cube's centre. Drawn on a canvas so the blur can change along each line.
const R = 330, PITCH = 60, CELLS = (2 * R) / PITCH, SEGS = 12, LEVELS = 5;
const D2R = Math.PI / 180;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = t => 1 - (1 - t) ** 3;

// the six sides: a corner, two edge vectors across it, and the inward normal
const SIDES = [
  {o: [-R, -R, -R], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1]}, // back
  {o: [-R, -R, R], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1]}, // front
  {o: [-R, -R, -R], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0]}, // left
  {o: [R, -R, -R], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0]}, // right
  {o: [-R, R, -R], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0]}, // floor
  {o: [-R, -R, -R], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0]}, // ceiling
];

export function makeRoom(canvas) {
  const ctx = canvas.getContext('2d');
  let view = {rx: -28, ry: -38, k: 1}, from = view, to = view, t0 = 0, raf = 0, w = 0, h = 0, dpr = 1;

  // CSS rotateX(rx) rotateY(ry): rotate about y first, then x. z comes out towards the viewer.
  const project = ({rx, ry, k}) => {
    const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
    return ([x, y, z]) => {
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      return [x1 * k, (y * cx - z1 * sx) * k, y * sx + z1 * cx];
    };
  };

  function draw() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (W !== w || H !== h || devicePixelRatio !== dpr) {
      w = W; h = H; dpr = devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const P = project(view), ox = w / 2, oy = h / 2;
    // segments sorted into blur levels by how far they sit from the plane of focus
    const buckets = Array.from({length: LEVELS}, () => []), edges = Array.from({length: LEVELS}, () => []);
    let floor = null;
    for (const s of SIDES) {
      // a side shows when its inward normal faces the viewer
      if (P(s.n)[2] <= 0.001) continue;
      if (s.n[1] === -1) floor = s;
      const at = (a, b) => s.o.map((o, i) => o + s.u[i] * a + s.v[i] * b);
      const line = (a0, b0, a1, b1, edge) => {
        for (let i = 0; i < SEGS; i++) {
          const p = P(at(a0 + ((a1 - a0) * i) / SEGS, b0 + ((b1 - b0) * i) / SEGS));
          const q = P(at(a0 + ((a1 - a0) * (i + 1)) / SEGS, b0 + ((b1 - b0) * (i + 1)) / SEGS));
          const depth = Math.abs(p[2] + q[2]) / 2 / (R * 1.6);
          (edge ? edges : buckets)[Math.min(LEVELS - 1, Math.floor(depth * LEVELS))].push(p, q);
        }
      };
      for (let c = 0; c <= CELLS; c++) {
        const e = c === 0 || c === CELLS;
        line(c * PITCH, 0, c * PITCH, 2 * R, e);
        line(0, c * PITCH, 2 * R, c * PITCH, e);
      }
    }
    // the cube's shadow on the floor, straight below it
    if (floor) {
      const c = P([0, R, 0]), a = P([1, 0, 0]), b = P([0, 0, 1]);
      ctx.save();
      ctx.setTransform(dpr * a[0], dpr * a[1], dpr * b[0], dpr * b[1], dpr * (ox + c[0]), dpr * (oy + c[1]));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 130);
      g.addColorStop(0, 'rgb(0 0 0 / .45)'); g.addColorStop(.6, 'rgb(0 0 0 / .18)'); g.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = g; ctx.fillRect(-130, -130, 260, 260);
      ctx.restore();
    }
    ctx.lineCap = 'round';
    // a blurred line, faked without canvas filters: wider, fainter strokes laid over each other
    const stroke = (segs, level, alpha) => {
      if (!segs.length) return;
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 2) {
        ctx.moveTo(ox + segs[i][0], oy + segs[i][1]); ctx.lineTo(ox + segs[i + 1][0], oy + segs[i + 1][1]);
      }
      // in focus a line is a crisp hairline; out of focus it spreads over a few pixels and fades to about half
      const blur = level * 1.4, a = alpha * (1 - level * 0.13);
      const passes = blur ? [[1, a * 0.5], [1 + blur, a * 0.35], [1 + 2 * blur, a * 0.2]] : [[1, a]];
      for (const [wd, op] of passes) {
        ctx.lineWidth = wd; ctx.strokeStyle = `rgb(236 234 227 / ${op})`; ctx.stroke();
      }
    };
    for (let l = 0; l < LEVELS; l++) { stroke(buckets[l], l, 0.08); stroke(edges[l], l, 0.16); }
  }

  const frame = now => {
    const t = Math.max(0, Math.min(1, (now - t0) / 350)), e = ease(t);
    view = {rx: from.rx + (to.rx - from.rx) * e, ry: from.ry + (to.ry - from.ry) * e, k: from.k + (to.k - from.k) * e};
    draw();
    raf = t < 1 ? requestAnimationFrame(frame) : 0;
  };
  // eases to the new view like the cube's .35s transition, or jumps there while dragging
  function set(rx, ry, k, instant) {
    cancelAnimationFrame(raf); raf = 0;
    to = {rx, ry, k};
    if (instant || reduce()) { view = to; draw(); return; }
    from = view; t0 = performance.now(); raf = requestAnimationFrame(frame);
  }
  new ResizeObserver(() => draw()).observe(canvas);
  return {set};
}
