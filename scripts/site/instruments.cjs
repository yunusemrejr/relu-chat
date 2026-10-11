'use strict';

// Original, build-time SVG geometry. Anatomy informed the physical supports,
// four-tone finish and static-first choreography; no runtime geometry library.
const INK = '#24342e';
const ACCENT = '#e75d3d';
const FACE = '#f3f2e9';
const MID = '#d7ddd2';
const SIDE = '#aab8aa';
const DARK = '#73877a';
const fmt = n => +n.toFixed(2);
const points = a => a.map(p => p.map(fmt).join(',')).join(' ');
const path = a => 'M' + a.map(p => p.map(fmt).join(' ')).join('L');

// This example's numbers are shared by the geometry and regression checks.
const PAYOFFS = [[[3, 3], [0, 5]], [[5, 0], [1, 1]]];
const OBSERVATIONS = [[-95, -40], [-72, -17], [-48, -31], [-24, 7], [0, -8], [24, 22], [48, 8], [72, 39], [95, 32]];
function leastSquares(observations) {
  const n = observations.length;
  const mx = observations.reduce((s, p) => s + p[0], 0) / n;
  const my = observations.reduce((s, p) => s + p[1], 0) / n;
  const slope = observations.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) /
    observations.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return { slope, intercept: my - slope * mx };
}
const REGRESSION = leastSquares(OBSERVATIONS);
const GRID = { cols: 7, rows: 5, walls: [[2, 0], [2, 1], [4, 2], [4, 3], [1, 3]],
  // The front edge keeps the moving pawn clear of projected wall silhouettes.
  route: [[0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [6, 3]] };
const SHEAR = [[1, 0.6], [0, 1]];
const transform = ([x, y], m = SHEAR) => [m[0][0] * x + m[0][1] * y, m[1][0] * x + m[1][1] * y];

function scene({ ox = 240, oy = 170, scale = 1 } = {}) {
  const p = (x, y, z = 0) => [ox + (x - y) * 0.88 * scale, oy + ((x + y) * 0.44 - z) * scale];
  const poly = (ps, fill, extra = '') => `<polygon points="${points(ps)}" fill="${fill}" stroke="${INK}" stroke-width=".9" stroke-linejoin="round" ${extra}/>`;
  const line = (ps, color = INK, width = 0.9, extra = '') => `<path d="${path(ps)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const rule = (a, b, color = INK, width = 0.9, extra = '') => line([p(...a), p(...b)], color, width, extra);
  const plane = (ps, z, fill = FACE, extra = '') => poly(ps.map(a => p(a[0], a[1], z)), fill, extra);
  function slab(x, y, w, d, z, h, fill = FACE) {
    const a = p(x, y, z + h), b = p(x + w, y, z + h), c = p(x + w, y + d, z + h), e = p(x, y + d, z + h);
    return poly([b, p(x + w, y, z), p(x + w, y + d, z), c], SIDE) +
      poly([e, c, p(x + w, y + d, z), p(x, y + d, z)], DARK) + poly([a, b, c, e], fill);
  }
  // A horizontal circle projects to an exact axis-aligned ellipse for this
  // camera. Native arcs replace dozens of tessellated points per fastener.
  const ellipse = (x, y, r, z) => { const [cx, cy] = p(x, y, z); return { cx: fmt(cx), cy: fmt(cy), rx: fmt(r * Math.SQRT2 * .88 * scale), ry: fmt(r * Math.SQRT2 * .44 * scale) }; };
  function disc(x, y, r, z, h, fill = FACE) {
    const { cx, cy, rx, ry } = ellipse(x, y, r, z + h), bottom = fmt(cy + h * scale);
    return `<path d="M${fmt(cx-rx)} ${cy}A${rx} ${ry} 0 0 0 ${fmt(cx+rx)} ${cy}V${bottom}A${rx} ${ry} 0 0 1 ${fmt(cx-rx)} ${bottom}Z" fill="${SIDE}" stroke="${INK}" stroke-width=".9"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${INK}" stroke-width=".9"/>`;
  }
  const ring = (x, y, r, z, color = INK, width = 0.8) => { const e = ellipse(x, y, r, z); return `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="none" stroke="${color}" stroke-width="${width}"/>`; };
  const screw = (x, y, z) => ring(x, y, 2.3, z) + rule([x - 1.5, y, z], [x + 1.5, y, z], INK, 0.8);
  function base(w = 270, d = 180) {
    let s = '';
    for (const [x, y] of [[-w / 2 + 14, -d / 2 + 14], [w / 2 - 14, -d / 2 + 14], [-w / 2 + 14, d / 2 - 14], [w / 2 - 14, d / 2 - 14]])
      s += slab(x - 6, y - 6, 12, 12, -17, 7, INK);
    s += slab(-w / 2, -d / 2, w, d, -10, 10, MID);
    s += plane([[-w / 2 + 5, -d / 2 + 5], [w / 2 - 5, -d / 2 + 5], [w / 2 - 5, d / 2 - 5], [-w / 2 + 5, d / 2 - 5]], 0.2, MID);
    for (const x of [-w / 2 + 10, w / 2 - 10]) for (const y of [-d / 2 + 10, d / 2 - 10]) s += screw(x, y, 0.4);
    return s;
  }
  return { p, poly, line, rule, plane, slab, disc, ring, screw, base };
}

function gameTheory() {
  const g = scene({ oy: 177, scale: 1.02 });
  let s = g.base(258, 190);
  // Each inset contains the two players' actual payoffs. Zero is a flat cap.
  for (const [row, col] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    const x = -98 + col * 103, y = -68 + row * 76;
    s += g.slab(x, y, 96, 69, 0.3, 2.5, row === 1 && col === 1 ? '#b8c5ae' : FACE);
    s += g.plane([[x + 4, y + 4], [x + 92, y + 4], [x + 92, y + 65], [x + 4, y + 65]], 3, FACE);
    PAYOFFS[row][col].forEach((value, player) => {
      const bx = x + 20 + player * 37, by = y + 26;
      s += g.slab(bx - 3, by - 3, 26, 27, 3.1, 2, MID);
      s += g.slab(bx, by, 20, 21, 5.1, Math.max(1, value * 9), player === 0 ? FACE : '#ced7c8');
      for (let k = 1; k < value; k++) s += g.rule([bx, by + 21, 5.1 + k * 9], [bx + 20, by + 21, 5.1 + k * 9], DARK, 0.7);
    });
  }
  // Choice rails meet the board; the two highlighted tabs select (D,D).
  s += g.slab(-118, -68, 12, 145, 0, 3, DARK) + g.slab(-98, -87, 199, 11, 0, 3, DARK);
  for (let i = 0; i < 2; i++) {
    s += g.slab(-120, -52 + i * 76, 16, 35, 3, 4, i ? ACCENT : FACE);
    s += g.slab(-72 + i * 103, -90, 43, 17, 3, 4, i ? ACCENT : FACE);
  }
  for (let k = 0; k < 13; k++) s += g.rule([-118, -63 + k * 11, 3.1], [-114, -63 + k * 11, 3.1], FACE, 0.7);
  for (let k = 0; k < 17; k++) s += g.rule([-92 + k * 11, -87, 3.1], [-92 + k * 11, -83, 3.1], FACE, 0.7);
  s += `<g class="i-equilibrium">${g.plane([[5, 8], [101, 8], [101, 77], [5, 77]], 3.5, 'none', `style="stroke:${ACCENT};stroke-width:2.3"`)}</g>`;
  return s;
}

function goldenAge() {
  const cx = 240, cy = 166, r = 110;
  const polar = (rr, a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const circle = (x, y, rr, fill = 'none', stroke = INK, w = 0.9) => `<circle cx="${x}" cy="${y}" r="${rr}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/>`;
  let s = `<path d="M151 267L164 281H316L330 267L310 255H171Z" fill="${DARK}" stroke="${INK}" stroke-width=".9"/>`;
  s += `<path d="M164 263L174 251H306L316 263V276H164Z" fill="${MID}" stroke="${INK}" stroke-width=".9"/>`;
  s += circle(cx, 39, 16, MID) + circle(cx, 39, 10, 'var(--figure-ground, #36c6b3)');
  s += `<path d="M225 64V51Q240 40 255 51V64" fill="${MID}" stroke="${INK}" stroke-width="1"/>`;
  s += circle(cx, cy + 5, r, DARK) + circle(cx, cy, r, MID) + circle(cx, cy, r - 5, FACE) + circle(cx, cy, r - 19, '#e4e6da');
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const a = i * Math.PI / 36, p1 = polar(r - 6, a), p2 = polar(r - (i % 6 === 0 ? 16 : 11), a);
    ticks += path([p1, p2]);
  }
  s += `<path d="${ticks}" fill="none" stroke="${INK}" stroke-width=".9"/>`;
  // Engravings are cropped to the instrument face, not arbitrary loose lines.
  s += circle(cx, cy, 71) + circle(cx, cy, 48) + circle(cx, cy, 24);
  s += `<path d="M150 166H330M240 76V256" fill="none" stroke="${DARK}" stroke-width=".65"/>`;
  s += `<path d="M160 206Q240 110 320 206M158 139Q240 223 322 139M181 99Q219 166 181 233M299 99Q261 166 299 233" fill="none" stroke="${DARK}" stroke-width=".8"/>`;
  s += circle(240, 143, 64, 'none', INK, 2.4);
  let rete = '';
  for (let i = 0; i < 6; i++) {
    const a = -0.85 + i * Math.PI / 3, outer = polar(83, a), inner = polar(36, a + 0.15), tip = polar(64, a - 0.17);
    rete += `<path d="${path([outer, inner, tip])}Z" fill="${MID}" stroke="${INK}" stroke-width=".8"/>`;
    rete += circle(fmt(tip[0]), fmt(tip[1]), 2.1, INK);
  }
  s += rete;
  s += `<g class="i-astrolabe-rule" style="transform-origin:240px 166px"><path d="M153 194L324 127L327 136L156 203Z" fill="${FACE}" stroke="${INK}" stroke-width="1.2"/><path d="M162 196L318 136" stroke="${DARK}" stroke-width=".75"/><path d="M155 188L163 209M318 121L327 144" stroke="${INK}" stroke-width="3"/>${circle(cx, cy, 9, MID)}${circle(cx, cy, 4.2, ACCENT)}</g>`;
  for (const x of [180, 300]) s += circle(x, 268, 2.2, 'none') + `<path d="M${x - 1.5} 268h3" stroke="${INK}" stroke-width=".8"/>`;
  return s;
}

function dataScience() {
  const g = scene({ oy: 168, scale: 1.02 });
  const fit = x => REGRESSION.intercept + REGRESSION.slope * x;
  let s = g.base(278, 192);
  s += g.slab(-116, -72, 232, 144, 0.2, 1.5, FACE);
  for (let k = -100; k <= 100; k += 20) s += g.rule([k, -72, 1.8], [k, 72, 1.8], '#c3cebf', 0.55);
  for (let k = -60; k <= 60; k += 20) s += g.rule([-116, k, 1.8], [116, k, 1.8], '#c3cebf', 0.55);
  s += g.slab(-119, 77, 238, 8, 0, 3, MID) + g.slab(-130, -73, 8, 146, 0, 3, MID);
  for (let k = 0; k <= 28; k++) s += g.rule([-112 + k * 8, 77, 3.1], [-112 + k * 8, k % 5 ? 80 : 83, 3.1], INK, 0.7);
  for (let k = 0; k <= 17; k++) s += g.rule([-130, -68 + k * 8, 3.1], [-125, -68 + k * 8, 3.1], INK, 0.7);
  // Plot y points away from the viewer. Both residual endpoints are mounted.
  for (const [x, y] of OBSERVATIONS) {
    s += g.rule([x, -y, 2], [x, -fit(x), 2], DARK, 1.2);
    s += g.disc(x, -fit(x), 2.5, 2, 1, MID);
    s += g.disc(x, -y, 3.6, 2, 3, x === 0 ? ACCENT : FACE);
  }
  s += g.rule([-108, -fit(-108), 5], [108, -fit(108), 5], INK, 3.8);
  for (const x of [-108, 108]) s += g.disc(x, -fit(x), 5.5, 1.8, 5.5, MID) + g.screw(x, -fit(x), 7.5);
  const pen = g.slab(-8, -fit(0) - 6, 16, 12, 5, 7, FACE) + g.disc(0, -fit(0), 3, 12, 5, ACCENT);
  const [dx, dy] = g.p(52, -fit(52)), [ox, oy] = g.p(0, -fit(0));
  s += `<g class="i-plotter" style="--travel-x:${fmt(dx - ox)}px;--travel-y:${fmt(dy - oy)}px">${pen}</g>`;
  return s;
}

function reinforcement() {
  const g = scene({ oy: 165, scale: 1.03 });
  const cell = 33, ox = -115.5, oy = -82.5;
  const centre = ([x, y]) => [ox + (x + .5) * cell, oy + (y + .5) * cell];
  let s = g.base(260, 194);
  const tiles = [];
  for (let y = 0; y < GRID.rows; y++) for (let x = 0; x < GRID.cols; x++) tiles.push([x, y]);
  tiles.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  for (const [x, y] of tiles) {
    const inRoute = GRID.route.some(p => p[0] === x && p[1] === y);
    s += g.slab(ox + x * cell + 1.4, oy + y * cell + 1.4, cell - 2.8, cell - 2.8, 0.2, 2.5, inRoute ? '#d5dfca' : FACE);
  }
  const route = GRID.route.map(c => g.p(...centre(c), 3.2));
  s += g.line(route, INK, 1.5);
  const [sx, sy] = centre(GRID.route[0]), [gx, gy] = centre(GRID.route.at(-1));
  s += g.ring(sx, sy, 8, 3.3) + g.ring(gx, gy, 10.5, 3.3, ACCENT, 2.1) + g.disc(gx, gy, 4, 3.3, 2, ACCENT);
  // Route inlay belongs to the floor; raised blocks must occlude it.
  for (const [x, y] of [...GRID.walls].sort((a, b) => a[0] + a[1] - b[0] - b[1]))
    s += g.slab(ox + x * cell + 1.4, oy + y * cell + 1.4, cell - 2.8, cell - 2.8, 2.7, 20.5, DARK);
  // Discrete, legal board positions become transform stops; no wall crossing.
  const pawn = g.disc(sx, sy, 7, 3.3, 3, MID) + g.disc(sx, sy, 4, 6.3, 12, FACE) + g.disc(sx, sy, 5.5, 18.3, 4, ACCENT);
  const [px, py] = g.p(sx, sy);
  const stops = GRID.route.map(c => { const q = g.p(...centre(c)); return `${fmt(q[0] - px)},${fmt(q[1] - py)}`; }).join(';');
  s += `<g class="i-agent" data-route="${stops}">${pawn}</g>`;
  return s;
}

function linearAlgebra() {
  const g = scene({ oy: 178, scale: 1.02 });
  let s = g.base(276, 180);
  s += g.slab(-116, -71, 232, 142, 0.2, 1.2, FACE);
  for (let x = -100; x <= 100; x += 20) s += g.rule([x, -70, 1.5], [x, 70, 1.5], '#c3cebf', .65);
  for (let y = -60; y <= 60; y += 20) s += g.rule([-116, y, 1.5], [116, y, 1.5], '#c3cebf', .65);
  const square = [[-60, 38], [20, 38], [20, -42], [-60, -42]];
  const T = ([x, y]) => [x + 0.6 * (38 - y), y];
  s += g.plane(square, 2, 'none', 'stroke-dasharray="3 4"');
  s += g.plane(square.map(T), 2.4, '#dce2d2');
  for (let k = 0; k <= 4; k++) {
    const x = -60 + k * 20, y = 38 - k * 20;
    s += g.rule([...T([x, 38]), 3], [...T([x, -42]), 3], DARK, .8);
    s += g.rule([...T([-60, y]), 3], [...T([20, y]), 3], DARK, .8);
  }
  s += g.rule([-60, 38, 3.2], [20, 38, 3.2], INK, 3);
  s += g.rule([-60, 38, 3.2], [-12, -42, 3.2], ACCENT, 3);
  for (const pt of square.map(T)) s += g.disc(...pt, 4, 3.2, 3, FACE) + g.screw(...pt, 6.3);
  s += g.slab(-116, 76, 231, 7, 0, 3, MID);
  for (let k = 0; k <= 27; k++) s += g.rule([-110 + k * 8, 76, 3.1], [-110 + k * 8, k % 5 ? 79 : 82, 3.1], INK, .7);
  // A translucent reference arm swings from the original to the sheared basis.
  const o = g.p(-60, 38, 7), a = g.p(-60, -42, 7), b = g.p(-12, -42, 7);
  s += g.line([o, a], INK, 1.3, 'stroke-dasharray="3 4"');
  s += `<g class="i-shear-tip" style="--shear-x:${fmt(b[0] - a[0])}px;--shear-y:${fmt(b[1] - a[1])}px">${g.disc(-60, -42, 3.5, 7, 2, FACE)}</g>`;
  return s;
}

function webPlatform() {
  const g = scene({ oy: 178, scale: 1.05 });
  let s = g.base(270, 184);
  // Boards and the bus are mounted together, not floating layers.
  s += g.slab(-113, -70, 127, 112, 0.3, 5, '#c9d4c5') + g.slab(39, -70, 75, 112, .3, 5, '#c9d4c5');
  for (const [x, y] of [[-106, -63], [7, -63], [-106, 35], [7, 35], [46, -63], [107, -63], [46, 35], [107, 35]]) s += g.screw(x, y, 5.5);
  for (const [x, w] of [[-85, 50], [57, 37]]) {
    s += g.slab(x - 4, -51, w + 8, 47, 5.5, 2, DARK);
    for (let i = 0; i < 8; i++) {
      s += g.slab(x + i * (w / 8), -56, 2.5, 8, 6.3, 1, FACE);
      s += g.slab(x + i * (w / 8), -7, 2.5, 8, 6.3, 1, FACE);
    }
    s += g.slab(x, -48, w, 40, 7.5, 6, FACE);
    s += g.plane([[x + 6, -41], [x + w - 6, -41], [x + w - 6, -15], [x + 6, -15]], 13.6, MID);
  }
  for (let i = 0; i < 3; i++) {
    s += g.slab(-91 + i * 34, 8, 26, 22, 5.5, 2, DARK);
    s += g.slab(-88 + i * 34, 9, 20, 18, 7.5, 2, i === 0 ? ACCENT : FACE);
  }
  const bus = [[-60, -6, 5.8], [-60, 53, 5.8], [76, 53, 5.8], [76, -6, 5.8]];
  s += g.rule(bus[0], bus[1], INK, 1.5) + g.rule(bus[1], bus[2], INK, 1.5) + g.rule(bus[2], bus[3], INK, 1.5);
  for (const [x, y] of [[-60, -6], [76, -6]]) s += g.disc(x, y, 3.4, 5.5, 2, MID);
  s += g.slab(53, 7, 43, 23, 5.5, 2, FACE);
  for (let i = 0; i < 9; i++) s += g.slab(-108 + i * 12, 71, 7, 5, 0.3, .8, DARK);
  for (let i = 0; i < 3; i++) s += g.disc(77 + i * 12, 74, 2.4, .3, 1.5, i ? FACE : ACCENT);
  const [sx, sy] = g.p(...bus[0]);
  const route = bus.map(pt => { const q = g.p(...pt); return `${fmt(q[0] - sx)},${fmt(q[1] - sy)}`; }).join(';');
  s += `<g class="i-message" data-route="${route}">${g.disc(-60, -6, 4, 7.6, 2, ACCENT)}</g>`;
  return s;
}

function network() {
  const g = scene({ oy: 177, scale: 1.05 });
  let s = g.base(266, 184);
  s += g.slab(-114,-72,228,144,.3,3,'#dce2d2');
  const layers = [[-80,[-38,38]], [0,[-50,0,50]], [80,[-30,30]]];
  // Conductive tracks are on the board; processing units sit on pin sockets.
  for(let i=0;i<2;i++) for(const y of layers[i][1]) for(const yy of layers[i+1][1])
    s += g.rule([layers[i][0],y,3.5],[layers[i+1][0],yy,3.5],DARK,.9);
  layers.forEach(([x,ys],l)=>ys.forEach((y,k)=>{
    s += g.disc(x,y,11,3.5,2,DARK);
    for(let a=0;a<6;a++) {const t=a*Math.PI/3;s += g.rule([x+Math.cos(t)*10,y+Math.sin(t)*10,5.5],[x+Math.cos(t)*16,y+Math.sin(t)*16,5.5],INK,1.6);}
    s += g.disc(x,y,8,5.5,8,FACE)+g.ring(x,y,4.8,13.6);
    if(l===1&&k===1)s += `<g class="i-equilibrium">${g.disc(x,y,2.8,13.7,1,ACCENT)}</g>`;
  }));
  for(const x of [-105,105])for(const y of [-63,63])s+=g.screw(x,y,3.5);
  for(let i=0;i<13;i++)s+=g.slab(-96+i*15,80,8,4,.3,1,DARK);
  return s;
}

function retrieval() {
  const g = scene({ oy: 185, scale: 1.05 });
  let s = g.base(264,182);
  // Indexed cards in three racks, one relevant card in the answer holder.
  for(const [x,y] of [[-96,-62],[-23,-62],[50,-62]]) {
    s+=g.slab(x,y,51,91,.3,4,MID);
    for(let i=0;i<5;i++) {
      s+=g.slab(x+4,y+6+i*15,43,4,4.3,25+i%2*7,FACE);
      s+=g.slab(x+10+i%2*13,y+6+i*15,12,4,29.3+i%2*7,3,i===2?ACCENT:MID);
    }
    s+=g.slab(x,y,3,91,4.3,7,DARK)+g.slab(x+48,y,3,91,4.3,7,MID);
  }
  s+=g.slab(-103,49,204,23,.3,3,DARK);
  s+=g.slab(-55,50,84,21,3.3,4,FACE);
  for(let i=0;i<6;i++)s+=g.rule([-46+i*11,54,7.4],[-46+i*11,66,7.4],DARK,.7);
  s+=`<g class="i-equilibrium">${g.slab(45,50,40,21,3.3,4,ACCENT)}</g>`;
  return s;
}

function searchTree() {
  const g = scene({ oy: 173, scale: 1.07 });
  let s = g.base(263,188);
  s+=g.slab(-113,-77,226,154,.3,2,FACE);
  const levels=[[[0,-60]],[[-53,-16],[53,-16]],[[-83,27],[-25,27],[25,27],[83,27]],[[-95,63],[-70,63],[-40,63],[-12,63],[12,63],[40,63],[70,63],[95,63]]];
  const selected=[0,1,2,4];
  for(let l=0;l<3;l++)for(let k=0;k<levels[l].length;k++)for(let child=0;child<2;child++){
    const a=levels[l][k],b=levels[l+1][k*2+child];
    s+=g.rule([...a,3],[...b,3],selected[l]===k&&selected[l+1]===k*2+child?ACCENT:DARK,selected[l]===k&&selected[l+1]===k*2+child?2:.9);
  }
  levels.forEach((level,l)=>level.forEach(([x,y],k)=>{
    s+=g.disc(x,y,l===3?5.5:8.5,2.5,3.5,k===selected[l]?ACCENT:MID);
    s+=g.disc(x,y,l===3?2.1:4,6,1.5,FACE);
  }));
  for(const x of [-105,105])for(const y of [-69,69])s+=g.screw(x,y,2.5);
  return s;
}

function quantization() {
  const g = scene({ oy: 168, scale: 1.05 });
  let s=g.base(270,184);
  s+=g.slab(-113,-70,226,140,.3,2,FACE);
  const values=[-.84,-.51,-.18,.07,.33,.56,.87];
  // Continuous values on one ruler, nearest discrete levels on the other.
  for(const y of [-37,37]) {
    s+=g.slab(-105,y-4,210,8,2.3,2,MID);
    for(let k=0;k<=20;k++)s+=g.rule([-100+k*10,y-4,4.4],[-100+k*10,y+(k%5?0:3),4.4],INK,.7);
  }
  const rounded=values.map(v=>Math.round(v*4)/4);
  values.forEach((v,i)=>{
    s+=g.rule([v*100,-37,4.6],[rounded[i]*100,37,4.6],DARK,.8);
    s+=g.disc(v*100,-37,3.8,4.6,4,FACE);
    s+=g.disc(rounded[i]*100,37,4.5,4.6,4,i===3?ACCENT:MID);
  });
  for(let k=-4;k<=4;k++)s+=g.slab(k*25-4,48,8,10,2.3,3,k===0?ACCENT:MID);
  return s;
}

function evaluation() {
  const g=scene({oy:178,scale:1.04});
  let s=g.base(260,184);
  // A small illustrative confusion matrix, with every count represented by a bead.
  const counts=[[9,2],[3,8]];
  for(let row=0;row<2;row++)for(let col=0;col<2;col++){
    const x=-101+col*105,y=-71+row*74;
    s+=g.slab(x,y,98,67,.3,3,row===col?'#c6d3bd':MID);
    s+=g.plane([[x+4,y+4],[x+94,y+4],[x+94,y+63],[x+4,y+63]],3.4,FACE);
    for(let k=0;k<counts[row][col];k++)s+=g.disc(x+23+k%3*24,y+16+Math.floor(k/3)*17,5,3.5,4,row===col?MID:ACCENT);
  }
  s+=g.slab(-120,-71,10,141,.3,2,DARK)+g.slab(-101,-87,203,9,.3,2,DARK);
  for(let k=0;k<12;k++)s+=g.rule([-120,-66+k*11,2.4],[-115,-66+k*11,2.4],FACE,.65);
  for(let k=0;k<18;k++)s+=g.rule([-95+k*11,-87,2.4],[-95+k*11,-82,2.4],FACE,.65);
  return s;
}

// Match the real topic/guide vocabulary. Subject landing pages keep their own
// identity; article and topic slugs select a more specific physical metaphor.
function motifOf(subject, seed='') {
  if(/beam|greedy|prefix|trie|decision-tree|state-machine/.test(seed))return 'search-tree';
  if(/quantization|float32|float64|numerical-precision|int8|model-size/.test(seed))return 'quantization';
  if(/confusion|precision-recall|evaluation|cross-validation|train-test-split|leakage|perplexity|bleu|rouge/.test(seed))return 'evaluation';
  if(/neural|mlp|dropout|softmax|normalization|learning-rate|backprop|perceptron|sentence-embedding/.test(seed))return 'network';
  if(/bm25|retriev|inverted-index|tf-idf|query-expansion|keyword|chunking|fragment|tokeniz|stop-words|spell-correction|summariz/.test(seed))return 'retrieval';
  return subject;
}

const SUBJECTS = {
  'game-theory': { draw: gameTheory, name: 'A board of strategic choices', note: 'Two players. Four outcomes. One equilibrium.' },
  'golden-age': { draw: goldenAge, name: 'An instrument for inquiry', note: 'Geometry becomes a way to measure the world.' },
  'data-science': { draw: dataScience, name: 'Finding the line in the observations', note: 'The residual is the distance from point to fit.' },
  'reinforcement-learning': { draw: reinforcement, name: 'A path learned one action at a time', note: 'An agent, an environment and a destination.' },
  'linear-algebra': { draw: linearAlgebra, name: 'A matrix changes the space', note: 'A shear moves the second basis; area stays fixed.' },
  'web-platform': { draw: webPlatform, name: 'Work stays inside the browser', note: 'The main thread hands a task to a worker.' },
};

const MOTIFS = { network, retrieval, 'search-tree':searchTree, quantization, evaluation };
const cache = new Map();
function instrument(subject, seed='') {
  const motif=motifOf(subject,seed);
  const draw=MOTIFS[motif] || SUBJECTS[motif]?.draw;
  if(!draw)return '';
  if (!cache.has(motif)) cache.set(motif,draw());
  return cache.get(motif);
}

module.exports = { instrument, SUBJECTS, MOTIFS, motifOf, PAYOFFS, OBSERVATIONS, REGRESSION, leastSquares, GRID, SHEAR, transform };
