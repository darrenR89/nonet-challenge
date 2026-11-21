// The splash: the Nonet cube comes apart into the wordmark (same motion as the brand board).
export function foldIntro(svg){


const NS='http://www.w3.org/2000/svg', P=48, S=40, R=7, C=Math.cos(Math.PI/6), H2=S/2;
const W=1100, H=520, CX=W/2, CY=H/2, DUR=2700;
const WASHI=[236,234,227], Y=[245,193,46];
const SH={top:[236,234,227],left:[180,179,173],right:[125,128,137],hid:[150,152,158]};
// seeded random so the break-up looks the same every time
let seed=9; const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
// 1. the cube, isometric, standing on its corner, 54 cells (27 on the hidden faces)
const K=52;
const pj=(x,y,z)=>[CX+(x-y)*C*K, CY+(x+y)*.5*K-z*K];
const f=K/P, AX=[C*f,.5*f], AY=[-C*f,.5*f], DZ=[0,f];
const faces=[
 {n:'bottom',o:pj(0,0,0),U:AX,V:AY,sh:'hid',hidden:1},
 {n:'back-x',o:pj(0,0,3),U:AY,V:DZ,sh:'hid',hidden:1},
 {n:'back-y',o:pj(0,0,3),U:AX,V:DZ,sh:'hid',hidden:1},
 {n:'top',o:pj(0,0,3),U:AX,V:AY,sh:'top'},
 {n:'left',o:pj(0,3,3),U:AX,V:DZ,sh:'left'},
 {n:'right',o:pj(3,0,3),U:AY,V:DZ,sh:'right'}
];
// 2. the wordmark, every cell on a whole step
const GL={N:["XX.X","X.XX","X..X"],O:["XXX","X.X","XXX"],E:["XXX","XX.","XXX"],T:["XXX",".X.",".X."]};
const tw=[]; let x=0;
const WX=(W-(21*P-8))/2, WY=CY-(3*P+S)/2;
let yellowT=null, armT=null;
for(const ch of "NONET"){const g=GL[ch];
  g.forEach((row,j)=>[...row].forEach((c,i)=>{const t=[WX+x+i*P+H2,WY+j*P+H2]; if(c==='X')tw.push(t); if(c==='Y'){armT=t;tw.push(t);}}));
  if(ch==='O'&&!yellowT)yellowT=[WX+x+2*P+H2,WY+3*P+H2];
  x+=(g[0].length+1)*P;}
// a cell's pose: basis (a b c d) plus its centre; the rect is drawn around that centre
const cells=[];
faces.forEach((fc,fi)=>{for(let j=0;j<3;j++)for(let i=0;i<3;i++){
  const lx=i*P+4+H2, ly=j*P+4+H2;
  const b=[fc.U[0],fc.U[1],fc.V[0],fc.V[1]];
  if(b[0]<0){b[0]=-b[0];b[1]=-b[1];} // the cell is symmetric, so mirror it to keep it from turning edge-on as it flattens
  const c0=[fc.o[0]+fc.U[0]*lx+fc.V[0]*ly, fc.o[1]+fc.U[1]*lx+fc.V[1]*ly];
  const yellow=fc.n==='right'&&i===1&&j===1;
  const el=document.createElementNS(NS,'rect');
  el.setAttribute('width',S);el.setAttribute('height',S);el.setAttribute('rx',R);
  svg.appendChild(el);
  cells.push({el,b,c0,col0:yellow?Y:SH[fc.sh],hidden:!!fc.hidden,yellow});
}});
// 3. who stays: the yellow cell, then 37 more for the letters. 16 vanish: 6 from the visible faces, 10 from the back.
const yc=cells.find(c=>c.yellow);
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const vis=shuffle(cells.filter(c=>!c.hidden&&!c.yellow)), hid=shuffle(cells.filter(c=>c.hidden));
vis.slice(0,6).concat(hid.slice(0,10)).forEach(c=>c.spare=true);
const keep=cells.filter(c=>!c.spare&&!c.yellow).sort((a,b)=>a.c0[0]-b.c0[0]||a.c0[1]-b.c0[1]);
const tgt=tw.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
keep.forEach((c,k)=>{c.t=tgt[k]; c.col1=tgt[k]===armT?Y:WASHI;});
yc.t=yellowT; yc.col1=Y;
// 4. the cell grid behind it, at the wordmark's own size: every slot is a cell that can be animated
//    it runs past the top and bottom of the wordmark's frame (the svg shows overflow), so the
//    pulse is a full circle round the cube, not cut off at the frame
const fr=svg.getBoundingClientRect(), sc=fr.width/W||1, RAD=Math.max(H/2,Math.min(W/2,(innerHeight/2-8)/sc)), gx0=((WX-4)%P)-P, gy0=((WY-4)%P)-P-Math.ceil((RAD-CY)/P)*P, GC=Math.ceil((W-gx0)/P), GR=Math.ceil((CY+RAD-gy0)/P);
const gg=document.createElementNS(NS,'g'); gg.setAttribute('fill','none'); svg.insertBefore(gg,svg.firstChild);
const grid=[];
for(let j=0;j<GR;j++)for(let i=0;i<GC;i++){const el=document.createElementNS(NS,'rect');
  const x=gx0+i*P+4.5, y=gy0+j*P+4.5;
  el.setAttribute('x',x);el.setAttribute('y',y);el.setAttribute('width',S-1);el.setAttribute('height',S-1);el.setAttribute('rx',R);
  const cx=x+19.5, cy=y+19.5;if(Math.hypot(cx-CX,cy-CY)>RAD)continue; // only the cells inside the circle
  gg.appendChild(el); grid.push({el,cx,cy});}
const dmax=RAD;
// 5. timing, as fractions of the run:
//    0 to .06 the cube draws in a breath; spares then shrink and blink out where they sit;
//    every other cell flies straight to its letter, left to right, and lands with a small overshoot;
//    a single pulse runs out across the hidden grid as the cube breaks; the yellow cell lands last at .86
for(const c of cells){
  if(c.spare){c.gone=.06+rnd()*.26;}
  else if(c.yellow){c.f0=.44; c.f1=.86;}
  else {c.f0=.06+(c.t[0]-WX)/(21*P)*.26+rnd()*.08; c.f1=c.f0+.44;}
}
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2, out=t=>1-Math.pow(1-t,3);
const clamp=v=>Math.min(1,Math.max(0,v));
const lerp=(a,b,t)=>a+(b-a)*t, Lv=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
const EDGE=[44,47,55], LIT=[120,126,140];
function pose(c,b,ctr,op,col){
  const e=ctr[0]-(b[0]+b[2])*H2, f=ctr[1]-(b[1]+b[3])*H2;
  c.el.setAttribute('transform','matrix('+[b[0],b[1],b[2],b[3],e,f].map(v=>v.toFixed(3)).join(' ')+')');
  c.el.setAttribute('fill','rgb('+col.map(Math.round).join(',')+')');
  c.el.setAttribute('opacity',op.toFixed(3));
}
function draw(p){ // 0 cube, 1 wordmark
  const breath=1-.045*Math.sin(Math.PI*clamp(p/.07));          // the cube pulls in before it lets go
  const sq=v=>[CX+(v[0]-CX)*breath, CY+(v[1]-CY)*breath];
  for(const c of cells){
    if(c.spare){                                                 // shrink to a dot in place, blink, gone
      const tg=clamp((p-c.gone)/.14), k=lerp(1,.12,out(tg))*breath;
      let op=c.hidden?0:1; if(tg>=1) op=0; else if(tg>.55) op*=(Math.floor(tg*14)%2?.15:1);
      pose(c,c.b.map(v=>v*k),sq(c.c0),op,c.col0); continue;
    }
    const tf=ease(clamp((p-c.f0)/(c.f1-c.f0)));
    const land=Math.sin(Math.PI*clamp((p-c.f1+.02)/.07));       // a small overshoot as it seats
    const k=(tf<1?lerp(breath,1,tf):1)*(1+.1*land);
    pose(c,Lv(c.b,[1,0,0,1],tf).map(v=>v*k),Lv(sq(c.c0),c.t,tf),c.hidden?clamp(tf*4):1,Lv(c.col0,c.col1,tf));
  }
  const rp=(p-.05)/.3*1.3;                                        // one pulse out from the cube as it breaks, then the grid is gone
  for(const g of grid){
    const d=Math.hypot(g.cx-CX,g.cy-CY)/dmax, w=p>.05&&p<.35?Math.max(0,1-Math.abs(rp-d)/.16)*(1-d*d):0; // fading out to the edge of the circle
    g.el.setAttribute('stroke','rgb('+LIT.join(',')+')'); g.el.setAttribute('stroke-opacity',(w*.9).toFixed(3));
  }
}

  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  draw(0);
  return new Promise(res=>{
    if(reduce){draw(1);res();return}
    const t0=performance.now()+350;
    const step=now=>{const k=Math.max(0,Math.min(1,(now-t0)/DUR));draw(k);if(k<1)requestAnimationFrame(step);else res()};
    requestAnimationFrame(step);
  });
}
