// Nonet: cube geometry, lines, solver, turns and puzzle generation. No DOM.
// ---------- faces: CSS transform + how grid (col i,row j) maps to a cube position; x right, y down, z toward viewer ----------
const F=[
 {t:'translateZ(var(--h))',               map:(i,j)=>[i-1,j-1,1],  tint:'--f1'},
 {t:'rotateY(180deg) translateZ(var(--h))',map:(i,j)=>[1-i,j-1,-1], tint:'--f2'},
 {t:'rotateY(90deg) translateZ(var(--h))', map:(i,j)=>[1,j-1,1-i],  tint:'--f3'},
 {t:'rotateY(-90deg) translateZ(var(--h))',map:(i,j)=>[-1,j-1,i-1], tint:'--f4'},
 {t:'rotateX(90deg) translateZ(var(--h))', map:(i,j)=>[i-1,-1,j-1], tint:'--f5'},
 {t:'rotateX(-90deg) translateZ(var(--h))',map:(i,j)=>[i-1,1,1-j],  tint:'--f6'},
];
// ---------- model: 54 stickers = (face normal n, block position c) ----------
const k3=v=>v.join(',');const key=(n,c)=>k3(n)+'|'+k3(c);
const cells=[];F.forEach(f=>{const n=f.map(1,1);for(let j=0;j<3;j++)for(let i=0;i<3;i++)cells.push({n,c:f.map(i,j)})});
const idx=new Map(cells.map((x,i)=>[key(x.n,x.c),i]));
const faceOfNormal=new Map(F.map((f,fi)=>[k3(f.map(1,1)),fi]));
const axisOf=v=>v.findIndex(x=>x!==0);
// ---------- lines ----------
// Each ring of 12 squares (one axis, one layer) holds two lines of 9: each line skips one of the ring's two end faces.
// So the two lines share the six squares on the other two faces, and each end's three squares repeat the digits of
// the other end. A layout says, for rings around x, y and z, which axis the end faces sit on.
// Mirror: the x and y rings both end on front/back, which makes the back a mirror copy of the front. Easy uses it.
// Spread: each pair of opposite faces ends one ring direction, so no face copies another. Medium and Hard use it.
const LAYOUTS={mirror:[2,2,1],spread:[2,0,1]};
const layoutOf=level=>level>0?'spread':'mirror';
const groups=[],lines=[];
const N=cells.length;
const peers=cells.map(()=>new Set());
const lineIdxOf=cells.map(()=>[]);
const isOverlap=cells.map(()=>false);
let layout='';
// rebuilds lines, groups, peers and overlaps in place, so every importer sees the current layout
function setLayout(name){
  const ends=LAYOUTS[name];if(!ends)throw Error(`no layout ${name}`);
  if(name===layout)return;layout=name;
  groups.length=0;lines.length=0;
  F.forEach(f=>{const n=k3(f.map(1,1));groups.push(cells.map((x,i)=>k3(x.n)===n?i:-1).filter(i=>i>=0))});
  const nv=(a,s)=>{const v=[0,0,0];v[a]=s;return k3(v)};
  for(let r=0;r<3;r++){
    const c=ends[r];
    for(const v of[-1,0,1]){
      const R=cells.map((x,i)=>axisOf(x.n)!==r&&x.c[r]===v?i:-1).filter(i=>i>=0);
      for(const ex of[nv(c,-1),nv(c,1)])lines.push(R.filter(i=>k3(cells[i].n)!==ex));
    }
  }
  groups.push(...lines);
  for(const p of peers)p.clear();
  for(const g of groups)for(const a of g)for(const b of g)if(a!==b)peers[a].add(b);
  cells.forEach((_,i)=>{lineIdxOf[i]=lines.map((l,k)=>l.includes(i)?k:-1).filter(k=>k>=0);
    const by={};for(const k of lineIdxOf[i])by[Math.floor(k/6)]=(by[Math.floor(k/6)]||0)+1;isOverlap[i]=Object.values(by).some(n=>n>1)});
}
const getLayout=()=>layout;
function withLayout(name,fn){const was=layout;setLayout(name);try{return fn()}finally{setLayout(was)}}
setLayout('mirror');
const ringOf=k=>Math.floor(k/2);const ringCells=q=>new Set([...lines[2*q],...lines[2*q+1]]);

// every random choice goes through rnd, so a seed gives the same cube on any device
let rnd=Math.random;
const mulberry=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
function seedOf(str){let h=2166136261;for(const ch of String(str)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function withSeed(seed,fn){const was=rnd;rnd=mulberry(seedOf(seed));try{return fn()}finally{rnd=was}}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=rnd()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a}
// returns [count, first]; count -1 means the search ran out of budget
function solveCount(grid,limit,budget=300000){
  let n=0,first=null,nodes=0,out=false;const g=grid.slice();
  for(let i=0;i<N;i++)if(g[i])for(const p of peers[i])if(g[p]===g[i])return[0,null];
  const cand=i=>{let m=0x3FE;for(const p of peers[i])if(g[p])m&=~(1<<g[p]);return m};
  (function rec(){
    if(n>=limit||out)return;
    if(++nodes>budget){out=true;return}
    let best=-1,bm=0,bc=10;
    for(let i=0;i<N;i++)if(!g[i]){const m=cand(i);let c=0;for(let d=1;d<10;d++)if(m>>d&1)c++;if(c<bc){bc=c;best=i;bm=m;if(c<2)break}}
    if(best<0){n++;if(!first)first=g.slice();return}
    if(bc===0)return;
    const ds=[];for(let d=1;d<10;d++)if(bm>>d&1)ds.push(d);
    for(const d of shuffle(ds)){g[best]=d;rec();g[best]=0;if(n>=limit||out)return}
  })();
  return[out?-1:n,first];
}

// ---------- layer turns ----------
const rotV=(p,a,s)=>{const b=(a+1)%3,c=(a+2)%3,q=p.slice();if(s>0){q[b]=-p[c];q[c]=p[b]}else{q[b]=p[c];q[c]=-p[b]}return q};
const rotCell=(i,a,s)=>idx.get(key(rotV(cells[i].n,a,s),rotV(cells[i].c,a,s)));
function turnArr(arr,a,v,s){const out=arr.slice();cells.forEach((x,i)=>{if(x.c[a]===v)out[rotCell(i,a,s)]=arr[i]});return out}
const randomTurn=()=>[rnd()*3|0,[-1,0,1][rnd()*3|0],rnd()<.5?1:-1];

// a tier is how many turns scramble the cube: 0 to 3. Practice is its own tier, 4: a guided walkthrough.
const TIERS=[{name:'No turns',k:0},{name:'1 turn',k:1},{name:'2 turns',k:2},{name:'3 turns',k:3},{name:'Practice',k:1,tutorial:true}];
const PRACTICE=4;
// a day's fill difficulty, set by how many clues it starts with. Every level can be filled by singles alone
// (a square with one digit left, or a digit with one place left); fewer clues means fewer of those to start from.
// Clue bands come from 400 test cubes: research in nonet-research/difficulty-baseline.
const LEVELS=[{name:'Easy',lo:20,hi:22},{name:'Medium',lo:16,hi:19},{name:'Hard',lo:13,hi:15}];
// practice cubes start half filled
const PRACTICE_CLUES=27;
const sameLayer=(m,n)=>m[0]===n[0]&&m[1]===n[1];
// a short fingerprint of an answer grid, for spotting repeats
const fingerprint=sol=>{let h=2166136261;for(const v of sol){h^=v;h=Math.imul(h,16777619)}return(h>>>0).toString(36)};
// daily cubes and practice cubes come from two halves of all answers, split by the fingerprint, so a
// practice cube can never be a past, present or future daily cube
const answerHalf=sol=>{let h=2166136261;for(const v of sol){h^=v;h=Math.imul(h,16777619)}return(h>>>20)&1};
const isDailyAnswer=sol=>answerHalf(sol)===0;
// a full answer from an empty cube. Spread cubes are slower to search, so the budget is generous.
function fullAnswer(){for(;;){const s=solveCount(new Array(N).fill(0),1,3e6)[1];if(s)return s}}
// swapping digit names keeps an answer valid; it moves an answer into the half it needs without a new search
const relabel=sol=>{const d=shuffle([1,2,3,4,5,6,7,8,9]);return sol.map(v=>d[v-1])};
const answerIn=half=>{let sol=fullAnswer();while(answerHalf(sol)!==half)sol=relabel(sol);return sol};
// the fewest clues that still give one answer, removed in a random order
function minimize(sol){
  const given=sol.slice();
  for(const i of shuffle([...Array(N).keys()])){const v=given[i];given[i]=0;if(solveCount(given,2)[0]!==1)given[i]=v}
  return{sol,given};
}
const clueCount=g=>g.reduce((n,v)=>n+(v?1:0),0);
const singlesOnly=g=>singlesOrder(g).length===N-clueCount(g);
// adds clues from the answer until there are at least lo, then more (up to hi) until singles alone can fill it.
// Returns null when the band can't be met, so the caller tries a fresh answer.
function addClues(base,lo,hi){
  const {sol}=base,given=base.given.slice();
  if(clueCount(given)>hi)return null;
  const empties=shuffle([...Array(N).keys()].filter(i=>!given[i]));
  while(clueCount(given)<lo){const i=empties.pop();given[i]=sol[i]}
  while(!singlesOnly(given)&&clueCount(given)<hi){const i=empties.pop();given[i]=sol[i]}
  return singlesOnly(given)?{sol,given}:null;
}
// the day's cube at a level: the full answer and its clues. Every tier is built from it.
function makeBase(level=0){
  const {lo,hi}=LEVELS[level]??LEVELS[0];
  // a new removal order is cheap; a new answer is not, so try a few orders on each answer
  return withLayout(layoutOf(level),()=>{for(;;){const sol=answerIn(0);for(let t=0;t<30;t++){const b=addClues(minimize(sol),lo,hi);if(b)return b}}});
}
// the three ★ opening squares: ones a solver can reach by singles from the clues alone
function pickStars(given){const order=singlesOrder(given);const pool=order.length?order.slice(0,10):given.map((v,i)=>v?-1:i).filter(i=>i>=0);return shuffle(pool).slice(0,3)}
// scrambles clues by k turns, so they no longer line up
function scramble(given,k){
  for(let tries=0;tries<200;tries++){
    let g=given,ms=[];
    for(let t=0;t<k;t++){let m;do{m=randomTurn()}while(ms.length&&sameLayer(m,ms[ms.length-1]));g=turnArr(g,...m);ms.push(m)}
    if(solveCount(g,1,60000)[0]===0)return{start:g,moves:ms};
  }
  return{start:given,moves:[]};
}
// a tier: the base's clues, scrambled by the tier's turns. The clues are the same at every tier.
function makeTier(base,tier,level=0){
  const {k}=TIERS[tier],sol=base.sol,given=base.given.slice();
  const lay=layoutOf(level);
  return withLayout(lay,()=>{const {start,moves}=k?scramble(given,k):{start:given,moves:[]};
    return{sol,given,start,moves,tier,k,level,layout:lay,stars:pickStars(given)}});
}
// a practice cube: half filled, one turn out, from the practice half of all answers
function makePractice(){return withLayout('mirror',()=>{
  for(;;){const b=addClues(minimize(answerIn(1)),PRACTICE_CLUES,PRACTICE_CLUES);if(!b)continue;
    const {start,moves}=scramble(b.given,1);if(!moves.length)continue;
    return{sol:b.sol,given:b.given,start,moves,tier:PRACTICE,k:1,level:0,layout:'mirror',stars:[]}}
})}
// an unscored cube made on this device (offline, or not logged in)
function makePuzzle(tier,level=0){return tier===PRACTICE?makePractice():makeTier(makeBase(level),tier,level)}
// a seeded day: the same base and tiers on every device for the same seed
function makeDay(seed,level=0){
  const base=withSeed(seed,()=>makeBase(level));
  return{base,level,tiers:[0,1,2,3].map(t=>withSeed(`${seed}:t${t}`,()=>makeTier(base,t,level)))};
}

// candidates solvable by naked/hidden singles, in the order found
function singlesOrder(g0){const g=g0.slice(),order=[];
  const cand=i=>{let m=0x3FE;for(const p of peers[i])if(g[p])m&=~(1<<g[p]);return m};
  for(let guard=0;guard<N;guard++){let found=-1,fd=0;
    for(let i=0;i<N&&found<0;i++)if(!g[i]){const m=cand(i);if(m&&(m&(m-1))===0){found=i;fd=Math.log2(m)}}
    if(found<0)for(const grp of groups){for(let d=1;d<=9&&found<0;d++){if(grp.some(i=>g[i]===d))continue;const sp=grp.filter(i=>!g[i]&&(cand(i)>>d&1));if(sp.length===1){found=sp[0];fd=d}}if(found>=0)break}
    if(found<0)break;g[found]=fd;order.push(found)}
  return order}

export {LAYOUTS,layoutOf,setLayout,getLayout,withLayout,F,k3,key,cells,idx,faceOfNormal,axisOf,groups,lines,N,peers,lineIdxOf,ringOf,ringCells,isOverlap,shuffle,solveCount,rotV,rotCell,turnArr,randomTurn,TIERS,sameLayer,makePuzzle,singlesOrder,makeBase,makeTier,makeDay,pickStars,withSeed,fingerprint,PRACTICE,LEVELS,PRACTICE_CLUES,makePractice,isDailyAnswer,clueCount,singlesOnly};
