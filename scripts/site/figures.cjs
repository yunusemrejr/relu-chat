'use strict';

// The public function's coordinates also drive home.js. Keep the model honest.
const subjects = ['game-theory', 'golden-age', 'data-science', 'reinforcement-learning', 'linear-algebra', 'web-platform'];
const f = n => +n.toFixed(2);
function activationSvg() {
  let grid = '', ticks = '', labels = '', segments = '', nodes = '';
  for (let i = -4; i <= 4; i++) {
    const x = 260 + 54 * i;
    grid += `<path d="M${x} 78V316"/>`;
    ticks += `<path d="M${x} 316v5"/>`;
    labels += `<text x="${x}" y="337" text-anchor="middle">${i < 0 ? '−' + -i : i}</text>`;
  }
  for (let i = 1; i <= 4; i++) {
    const y = 316 - 54 * i;
    grid += `<path d="M44 ${y}H476"/>`;
    ticks += `<path d="M255 ${y}h5"/>`;
    labels += `<text x="248" y="${y + 4}" text-anchor="end">${i}</text>`;
  }
  for (let i = 0; i < 6; i++) {
    const a = 260 + i * 36, b = a + 36, ya = 316 - i * 36, yb = ya - 36;
    segments += `<path class="seg" data-subject="${subjects[i]}" d="M${f(a + 2.1)} ${f(ya - 2.1)}L${f(b - 2.1)} ${f(yb + 2.1)}"/>`;
    nodes += `<circle class="node on" data-subject="${subjects[i]}" cx="${a + 18}" cy="${ya - 18}" r="5.5"/>`;
  }
  const screws = [[24, 24], [496, 24], [24, 351], [496, 351]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.3"/><path d="M${x - 2} ${y}h4"/>`).join('');
  return `<svg id="relu-plot" viewBox="0 0 520 380" role="img" aria-labelledby="activation-title activation-desc">
<title id="activation-title">The ReLU activation plot</title><desc id="activation-desc">Move x from −4 to 4. Output is zero for negative inputs and equals x for positive inputs. The six subject indicators light along the positive branch.</desc>
<defs><clipPath id="plot-reveal"><rect id="plot-clip" x="0" y="0" width="465.2" height="380"/></clipPath></defs>
<path class="instrument-foot" d="M38 358v12h30v-12M452 358v12h30v-12"/>
<rect class="instrument-case" x="13" y="16" width="494" height="345" rx="13"/>
<path class="instrument-lip" d="M13 344v6q0 11 13 11h468q13 0 13-11v-6Z"/>
<rect class="instrument-panel" x="34" y="31" width="452" height="311" rx="5"/>
<path class="instrument-rule" d="M34 60H486"/>
<text class="instrument-engraving" x="48" y="50">ReLU / RECTIFIED LINEAR UNIT</text>
<circle class="instrument-status" cx="467" cy="46" r="3"/>
<g class="instrument-screws">${screws}</g>
<g class="plot-grid">${grid}</g>
<path class="plot-axes" d="M260 78V316M44 316H476"/>
<g class="plot-ticks">${ticks}</g><g class="plot-scale">${labels}</g>
<path class="plot-ghost" d="M44 316H260L476 100"/><path class="plot-flat" d="M44 316H260"/>
<g clip-path="url(#plot-reveal)" class="plot-lit" id="plot-segs">${segments}</g>
<g id="plot-nodes">${nodes}</g>
<text x="474" y="307" class="plot-axis">x</text><text x="270" y="82" class="plot-axis">y</text>
<circle class="plot-hinge" cx="260" cy="316" r="4"/>
<g id="plot-handle"><path id="plot-drop" class="plot-guide" d="M465.2 110.8V316"/><path id="plot-across" class="plot-guide" d="M465.2 110.8H260"/><circle id="plot-dot" class="plot-dot" cx="465.2" cy="110.8" r="8"/><circle id="plot-core" class="plot-core" cx="465.2" cy="110.8" r="2.4"/></g>
</svg>`;
}

const pipeParts = [
  // Index drawers: the query selects a relevant knowledge fragment.
  `<rect x="17" y="22" width="66" height="69" rx="3"/><path d="M17 45h66M17 68h66"/><path d="M43 33h14M43 56h14M43 80h14"/><g class="p-selection"><rect x="23" y="49" width="54" height="16" rx="2"/><path d="M30 57h8m5 0h25"/></g>`,
  // Feature comb: the bars are a schematic, without fictitious measurements.
  `<rect x="18" y="22" width="64" height="69" rx="3"/><path d="M27 80h46"/><path d="M29 68h5v12h-5zM41 43h5v37h-5zM53 56h5v24h-5zM65 32h5v48h-5z"/><g class="p-selection"><path d="M24 51h52"/><circle cx="76" cy="51" r="3"/></g>`,
  // Routed policy: a small network chooses one of four response actions.
  `<path d="M22 35L50 29L78 23M22 35L50 59L78 46M22 77L50 29M22 77L50 59L78 69M50 59L78 92"/>${[[22,35],[22,77],[50,29],[50,59],[78,23],[78,46],[78,69],[78,92]].map(([x,y],i)=>`<circle ${i===5?'class="p-selection"':''} cx="${x}" cy="${y}" r="5"/>`).join('')}`,
  // Fragments assembled into one answer, never generated token by token.
  `<path d="M18 25h64v66H18z"/><rect x="26" y="34" width="48" height="11" rx="2"/><rect x="26" y="51" width="48" height="11" rx="2"/><g class="p-selection"><rect x="26" y="68" width="48" height="11" rx="2"/></g><path d="M31 39h23m-23 17h34m-34 17h28"/>`,
  // A typeset document with its formula and source link.
  `<path d="M22 19h45l12 12v63H22zM67 19v12h12"/><path d="M31 39h33m-33 7h23M31 77h35m-35 7h26"/><g class="p-selection"><path d="M34 58l5 6 9-14h17M48 57h17M52 62h10"/></g>`,
];
function pipelineFigure() {
  const names = ['Retrieve', 'Read signals', 'Decide', 'Compose', 'Render'];
  return `<figure class="process-figure" data-motion-figure><div class="instrument-topline"><span>INSIDE YOUR BROWSER</span><button class="figure-replay" type="button" data-motion-replay aria-label="Replay the answer pipeline">Replay <span aria-hidden="true">↻</span></button></div><div class="process-window" role="img" aria-label="Five stages: retrieve knowledge, read signals, choose a response action, assemble fragments, and render the answer. All run on your device.">${names.map((name, i) => `<div class="process-cell"><svg class="process-svg" viewBox="0 0 120 125" aria-hidden="true" focusable="false"><g class="process-stage" style="--stage:${i}" transform="translate(10 0)"><g class="process-object">${pipeParts[i]}</g><path class="process-mount" d="M13 103h74v7H13zM22 110v6m56-6v6"/><circle class="process-signal" cx="14" cy="106" r="2.5"/></g></svg><span class="process-label"><b>${i + 1 < 10 ? '0' : ''}${i + 1}</b> ${name}</span></div>`).join('')}</div><figcaption><span>A question becomes an explanation.</span><span>Curated knowledge. Local processing.</span></figcaption></figure>`;
}

function toolPreview(slug) {
  const surface = `<rect x="9" y="10" width="182" height="102" rx="4" fill="none" stroke="currentColor" stroke-opacity=".28"/><path d="M9 96h182" stroke="currentColor" stroke-opacity=".16"/>`;
  const p = ps => ps.map(([x,y])=>`${f(x)},${f(y)}`).join(' ');
  const line = (ps, color='var(--accent)', extra='') => `<polyline points="${p(ps)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const dot = (x,y,r=3.5,color='var(--accent)') => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${color}" stroke="var(--bg-surface)" stroke-width="1.2"/>`;
  let body = '';
  if (slug === 'activation-functions') {
    body = `<path d="M21 83H179M100 23V89" stroke="currentColor" stroke-opacity=".3"/>`;
    body += line([[23,83],[100,83],[157,26]],'var(--accent)','class="tool-track"');
    const sigmoid = Array.from({length:55},(_,i)=>{const x=-5+i*10/54;return [100+x*15,83-55/(1+Math.exp(-x))];});
    body += line(sigmoid,'var(--accent-2)','class="tool-track" style="--track:1"');
    body += `<text x="22" y="106">ReLU</text><text x="122" y="106">SIGMOID</text>`;
  } else if (slug === 'gradient-descent') {
    const curve = Array.from({length:55},(_,i)=>{const x=-1.4+i*2.8/54;return [100+x*51,84-x*x*30];});
    const steps = [-1.15,-.805,-.5635,-.39445,-.276115,-.1932805].map(x=>[100+x*51,84-x*x*30]);
    body = line(curve,'var(--text-muted)') + line(steps,'var(--accent)','class="tool-track"');
    body += steps.map(([x,y],i)=>dot(x,y,i===5?4.2:2.6)).join('');
    body += `<text x="22" y="106">LOSS ↓</text><text x="128" y="106">η = 0.15</text>`;
  } else if (slug === 'neural-network' || slug === 'backpropagation') {
    const layers = [[38,[37,73]],[100,[27,55,83]],[163,[55]]];
    for(let i=0;i<2;i++)for(const y of layers[i][1])for(const yy of layers[i+1][1]) body += line([[layers[i][0],y],[layers[i+1][0],yy]],'var(--text-muted)','stroke-opacity=".4"');
    body += layers.map(([x,ys],i)=>ys.map(y=>dot(x,y,6,i===1?'var(--accent-2)':'var(--accent)')).join('')).join('');
    body += slug==='backpropagation' ? `<path class="tool-track" d="M162 24H39l7-5m-7 5 7 5" stroke="var(--accent)" stroke-width="1.5" fill="none"/><text x="22" y="106">GRADIENT ←</text>` : `<text x="22" y="106">INPUT → HIDDEN → OUTPUT</text>`;
  } else if (slug === 'k-means-clustering') {
    const centres = [[48,42],[145,40],[103,78]];
    centres.forEach(([cx,cy],i)=>{const c=['var(--accent)','var(--accent-2)','var(--cat-6)'][i];for(let k=0;k<6;k++){const a=k*1.1+i,rr=9+k%3*6;const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr;body+=line([[x,y],[cx,cy]],c,'stroke-opacity=".3"')+dot(x,y,2.8,c);}body+=`<path d="M${cx-5} ${cy}h10m-5-5v10" stroke="currentColor" stroke-width="1.7"/>`;});
    body += `<text x="22" y="106">ASSIGN → UPDATE</text>`;
  } else {
    body = line([[100,25],[100,44],[53,44],[53,62]],'var(--text-muted)')+line([[100,44],[147,44],[147,62]],'var(--text-muted)');
    for(const [x,y]of [[53,62],[147,62]])body+=line([[x,y],[x,y+12],[x-22,y+12],[x-22,87]],'var(--text-muted)')+line([[x,y+12],[x+22,y+12],[x+22,87]],'var(--text-muted)');
    body += [[100,25],[53,62],[147,62]].map(([x,y])=>`<rect x="${x-12}" y="${y-6}" width="24" height="12" rx="2" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.1"/>`).join('');
    body += [31,75,125,169].map((x,i)=>dot(x,87,5,i%2?'var(--accent-2)':'var(--accent)')).join('')+`<text x="22" y="106">SPLIT → CLASSIFY</text>`;
  }
  return `<svg class="tool-svg" data-motion-figure viewBox="0 0 200 120" aria-hidden="true" focusable="false">${surface}${body}</svg>`;
}
module.exports = { activationSvg, pipelineFigure, toolPreview };
