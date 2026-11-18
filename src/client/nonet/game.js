// Nonet: rendering, input, stages and scoring.
import {F,k3,key,cells,idx,faceOfNormal,axisOf,groups,lines,N,peers,lineIdxOf,ringOf,ringCells,isOverlap,shuffle,solveCount,rotV,rotCell,turnArr,randomTurn,TIERS,sameLayer,makePuzzle,singlesOrder,PRACTICE,setLayout} from '../../shared/model.js';
import './style.css';
import {makeTransitions} from './transitions.js';
import {getDaily,startDay,sendScore,joinTeam,useRetry,setNotify,joinSub,lastError} from '../api.ts';
import {journey} from '../journey.ts';
import {music} from '../music.ts';
import {duelsHTML,wireDuels,splashDuelsHTML,wireAnswers} from '../duels.ts';
import {exitExpandedMode} from '@devvit/web/client';
import {RETRY_MULT} from '../../shared/api.ts';
import {scoreRun,dayKey,msUntilNextDay,levelOf,multOf,maxTurns,tierAllowed,LEVEL_NAMES,kanjiNo} from '../../shared/scoring.ts';

// digits are drawn in cells, 3 wide and 5 tall, like the wordmark
const DG={0:["XXX","X.X","X.X","X.X","XXX"],1:[".X.","XX.",".X.",".X.","XXX"],2:["XXX","..X","XXX","X..","XXX"],3:["XXX","..X","XXX","..X","XXX"],4:["X.X","X.X","XXX","..X","..X"],
5:["XXX","X..","XXX","..X","XXX"],6:["XXX","X..","XXX","X.X","XXX"],7:["XXX","..X","..X","..X","..X"],8:["XXX","X.X","XXX","X.X","XXX"],9:["XXX","X.X","XXX","..X","XXX"]};
const digitSVG=d=>{let r='';DG[d].forEach((row,j)=>[...row].forEach((c,i)=>{if(c==='X')r+=`<rect x="${i*12}" y="${j*12}" width="10" height="10" rx="2"/>`}));
  // 6 and 9 read the same upside down on a turned cube, so they carry a yellow bar along their foot
  if(d===6||d===9)r+='<rect class="foot" x="0" y="63" width="34" height="5" rx="2"/>';
  return `<svg class="dg" viewBox="0 0 34 58" fill="currentColor" aria-label="${d}" role="img">${r}</svg>`};

let lc=0,lastStage=0,flashT=0; // which overlapping line is shown when a square is tapped again
const cubeEl=document.getElementById('cube');
const stickers=cells.map(()=>[]);const faceEls=[];
F.forEach((f,fi)=>{
  const el=document.createElement('div');el.className='face';el.style.transform=f.t;
  const n=f.map(1,1);
  for(let j=0;j<3;j++)for(let i=0;i<3;i++){
    const ci=idx.get(key(n,f.map(i,j)));const s=document.createElement('div');
    s.className='st';s.dataset.i=i;s.dataset.j=j;s.style.left=(i*60+5)+'px';s.style.top=(j*60+5)+'px';s.style.background='var(--shade)';s.dataset.c=ci;s.dataset.f=fi;el.appendChild(s);stickers[ci].push(s);
  }
  cubeEl.appendChild(el);faceEls.push(el);
});
let scaleK=1;const setH=()=>{const st=document.getElementById('stage');scaleK=Math.max(.6,Math.min(1.5,Math.min(st.clientWidth,st.clientHeight)/320));apply()};
const $=id=>document.getElementById(id);

// ---------- state ----------
let tier=1,P,vals,locked,pm,sel=-1,selFace=-1,stage=1,turns=0,playerMoves=[],hintsLeft=3,hintsUsed=0,hintArrow=null;
let stars=new Set(),starWon=new Set(),regularLocked=false;
let hold=false; // the clock is held during the intro animation and countdown
let t0=0,t1=0,t2=0,wrong=0,blanks=0,penMode=false,gaveUp=false,aligned=false;
const alignMemo=new Map();
const clueGrid=()=>vals.map((v,i)=>locked[i]?v:0);
function computeAligned(){const g=clueGrid(),k=g.join();if(!alignMemo.has(k))alignMemo.set(k,solveCount(g,1,60000)[0]>0);return alignMemo.get(k)}
// an unscored cube: random, made here, never sent
// (if today's cube arrives first, it wins: the stand-in is dropped)
function newGame(){daily=false;$('status').textContent='Building a cube…';setTimeout(()=>{if(daily)return;P=makePuzzle(tier,level);restart();splashReady()},20)}
// Practice is a guided walkthrough, outside the day: one turn to undo, then a half-filled cube
const isPrac=()=>!!P&&P.tier===PRACTICE;
// ---------- today's cube, from the server ----------
// Everyone gets the same cube each day. How far it's turned is picked once a day:
// pressing Play sets it until tomorrow (Practice sits outside the board).
// With no server or no login the game still plays, unscored, on a cube made here.
let D=null,online=false,daily=false,sent=false,tkUsed=false;
let paused=false,pausedAt=0,retries=0,lastScore=null;
let today=dayKey();
let twistDay=null;
// today's fill difficulty: 0 Easy, 1 Medium, 2 Hard. The server sends it; offline it comes from the weekday
let level=levelOf(today);
const offlineTwist=()=>{try{const v=JSON.parse(localStorage.getItem('nonet-twist')||'null');if(v&&v.d===today&&tierAllowed(level,v.t))return v.t}catch(e){}return null};
function lockTwist(t){twistDay=t;if(!online){try{localStorage.setItem('nonet-twist',JSON.stringify({d:today,t}))}catch(e){}}applyTwistLock()}
// opens today's cube at tier t: the server locks the tier for the day and sends its cube
async function playDaily(t){
  if(!online){lockTwist(t);tier=t;newGame();return}
  $('status').textContent='Getting today\'s cube…';
  const r=await startDay({tier:t});
  if(!r){tier=t;newGame();setTimeout(()=>{$('status').textContent=(lastError||'Could not reach the server.')+' This cube is unscored.'},40);return}
  tier=r.tier;lockTwist(r.tier);P=r.puzzle;daily=true;sent=false;
  document.querySelectorAll('#tierSeg button').forEach(x=>x.setAttribute('aria-pressed',+x.dataset.t===tier));
  restart();
}
async function loadDaily(){
  const r=await getDaily();
  if(r&&r.loggedIn){D=r;online=true;today=r.day;level=r.level??levelOf(today);twistDay=r.my.tier??null;retries=r.my.retries||0}else{online=false;level=levelOf(today);twistDay=offlineTwist()}
  if(!tierAllowed(level,tier)&&tier!==PRACTICE)tier=Math.min(1,maxTurns(level));
  if(twistDay!==null)tier=twistDay;
  applyTwistLock();
  // locked in earlier today: today's cube waits behind the start screen, paused,
  // and picks up where you left it if this device saved a run
  if(online&&r.puzzle){P=r.puzzle;daily=true;sent=r.my.score!==undefined;restart();if(!sent){restoreRun();pauseNow()}}
  renderSplashExtras();splashTwist();
  $('spPlay').disabled=false;
  journey.ready();
}
function applyTwistLock(){
  const lk=twistDay!==null;
  // Hard days stop at 2 turns; each button shows today's multiplier for its turns
  document.querySelectorAll('#spTwists button').forEach(x=>{const t=+x.dataset.t;x.hidden=!tierAllowed(level,t);x.disabled=lk&&t!==twistDay;x.querySelector('b').textContent=`×${multOf(level,t)}`});
  document.querySelectorAll('#tierSeg button').forEach(x=>{const t=+x.dataset.t;x.hidden=t!==PRACTICE&&!tierAllowed(level,t);x.disabled=lk&&t!==twistDay&&t!==PRACTICE;x.setAttribute('aria-pressed',t===tier)});
}
// splash: your place on this week's board. One cube a day; more turns, bigger multiplier; the top nine are the Nine.
let splashUp=true;
const ord=n=>n+(n%100>10&&n%100<14?'th':['th','st','nd','rd'][n%10]||'th');
const num=n=>Math.round(n).toLocaleString('en-GB');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
// the start screen, and the pause screen: a cover read from the right. The spine has the cube number and date;
// the issue box has the number, the most a run can score today and the difficulty; the Play block picks the rotations.
const longDate=d=>new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const rotName=t=>`${t} rotation${t===1?'':'s'}`;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],WDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
// the most a run can score today: every point on offer at the most rotations, all three ★
const maxScore=lv=>{const t=maxTurns(lv);return scoreRun(lv,t,{turns:t,t1:0,t2:0,blanks:1,wrong:0,hintsUsed:0,starsWon:3}).total};
function splashTwist(){
  const d=new Date(today+'T12:00:00Z');
  $('spDate').innerHTML=`${WDAYS[d.getUTCDay()]} <span class="cv-dm"><span class="cv-tcy">${d.getUTCDate()}</span> ${MONTHS[d.getUTCMonth()]}</span>`;
  $('spNo').textContent=D?String(D.cubeNo):'–';
  $('spKanji').textContent=D?kanjiNo(D.cubeNo):'〇〇〇';
  $('spLevel').textContent=LEVEL_NAMES[level];
  $('spPips').querySelectorAll('i').forEach((x,k)=>x.classList.toggle('on',k<=level));
  $('spMax').textContent=num(maxScore(level));
  $('spIssue').setAttribute('aria-label',`${D?`Cube ${D.cubeNo}, `:''}${longDate(today)}. ${LEVEL_NAMES[level]}. Max score ${num(maxScore(level))}.`);
  const lk=twistDay!==null;
  $('spScrCap').textContent=lk?`Set for today · ${rotName(twistDay)} · ×${multOf(level,twistDay)}`:'Rotation multiplier';
  const done=online&&D&&D.my.score!==undefined,isPaused=paused&&!sent&&stage<3;
  $('splash').classList.toggle('is-paused',isPaused);
  $('spPlay').textContent=isPaused?'Resume':done?'See today\'s cube':'Play today\'s cube';
  let sub='';
  if(!online)sub='Log in to Reddit to play for points. Until then cubes are unscored.';
  else if(done)sub=`Done today: ${num(D.my.score)} points${D.boards.day.me?` · #${D.boards.day.me.rank} today`:''}. Next cube in ${untilNext()}.`;
  else if(isPaused)sub=`Paused at ${fmt(nowSec()+(stage===2?t1:0))}. The clock is stopped.`;
  $('spSub').textContent=sub;
  const st=D&&D.stats;
  $('spStats').hidden=!online;
  if(online)$('spStats').innerHTML=`<div><dt>Fastest today</dt><dd>${st&&st.solves?fmt(st.fastest):'–'}</dd></div><div><dt>Solved today</dt><dd>${num(st?st.solves:0)}</dd></div>`;
  document.querySelectorAll('#spTwists button').forEach(x=>x.setAttribute('aria-pressed',+x.dataset.t===tier));
}
// time until midnight Pacific, when the next cube comes
function untilNext(){const m=msUntilNextDay(),h=Math.floor(m/3600000),mi=Math.floor(m%3600000/60000);return h?`${h}h ${mi}m`:`${mi}m`}
// a face-by-face look at a cube's clues: six 3×3 faces, digits where the clues are
function cluesNet(given){let h='<div class="net">';for(let f=0;f<6;f++){h+='<div class="nf">';for(let k=0;k<9;k++){const v=given[f*9+k];h+=`<span>${v||''}</span>`}h+='</div>'}return h+'</div>'}
function peekHTML(p){return `<h3>Tomorrow's clues</h3><p>You locked all three ★ first, so here's tomorrow's cube with its clues home. Tomorrow it starts turned.</p>${cluesNet(p.given)}`}
function eventHTML(es){const e=es.event,teams=es.teams;
  let h=`<h3>${esc(e.title)}</h3>${e.tagline?`<p>${esc(e.tagline)}</p>`:''}<p class="meta">Day ${es.dayOf} of ${es.days}${e.bonusMult>1?` · ×${e.bonusMult} event points`:''}</p>`;
  if(teams.length){
    if(!es.myTeam&&online)h+=`<p>Pick your side. It holds for the whole event.</p><div class="sides">${teams.map(t=>`<button data-team="${esc(t.team.id)}" style="--side:${esc(t.team.color||'var(--washi)')}">${esc(t.team.name)}</button>`).join('')}</div>`;
    h+=`<ol class="teams">${teams.map(t=>`<li${t.team.id===es.myTeam?' class="mine"':''} style="--side:${esc(t.team.color||'var(--washi)')}"><b>${esc(t.team.name)}</b><span>${num(t.score)}${e.teamScoring==='avg'?' a player':''} · ${t.players} playing</span></li>`).join('')}</ol>`;
  }
  const b=es.board;if(b.top.length)h+=`<ol class="mini">${b.top.slice(0,3).map(r=>`<li><span>${r.rank}. ${esc(r.name)}</span><span>${num(r.score)}</span></li>`).join('')}${b.me&&b.me.rank>3?`<li class="mine"><span>${b.me.rank}. you</span><span>${num(b.me.score)}</span></li>`:''}</ol>`;
  return h}
// on the start screen the event is one line until tapped
function eventLine(es){const e=es.event,mine=es.teams.find(t=>t.team.id===es.myTeam);
  return `<button class="chip" type="button" aria-expanded="false"><b>${esc(e.title)}</b><span>Day ${es.dayOf} of ${es.days}${mine?` · you're ${esc(mine.team.name)}, #${mine.rank}`:es.teams.length&&online?' · pick your side':''}</span></button><div class="more" hidden>${eventHTML(es)}</div>`}
function wireChip(root){const c=root.querySelector('.chip');if(c)c.onclick=()=>{const m=root.querySelector('.more'),open=m.hidden;m.hidden=!open;c.setAttribute('aria-expanded',open);if(open)journey.interaction('view_event')}}
function wireSides(root){root.querySelectorAll('.sides button').forEach(b=>b.onclick=async()=>{b.disabled=true;
  const r=await joinTeam({eventId:D.event.event.id,team:b.dataset.team});if(r){D.event=r.event;journey.interaction('pick_team',b.dataset.team);renderSplashExtras();if(lastScore)renderEndCard()}else{b.disabled=false;b.textContent=lastError||'Try again'}})}
function renderSplashExtras(){
  const s=D&&D.streak;$('spStreak').hidden=!(online&&s&&s.current);
  if(online&&s&&s.current)$('spStreak').innerHTML=`<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M8 1c.6 3-1.2 4.6-2.6 6.2C4 8.8 3 10.4 3 12.6 3 16 5.3 19 8 19s5-3 5-6.4c0-2.3-1-3.9-2-5-.2 1.5-.9 2.6-2 3.1.4-2.6.2-6.4-1-9.7Z" fill="#23252b"/><path d="M8 18c-1.4 0-2.4-1.2-2.4-2.7 0-1.4.9-2.3 1.7-3.2.1 1 .6 1.6 1.3 1.8.1-.9.5-1.6 1.1-2.1.6.9 1 1.9 1 3.3C10.7 16.7 9.5 18 8 18Z" fill="#f5c12e"/></svg><span>${s.current}-day streak</span>`,$('spStreak').title=`${s.current} day${s.current===1?'':'s'} in a row · best ${s.best}`;
  const ev=D&&D.event;$('spEvent').hidden=!ev;
  if(ev){const m0=$('spEvent').querySelector('.more'),open=m0?!m0.hidden:false;$('spEvent').innerHTML=eventLine(ev);if(open&&$('spEvent').querySelector('.more'))$('spEvent').querySelector('.more').hidden=false;wireChip($('spEvent'));wireSides($('spEvent'));document.documentElement.style.setProperty('--event',ev.event.accent||'var(--yellow)')}
  {const h=online&&D?splashDuelsHTML(D.duels||[]):'';let el=$('spDuels');if(!el&&h){el=document.createElement('section');el.id='spDuels';el.className='duelsSplash';$('spPeek').after(el)}if(el){el.hidden=!h;el.innerHTML=h;wireAnswers(el,d=>{if(D)D.duels=d;journey.interaction('answer_challenge',String(d.length));renderSplashExtras()})}}
  $('spPeek').hidden=!(D&&D.preview);
  if(D&&D.preview){$('spPeek').innerHTML=`<button class="chip" type="button" aria-expanded="false"><b>Tomorrow's clues</b><span>unlocked with all three ★</span></button><div class="more" hidden>${cluesNet(D.preview.given)}</div>`;wireChip($('spPeek'))}
}
function splashReady(){if(!splashUp)return;splashTwist()}
document.querySelectorAll('#spTwists button').forEach(b=>b.onclick=()=>{if(twistDay!==null)return;tier=+b.dataset.t;splashTwist();
  document.querySelectorAll('#tierSeg button').forEach(x=>x.setAttribute('aria-pressed',+x.dataset.t===tier));journey.interaction('pick_turns',String(tier))});
function hideSplash(){splashUp=false;$('splash').classList.add('out');setTimeout(()=>{if(!splashUp)$('splash').hidden=true},400)}
function hideSplashNow(){splashUp=false;const sp=$('splash');sp.classList.add('out');sp.hidden=true}
function showSplash(){if(stage===3)music.leave();splashUp=true;$('splash').hidden=false;requestAnimationFrame(()=>$('splash').classList.remove('out'));splashTwist();renderSplashExtras()}
// Play and Resume: cells cover the screen, become the cube and fold together; the clock starts after
$('spPlay').onclick=()=>{
  if(tx.busy)return;music.unlock();
  if(daily&&P&&P.tier===tier){void tx.enter({before:()=>{hideSplashNow();holdClock()},done:()=>{releaseClock();if(paused)resume()}});return} // today's cube is already here
  journey.start();
  void tx.enter({before:hideSplashNow,ready:playDaily(tier).then(()=>{holdClock();return new Promise(r=>setTimeout(r,60))}),
    done:releaseClock})};

// ---------- pause ----------
// pausing stops the clock and covers the cube with the start screen, which shows Resume
function pauseNow(){if(paused||stage===3||!P)return;paused=true;music.hold(true);if(hold)hold=false;else pausedAt=performance.now();$('modal').hidden=true;saveRun()}
// any move while paused starts the clock again first, so time is never lost or gained
function ensureRunning(){if(!paused)return;if(splashUp)hideSplash();resume()}
function pause(){if(paused||stage===3||!P||isPrac()||tx.busy)return;pauseNow();journey.interaction('pause');sel=-1;render();void tx.leave({covered:showSplash})}
function resume(){if(!paused)return;t0+=performance.now()-pausedAt;paused=false;music.hold(false);
  if(!journey.active)journey.start();else journey.interaction('resume');updateStatus()}
$('pauseBtn').onclick=pause;
music.wire($('soundBtn'));
// Practice sits outside the day: a guided walkthrough, no score, open any time
$('spPractice').onclick=()=>{if(tx.busy)return;music.unlock();tier=PRACTICE;journey.start();
  void tx.enter({before:hideSplashNow,ready:new Promise(r=>{newGame();setTimeout(r,120)}),done:()=>{if(paused)resume()}})};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!splashUp&&stage<3&&P&&!isPrac()){pauseNow();showSplash()}});
// leaving mid-cube: the run is saved here to resume later, and this journey ends unfinished
window.addEventListener('pagehide',()=>{if(stage<3&&P){pauseNow();saveRun()}if(journey.active&&stage<3)journey.end(false,false,0)});

// ---------- saved run ----------
// today's run is kept on this device, so leaving and coming back resumes it
const RUN_KEY='nonet-run';
function saveRun(){if(!daily||sent||!P||stage===3)return;
  try{localStorage.setItem(RUN_KEY,JSON.stringify({day:today,tier:P.tier,vals,locked,pm,stage,turns,playerMoves,hintsLeft,hintsUsed,wrong,
    stars:[...stars],starWon:[...starWon],regularLocked,t:nowSec(),t1,blanks,retries}))}catch(e){}}
function clearRun(){try{localStorage.removeItem(RUN_KEY)}catch(e){}}
function restoreRun(){let v;try{v=JSON.parse(localStorage.getItem(RUN_KEY)||'null')}catch(e){}
  if(!v||v.day!==today||v.tier!==P.tier||(v.retries||0)!==retries)return false;
  ({vals,locked,pm,stage,turns,playerMoves,hintsLeft,hintsUsed,wrong,regularLocked,t1,blanks}=v);
  stars=new Set(v.stars);starWon=new Set(v.starWon);t0=performance.now()-v.t*1000;
  $('banner').hidden=true;
  lastStage=stage;render();return true}
let saveT=0;const saveSoon=()=>{clearTimeout(saveT);saveT=setTimeout(saveRun,400)};

// ---------- retry and give up ----------
// one retry a day on today's cube: it starts again from the turned cube, and the day's total is ×0.8
function ask(title,body,buttons){const m=$('modal');$('modalTitle').textContent=title;$('modalBody').innerHTML=body;
  $('modalActs').innerHTML='';buttons.forEach(([label,fn,cls])=>{const b=document.createElement('button');b.textContent=label;if(cls)b.className=cls;
    b.onclick=()=>{m.hidden=true;if(fn)fn()};$('modalActs').appendChild(b)});m.hidden=false;$('modalActs').lastElementChild?.focus()}
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))$('modal').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modal').hidden)$('modal').hidden=true});
const canRetry=()=>daily&&!sent&&retries===0&&stage<3;
async function doRetry(){const r=await useRetry();if(!r){ask('Retry not available',`<p>${esc(lastError||'Could not reach the server.')}</p>`,[['OK']]);return}
  retries=r.retries;if(D)D.my.retries=retries;journey.interaction('retry');clearRun();restart();if(splashUp)hideSplash();updateRunButtons()}
function askRetry(){
  if(!daily){restart();return}
  if(!canRetry()){ask('Retry used',"<p>You've used today's retry. Keep going: the cube is still yours to finish.</p>",[['Keep playing',null,'primary']]);return}
  ask('Retry today\'s cube?',`<p>You start again from the turned cube, with the clock reset. Today's total is <b>×${RETRY_MULT}</b>. You get one retry a day.</p>`,
    [['Keep playing'],[`Retry (×${RETRY_MULT})`,doRetry,'primary']])}
function giveUp(){gaveUp=true;paused=false;if(splashUp)hideSplash();journey.interaction('give_up');
  if(daily&&!sent){sent=true;clearRun();void sendScore({day:today,tier:P.tier,forfeit:true,stats:runStats()},journey.id()).then(r=>{journey.endedByServer();if(r&&D){D.my={...D.my,tier:P.tier,score:r.total,starsWon:0};D.streak=r.streak;D.boards=r.boards;splashTwist();renderSplashExtras()}})}
  else journey.end(false,false,0);
  vals=P.sol.slice();locked=P.given.map(Boolean);sel=-1;stage=3;$('banner').hidden=true;$('results').hidden=true;render();updateStatus();updateRunButtons()}
function askGiveUp(){if(!P||stage===3)return;
  if(!daily){ask('Give up?','<p>The answer is shown and this cube ends. It was unscored.</p>',[['Keep playing'],['Show the answer',giveUp,'danger']]);return}
  const b=[['Keep playing']];if(canRetry())b.push([`Retry instead (×${RETRY_MULT})`,doRetry,'primary']);b.push(['Give up for today',giveUp,'danger']);
  ask('Give up today\'s cube?',`<p>Giving up shows the answer and ends today at 0 points.${canRetry()?` Or use today's one retry: start over, and the total is ×${RETRY_MULT}.`:''}</p>`,b)}
function updateRunButtons(){const r=$('restart');
  if(daily&&!sent){r.textContent=retries?'Retry used':`Retry (×${RETRY_MULT})`;r.disabled=!!retries||stage===3}else{r.textContent='Restart';r.disabled=false}
  $('pauseBtn').hidden=stage===3||!P||isPrac()}
function showRules(){journey.interaction('rules');const r=$('rules');ask('How to play','',[['Got it',null,'primary']]);const box=$('modalBody');r.hidden=false;box.appendChild(r)}
$('spHelp').onclick=showRules;$('helpBtn').onclick=showRules;
function restart(){setLayout(P.layout||'mirror');alignMemo.clear();paused=false;tkUsed=false;vals=P.start.slice();locked=P.start.map(Boolean);pm=new Array(N).fill(0);sel=-1;selFace=-1;stage=1;turns=0;playerMoves=[];
  hintsLeft=3;hintsUsed=0;hintArrow=null;wrong=0;stars=new Set();starWon=new Set();regularLocked=false;gaveUp=false;t0=performance.now();t1=t2=0;$('banner').hidden=true;$('results').hidden=true;$('showRes').hidden=true;penMode=false;render();updateRunButtons();coachTurn()}
// Practice step 1: the cube is one turn out, and the turn that puts it back pulses
function coachTurn(){if(!isPrac()||stage!==1)return;$('banner').hidden=false;
  $('banner').textContent='Practice, step 1 of 2: turning. One row or column of this cube is turned out of place, so the bold clues are scattered. Press the pulsing arrow to turn it back. On your own, tap any square and its arrows turn its row or column.';
  showHint(true)}
const nowSec=()=>Math.max(0,((paused||hold?pausedAt:performance.now())-t0)/1000);
function holdClock(){if(!hold&&!paused){hold=true;pausedAt=performance.now()}}
function releaseClock(){if(hold){t0+=performance.now()-pausedAt;hold=false}}
const fmt=s=>{s=Math.max(0,Math.round(s));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};

// ---------- scoring ----------
const speedPts=(max,T,t)=>Math.round(max*Math.max(0,Math.min(1,(3*T-t)/(2*T))));
const runStats=()=>({turns,t1,t2,blanks,wrong,hintsUsed,starsWon:starWon.size});
// scored tiers use the same scoring as the server (shared/scoring.ts); Practice shows a fill-only tally
function score(){
  const T=TIERS[P.tier],par=P.k;
  if(!isPrac())return{...scoreRun(P.level??level,P.tier,runStats()),tut:false,name:`${LEVEL_NAMES[P.level??level]} · ${T.name}`};
  const T2=6*blanks,sp2=speedPts(300,T2,t2),acc=Math.max(0,200-25*wrong),starPts=50*starWon.size,raw=sp2+acc+starPts;
  return{turnPts:0,sp1:0,sp2,acc,bonus:0,starPts,raw,total:raw,tut:true,T1:0,T2,par,mult:1,name:T.name};
}

function finishStage1(){
  t1=nowSec();stage=2;sel=-1;
  // lock the clues where they are; the fill starts from here
  blanks=vals.filter(v=>!v).length;t0=performance.now();
  // today's cube comes with its three ★ picked, so everyone gets the same ones; if the clues
  // lined up somewhere else, any ★ that is no longer empty is swapped for one found here
  const order=singlesOrder(vals);const pool=order.length?order.slice(0,10):vals.map((v,i)=>v?-1:i).filter(i=>i>=0);
  const fixed=(P.stars||[]).filter(i=>!vals[i]);
  stars=isPrac()?new Set():new Set([...fixed,...shuffle(pool.filter(i=>!fixed.includes(i)))].slice(0,3));
  if(P.k>0)journey.progress(.5,'aligned');
  $('banner').hidden=!isPrac(); // a scored run goes straight on: no Stage 1 summary
  $('banner').textContent=isPrac()?`Practice, step 2 of 2: filling. Lined up! Half the cube is filled in for you. Every face holds 1 to 9 once, and so does each coloured line of nine across three faces. Tap an empty square and pick a digit to pencil it in, then switch to Pen to lock it. Start where only one digit fits. A wrong lock is flagged so you can learn from it. Nothing is timed or scored.`:P.k===0?`No turns today: fill the cube. Lock the three ★ squares first for +50 each.`:`Stage 1 done in ${turns} turn${turns===1?'':'s'} (fewest ${P.k}) and ${fmt(t1)}. Fill the cube. Lock the three ★ squares first for +50 each.`;
}
function finishStage2(){
  t2=nowSec();stage=3;sel=-1;clearRun();
  $('banner').hidden=true;updateRunButtons();
  if(isPrac()){journey.end(true,true,0);$('results').hidden=false;$('results').innerHTML=`<h2>Practice complete</h2><p>You turned the cube home and filled it${wrong?` with ${wrong} wrong lock${wrong===1?'':'s'}`:' with no wrong locks'}. Today's cube works the same way, with fewer clues. Pick how many turns scramble it, or none and just fill it in.</p><button id="toEasy" class="primary">Try today's cube</button>`;
    $('toEasy').onclick=()=>{tier=twistDay??Math.min(1,maxTurns(level));showSplash()};return}
  runScore=score();lastScore=null;
  if(!daily||tkUsed)journey.end(true,true,daily?0:runScore.total);
  renderEndCard();void submitRun();
  requestAnimationFrame(()=>$('results').scrollIntoView({behavior:'smooth',block:'start'}));
}
let runScore=null,endTab='';
const resultText=s=>`Nonet${D?` #${D.cubeNo}`:''} · ${s.name} · solved in ${fmt(t1+t2)}${lastScore?` · ${num(lastScore.total)} pts`:''}\n★${starWon.size}/3 · ${wrong} miss${wrong===1?'':'es'}${hintsUsed?` · ${hintsUsed} hint${hintsUsed===1?'':'s'}`:' · no hints'}${retries?' · 1 retry':''}`;
// the end card: one card with the time and points, how you did today, your streak, then what next
function renderEndCard(){const s=runScore;if(!s)return;const r=lastScore,el=$('results');el.hidden=false;$('showRes').hidden=true;
  const pen=daily&&retries?RETRY_MULT:1,total=r?r.total:Math.round(s.total*pen),scored=daily&&!tkUsed;
  const st=D&&D.streak,me=r&&r.boards.day.me;
  let rank='';
  if(!scored)rank=`<p class="why">${tkUsed?'Test tools were used, so this run is not sent.':online?"Unscored cube: only today's cube counts.":'Unscored: log in to Reddit to play for points.'}</p>`;
  else if(!r)rank=`<p class="why" id="srvMsg">Sending your score…</p>`;
  else if(!r.counted)rank=`<p class="why">Today already counted: your first finished run, ${num(r.total)} points.</p>`;
  else rank=`<p class="rank">${r.boards.day.players>1&&r.beatPct>0?`Better than <b>${r.beatPct}%</b> of today's players · `:''}<b>#${me?me.rank:'–'}</b> today${r.boards.week.me&&r.boards.week.me.rank<=9?' · in the Nine this week':''}</p>`;
  const streak=scored&&st&&st.current?`<p class="streakline"><i></i><b>${st.current}-day streak</b><span>best ${st.best}</span></p>`:'';
  const pv=D&&D.preview?`<div class="peek">${peekHTML(D.preview)}</div>`:scored&&starWon.size<3?'<p class="meta">Lock all three ★ first to see tomorrow\'s clues.</p>':'';
  const sub=D&&D.subreddit?`r/${esc(D.subreddit)}`:'the subreddit';
  const more=`<div class="more"><h3>Want more Nonet?</h3><div class="acts"><button id="eComment" class="primary">Comment your time</button>${online?`<button id="eJoin">Join ${sub}</button>`:''}</div>
    ${online?`<label class="toggle"><input type="checkbox" id="eNotify"${D&&D.notify?' checked':''}><span>Notify me when tomorrow's cube is out</span></label>`:''}
    <p class="next">Next cube in <b id="eNext">${untilNext()}</b></p></div>`;
  const tabs=[['points','Points'],...(r?[['boards','Boards']]:[]),...(D&&D.event?[['event',esc(D.event.event.title)]]:[])];
  const panel=t=>t==='points'?pointsTable(s,pen):t==='boards'?boardsHTML(r):t==='event'?`<div class="event">${eventHTML(D.event)}</div>`:'';
  el.innerHTML=`<button class="close" id="eClose" aria-label="Close">✕</button>
  <h2>Solved in ${fmt(t1+t2)}</h2><div class="total">${num(total)} pts<small>${s.name}${pen<1?` · retry ×${pen}`:''}</small></div>
  ${rank}${streak}${scored?duelsHTML(D&&D.duels||[],!!r):''}${more}${pv}
  <div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" data-tab="${k}" aria-selected="${endTab===k}">${l}</button>`).join('')}</div>
  <div class="tabpanel" id="eTab"${endTab?'':' hidden'}>${endTab?panel(endTab):''}</div>`;
  el.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{endTab=endTab===b.dataset.tab?'':b.dataset.tab;if(endTab)journey.interaction('view_board',endTab);renderEndCard()});
  wireSides(el);
  wireDuels(el,d=>{if(D)D.duels=d;journey.interaction('challenge',String(d.length));renderEndCard()});
  $('eClose').onclick=()=>{el.hidden=true;$('showRes').hidden=false};
  $('eComment').onclick=ev=>{const txt=resultText(s);journey.interaction('share','comment');
    const done=()=>{$('eComment').textContent='Copied. Paste it in the comments';try{exitExpandedMode(ev)}catch(e){}};
    navigator.clipboard.writeText(txt).then(done,()=>{ask('Your result','<pre class="copy"></pre><p>Copy this, then paste it in the post\'s comments.</p>',[['Done',null,'primary']]);$('modalBody').querySelector('pre').textContent=txt})};
  if($('eJoin'))$('eJoin').onclick=async()=>{$('eJoin').disabled=true;journey.interaction('join');const j=await joinSub();$('eJoin').textContent=j?'Joined':lastError||'Try again';if(!j)$('eJoin').disabled=false};
  if($('eNotify'))$('eNotify').onchange=async e=>{const on=e.target.checked;journey.interaction(on?'notify_on':'notify_off');const n=await setNotify(on);if(n&&D)D.notify=n.notify;else{e.target.checked=!on;$('eNext').textContent=lastError||'Notifications are unavailable'}};
}
$('showRes').onclick=()=>{$('results').hidden=false;$('showRes').hidden=true};
setInterval(()=>{const n=$('eNext');if(n&&!$('results').hidden)n.textContent=untilNext()},30000);
function pointsTable(s,pen){return `<table>
   ${s.tut?'':`<tr><td>Stage 1 turns</td><td>${s.turnPts} / 300</td></tr><tr class="sub"><td>${turns} used, fewest ${s.par}</td><td></td></tr>
   <tr><td>Stage 1 speed</td><td>${s.sp1} / 200</td></tr><tr class="sub"><td>${fmt(t1)} vs ${fmt(s.T1)} target</td><td></td></tr>`}
   <tr><td>Stage 2 speed</td><td>${s.sp2} / 300</td></tr><tr class="sub"><td>${fmt(t2)} vs ${fmt(s.T2)} target (${blanks} squares)</td><td></td></tr>
   <tr><td>Stage 2 accuracy</td><td>${s.acc} / 200</td></tr><tr class="sub"><td>${wrong} wrong lock${wrong===1?'':'s'} × −25</td><td></td></tr>
   <tr><td>Lock-first squares</td><td>${s.starPts} / 150</td></tr><tr class="sub"><td>${starWon.size} of 3 locked before any other square</td><td></td></tr>
   ${s.tut?'':`<tr><td>No-hint bonus</td><td>${s.bonus} / 100</td></tr><tr class="sub"><td>${hintsUsed} suggested turn${hintsUsed===1?'':'s'} used</td><td></td></tr>`}
   <tr><td>Subtotal × ${s.mult}</td><td>${s.raw} × ${s.mult}</td></tr>
   ${pen<1?`<tr><td>Retry</td><td>× ${pen}</td></tr>`:''}
  </table>`}
function boardsHTML(r){const row=b=>`<div class="board"><h4>${esc(b.label)} · ${num(b.players)} player${b.players===1?'':'s'}</h4><ol>${b.top.map(x=>`<li${b.me&&b.me.rank===x.rank?' class="mine"':''}><span>${x.rank}. ${esc(x.name)}</span><span>${num(x.score)}</span></li>`).join('')}${b.me&&b.me.rank>b.top.length?`<li class="mine"><span>${b.me.rank}. you</span><span>${num(b.me.score)}</span></li>`:''}</ol></div>`;
  return row(r.boards.day)+row(r.boards.week)}

// sends a finished run of today's cube; only the first finished run each day counts
async function submitRun(){
  if(!daily||tkUsed)return;
  if(sent){lastScore=null;if(D&&D.my.score!==undefined)lastScore={counted:false,total:D.my.score,boards:D.boards,beatPct:0};renderEndCard();return}
  sent=true;
  const r=await sendScore({day:today,tier:P.tier,stats:runStats()},journey.id());
  journey.endedByServer();
  if(!r){const m=$('srvMsg');if(m)m.textContent=`Not counted: ${lastError||'could not reach the server'}`;return}
  lastScore=r;
  if(D){D.my={...D.my,tier:P.tier,score:r.total,starsWon:starWon.size};D.streak=r.streak;D.boards=r.boards;D.event=r.event;D.preview=r.preview;D.stats=r.stats;D.duels=r.duels;renderSplashExtras();splashTwist()}
  renderEndCard();
}

// ---------- render ----------
function render(){
  if(!P)return;
  const T=TIERS[P.tier];
  const nClues=P.given.filter(Boolean).length,home=locked.reduce((n,l,i)=>n+(l&&P.given[i]===vals[i]?1:0),0);
  aligned=home===nClues||computeAligned();
  if(stage===1&&aligned&&!gaveUp){finishStage1()}
  const bad=new Set();
  for(const g of groups){const seen={};for(const i of g)if(vals[i]){(seen[vals[i]]??=[]).push(i)}
    for(const k in seen)if(seen[k].length>1)seen[k].forEach(i=>bad.add(i))}
  const by={};if(sel>=0)for(const k of lineIdxOf[sel])(by[Math.floor(k/6)]??=[]).push(k);
  const la=new Set(),lb=new Set(),okSet=new Set(),twin=new Set(),done=new Set(),ov=new Set();
  const complete=l=>{const vs=l.map(i=>vals[i]);return vs.every(Boolean)&&new Set(vs).size===9};
  if(stage>=2)for(const l of lines)if(complete(l))l.forEach(i=>okSet.add(i));
  if(stage===1&&sel>=0)for(const l of lines){if(!l.includes(sel))continue;const cl=l.filter(i=>locked[i]);if(cl.length>=2&&cl.every(i=>P.given[i]===vals[i]))l.forEach(i=>done.add(i))}
  const settled=stage===1&&!gaveUp?settledCells():new Set();
  if(sel>=0)Object.keys(by).sort().forEach((ax,n)=>{const arr=by[ax],l=lines[arr[lc%arr.length]];
    const tgt=stage>=2&&complete(l)?done:(n===0?la:lb);l.forEach(i=>tgt.add(i));
    // a ring's two lines share the six squares on two opposite faces (blue). So each line's other three
    // squares hold the same three digits as the three across the cube that the shown line leaves out (dashed).
    const q=ringOf(arr[0]),other=new Set(lines[2*q+1]);
    if(tgt!==done)for(const i of lines[2*q])if(other.has(i))ov.add(i);
    if(stage===2){const L=new Set(l);for(const i of ringCells(q))if(!L.has(i))twin.add(i)}});
  const showHome=stage>1||!T.hideHome||aligned;
  cells.forEach((_,i)=>stickers[i].forEach(s=>{
    if(vals[i]){if(s.dataset.v!=String(vals[i])){s.innerHTML=digitSVG(vals[i]);s.dataset.v=vals[i]}}
    else if(pm[i]){const d=Math.log2(pm[i]&-pm[i]);if(s.dataset.v!=='p'+d){s.innerHTML=digitSVG(d).replace('class="dg"','class="dg pen"');s.dataset.v='p'+d}}
    else{s.textContent='';s.dataset.v=''}
    s.classList.toggle('given',locked[i]);s.classList.toggle('bad',bad.has(i)&&stage===1);
    s.classList.toggle('sel',i===sel);s.classList.toggle('la',la.has(i)&&i!==sel);s.classList.toggle('lb',lb.has(i)&&i!==sel&&!la.has(i));s.classList.toggle('done',done.has(i)&&i!==sel&&!la.has(i)&&!lb.has(i));s.classList.toggle('star',stage===2&&stars.has(i)&&!vals[i]&&!regularLocked);s.classList.toggle('starwon',starWon.has(i));s.classList.toggle('ok',okSet.has(i));
    s.classList.toggle('home',stage===1&&locked[i]&&showHome&&(aligned||P.given[i]===vals[i]));s.classList.toggle('twin',twin.has(i));s.classList.toggle('ov',ov.has(i));s.classList.toggle('settled',settled.has(i));
  }));
  const left=vals.filter(v=>!v).length;
  if(stage===2&&P.k>0&&blanks&&left<=blanks/2)journey.progress(.75,'half_filled');
  if(stage===2&&left===0&&bad.size===0)finishStage2();
  if(stage<3)saveSoon();
  // the progress is a switch: the stage you're on takes most of the row, the other shrinks to its name
  $('step1').className='pstage '+(stage===1?'on':'done');$('step2').className='pstage '+(stage===2?'on':stage===3?'done':'');
  $('progress').className=`progress ${P.k===0?'solo':stage===1?'s1':'s2'}`;$('views').hidden=stage!==1;
  $('pTurns').textContent=`${turns} turn${turns===1?'':'s'} · fewest ${P.k}`;
  setBar('pAlign',stage===1?home/nClues:1);const tot=blanks||P.start.filter(v=>!v).length;setBar('pFill',stage===1?0:stage===3?1:tot?1-left/tot:0);
  music.update({stage,progress:stage===1?home/nClues:tot?1-left/tot:1,lines:stage===2?lines.reduce((n,l)=>n+(complete(l)?1:0),0):0,gaveUp});
  showTip();
  $('tools1').hidden=stage!==1;$('tools2').hidden=stage!==2;$('pad').hidden=stage!==2;
  $('suggest').disabled=hintsLeft<=0||stage!==1;$('suggest').hidden=P.k===0||isPrac();$('step1').hidden=P.k===0;$('suggest').textContent=`Suggest a turn (${hintsLeft} left)`;
  $('mPencil').setAttribute('aria-pressed',!penMode);$('mPen').setAttribute('aria-pressed',penMode);
  stageEl.classList.toggle('aligned',stage===2);stageEl.classList.toggle('solved',stage===3);
  // the grid flashes yellow once when the cube lines up and once when it is solved; tutorials skip the align flash
  if(stage!==lastStage){if(lastStage>0&&((stage===2&&P.k>0)||stage===3)){stageEl.classList.add('gridflash');clearTimeout(flashT);flashT=setTimeout(()=>stageEl.classList.remove('gridflash'),900)}lastStage=stage}
  updateStatus();
  placeArrows();
}
// stage progress: Align fills with the share of clues home, Fill with the share of blanks filled
function setBar(id,f){const p=Math.round(Math.max(0,Math.min(1,f))*100);const b=$(id);b.firstElementChild.style.width=p+'%';b.setAttribute('aria-valuenow',p);$(id+'Val').textContent=p+'%'}
// a nudge, not the answer: a row or column of a face glows once every clue in it is back home.
// It needs two or more clues, so one digit landing by chance doesn't light anything up.
const faceLines=groups.slice(0,6).flatMap(g=>[0,1,2].flatMap(k=>[[g[3*k],g[3*k+1],g[3*k+2]],[g[k],g[k+3],g[k+6]]]));
function settledCells(){const out=new Set();
  for(const l of faceLines){const cl=l.filter(i=>locked[i]);if(cl.length>=2&&cl.every(i=>P.given[i]===vals[i]))l.forEach(i=>out.add(i))}
  return out}
function updateStatus(){
  if(!P)return;const T=TIERS[P.tier];
  const nClues=P.given.filter(Boolean).length,home=locked.reduce((n,l,i)=>n+(l&&P.given[i]===vals[i]?1:0),0);
  const t=stage===3?t1+t2:nowSec();
  $('timer').textContent=fmt(t);$('timer').hidden=isPrac();$('reveal').disabled=stage===3;
  $('status').textContent=gaveUp?'Answer shown · not scored':stage===3?`Total time ${fmt(t1+t2)}`:'';
  $('status').classList.toggle('win',stage===3);
  showMisses();
}
// wrong locks: an outlined padlock and a count. Each wrong lock costs 25 points: a "-25pts" shudders up
// from the square, and a beat later the padlock shudders and the count goes up.
// tips: no helper text in a scored run (it's all under ?). Practice shows one tip at a time, rotating.
const TIPS={1:['Tap a square, then use the arrows on its edges to turn its row or column.','A clue back home gets a short yellow bar.','A row or column of a face glows once every clue in it is home.','Fewest turns scores best, so look before you turn.'],
  2:['Digits go in as pencil marks. Switch to the check to lock one in.','A wrong lock shakes, doesn\'t stay, and costs 25 points.','Every face holds 1 to 9 once, and so does each line of nine around the cube.','Tap a square to light up its two lines. Tap again where two lines overlap to switch.','Blue squares sit in both lines of a ring, so each line\'s other three squares hold the same digits as the dashed three across the cube.','Start where only one digit fits.','6 and 9 carry a yellow bar along their foot, so you can tell which way up they are.']};
let tipN=0,tipStage=0;
function showTip(){const h=$('hint'),list=isPrac()&&stage<3?TIPS[stage]:null;h.hidden=!list;if(!list)return;
  if(tipStage!==stage){tipStage=stage;tipN=0}h.textContent=`Tip · ${list[tipN%list.length]}`}
setInterval(()=>{if(!isPrac()||stage===3||$('hint').hidden)return;tipN++;const h=$('hint');h.classList.remove('tipin');void h.offsetWidth;h.classList.add('tipin');showTip()},7000);
function showMisses(bump=false){const m=$('misses');m.hidden=stage===1||gaveUp;
  m.classList.toggle('used',wrong>0);
  m.setAttribute('aria-label',`${wrong} wrong lock${wrong===1?'':'s'}`);
  const n=$('missN'),x=m.querySelector('svg');
  if(!bump){n.textContent=String(wrong).padStart(2,'0');return}
  setTimeout(()=>{n.textContent=String(wrong).padStart(2,'0');for(const e of [x,n]){e.classList.remove('bump');void e.getBoundingClientRect();e.classList.add('bump')}},220)}
function penaltyAt(el){if(!el)return;const r=el.getBoundingClientRect(),f=document.createElement('div');
  f.className='penalty';f.setAttribute('aria-hidden','true');f.innerHTML='−25<sub>pts</sub>';
  // beside the square's top corner, not over it: to its right, or to its left near the screen's right edge
  const flip=r.right+96>innerWidth;f.classList.toggle('flip',flip);
  f.style.left=`${flip?r.left-2:r.right+2}px`;f.style.top=`${r.top+4}px`;document.body.appendChild(f);setTimeout(()=>f.remove(),1300)}
setInterval(()=>{if(stage<3&&!gaveUp)updateStatus()},500);

cubeEl.addEventListener('click',e=>{const s=e.target.closest('.st');if(!s||moved||!P||stage===3)return;
  const c=+s.dataset.c;lc=c===sel?lc+1:0;sel=c;selFace=+s.dataset.f;hintArrow=null;render()});
function pressDigit(d){ensureRunning();
  if(stage!==2||sel<0||locked[sel]||vals[sel])return;
  if(d===0){pm[sel]=0;render();return}
  if(!penMode){pm[sel]=pm[sel]===(1<<d)?0:1<<d;music.sfx('pencil');render();return}
  const g=vals.slice();g[sel]=d;
  const ok=solveCount(g,1,80000)[0]!==0;
  if(!ok){wrong++;music.sfx('wrong');const el=stickers[sel];penaltyAt(el.find(x=>x.getBoundingClientRect().width)||el[0]);showMisses(true);el.forEach(x=>{x.classList.remove('shake','wrong');void x.offsetWidth;x.classList.add('shake','wrong')});
    setTimeout(()=>el.forEach(x=>x.classList.remove('wrong')),500);updateStatus();return}
  if(stars.has(sel)&&!regularLocked)starWon.add(sel);else if(!stars.has(sel))regularLocked=true;
  vals[sel]=d;pm[sel]=0;music.sfx('lock');render();
}
const pad=$('pad');
for(let d=1;d<=9;d++){const b=document.createElement('button');b.textContent=d;b.dataset.d=d;b.setAttribute('aria-label','Digit '+d);b.onclick=()=>pressDigit(d);pad.appendChild(b)}
const er=document.createElement('button');er.textContent='⌫';er.setAttribute('aria-label','Clear pencil marks');er.onclick=()=>pressDigit(0);pad.appendChild(er);
$('mPencil').onclick=()=>{penMode=false;render()};$('mPen').onclick=()=>{penMode=true;render()};

// ---------- turns ----------
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
function moveFor(fi,c,kind,dirSign){const f=F[fi],n=f.map(1,1),rowDir=sub(f.map(2,1),n),colDir=sub(f.map(1,2),n);
  const move=kind==='row'?rowDir:colDir,axisVec=kind==='row'?colDir:rowDir;const a=axisOf(axisVec),v=cells[c].c[a];
  const want=move.map(x=>x*dirSign);return[a,v,k3(rotV(n,a,1))===k3(want)?1:-1]}
function doTurn(m){ensureRunning();vals=turnArr(vals,...m);locked=turnArr(locked,...m);pm=turnArr(pm,...m);turns++;playerMoves.push(m);music.sfx('turn');
  cells.forEach((x,i)=>{if(x.c[m[0]]===m[1])stickers[i].forEach(el=>{el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash')})})}
function slide(kind,dirSign){
  if(sel<0||stage!==1)return;
  const m=moveFor(selFace,sel,kind,dirSign);
  doTurn(m);sel=rotCell(sel,m[0],m[2]);selFace=faceOfNormal.get(k3(cells[sel].n));hintArrow=null;render();
  if(isPrac())showHint(true);
}
// suggested turn: shortest path home from player moves + scramble, with adjacent cancellations
const inv=m=>[m[0],m[1],-m[2]];const isInv=(x,y)=>x[0]===y[0]&&x[1]===y[1]&&x[2]===-y[2];
function nextHomeMove(){const seq=[...playerMoves.slice().reverse().map(inv),...P.moves.slice().reverse().map(inv)];
  const st=[];for(const m of seq){if(st.length&&isInv(st[st.length-1],m))st.pop();else st.push(m)}return st[0]}
// a face's outward normal in screen space (x right, y down, z toward viewer)
function viewNormal(fi){const n=F[fi].map(1,1);const r=x=>x*Math.PI/180;
  let [x,y,z]=n;const cy=Math.cos(r(ry)),sy=Math.sin(r(ry));[x,z]=[x*cy+z*sy,-x*sy+z*cy];
  const cx=Math.cos(r(rx)),sx=Math.sin(r(rx));[y,z]=[y*cx-z*sx,y*sx+z*cx];return[x,y,z]}
const facing=fi=>viewNormal(fi)[2];
// shows the next turn home as a pulsing arrow; free in Practice, otherwise it uses one of the three
function showHint(free){
  if(stage!==1||(!free&&hintsLeft<=0))return;const m=nextHomeMove();if(!m)return;
  const faces=[0,1,2,3,4,5].sort((a,b)=>facing(b)-facing(a));
  for(const fi of faces)for(const st of document.querySelectorAll(`#cube .face:nth-child(${fi+1}) .st`)){const c=+st.dataset.c;
    for(const [kind,dir,ai] of [['row',-1,0],['row',1,1],['col',-1,2],['col',1,3]]){const mm=moveFor(fi,c,kind,dir);
      if(mm[0]===m[0]&&mm[1]===m[1]&&mm[2]===m[2]){if(!free){hintsLeft--;hintsUsed++;journey.interaction('hint')}sel=c;selFace=fi;hintArrow=[fi,ai];render();return}}}
}
$('suggest').onclick=()=>showHint(false);

$('restart').onclick=askRetry;
$('newp').onclick=()=>{journey.start();newGame()};
// giving up asks first, and offers today's retry instead when there is one
$('reveal').onclick=askGiveUp;
document.addEventListener('click',e=>{if(moved||sel<0)return;if(!e.target.isConnected||e.target.closest('.st,button,.seg'))return;sel=-1;hintArrow=null;render()});
document.addEventListener('keydown',e=>{if(sel<0||tx.busy)return;if(/^[1-9]$/.test(e.key))pressDigit(+e.key);else if(e.key==='Backspace'||e.key==='0')pressDigit(0)});

// ---------- turn arrows drawn on the selected face, in 3D ----------
const ARW=[['row',-1,'◀','Turn this row left'],['row',1,'▶','Turn this row right'],['col',-1,'▲','Turn this column up'],['col',1,'▼','Turn this column down']];
const arrowEls=[];
document.querySelectorAll('#cube .face').forEach((el,fi)=>{
  arrowEls[fi]=ARW.map(([kind,dir,g,label])=>{const a=document.createElement('button');a.className='arw';a.textContent=g;a.setAttribute('aria-label',label);a.hidden=true;
    a.addEventListener('pointerdown',e=>e.stopPropagation());
    a.addEventListener('click',e=>{e.stopPropagation();slide(kind,dir)});el.appendChild(a);return a});
});
function placeArrows(){
  arrowEls.flat().forEach(a=>{a.hidden=true;a.classList.remove('pulse')});
  if(stage!==1||sel<0)return;
  const st=stickers[sel].find(x=>+x.dataset.f===selFace);if(!st)return;
  const i=+st.dataset.i,j=+st.dataset.j,[L,R,U,D]=arrowEls[selFace];
  const put=(a,x,y)=>{a.style.left=x+'px';a.style.top=y+'px';a.hidden=false};
  put(L,i*60-15,j*60+15);put(R,i*60+45,j*60+15);put(U,i*60+15,j*60-15);put(D,i*60+15,j*60+45);
  if(hintArrow&&hintArrow[0]===selFace)arrowEls[selFace][hintArrow[1]].classList.add('pulse');
}

// Practice is always open; a turns button opens today's cube at that tier (and locks it for the day)
document.querySelectorAll('#tierSeg button').forEach(b=>b.onclick=()=>{const t=+b.dataset.t;if(twistDay!==null&&t!==twistDay&&t!==4)return;
  document.querySelectorAll('#tierSeg button').forEach(x=>x.setAttribute('aria-pressed',x===b));
  if(t===PRACTICE){tier=PRACTICE;journey.start();newGame();return}
  if(daily&&P&&P.tier===t){if(paused)resume();return}
  journey.start();void playDaily(t)});

// ---------- view rotation ----------
let rx=-28,ry=-38,moved=false;
// light, not colour, separates faces: the face pointing most up is sheet, then right and left shades
function shadeFaces(){faceEls.forEach((el,fi)=>{const [x,y]=viewNormal(fi);el.style.setProperty('--shade',y<-.5?'var(--cell-top)':x>=0?'var(--cell-right)':'var(--cell-left)')})}
const apply=()=>{cubeEl.style.transform=`scale(${scaleK}) rotateX(${rx}deg) rotateY(${ry}deg)`;shadeFaces()};
const stageEl=$('stage');let drag=null;
stageEl.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,rx,ry};moved=false;cubeEl.classList.add('dragging')});
window.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(Math.abs(dx)+Math.abs(dy)>6)moved=true;ry=drag.ry+dx*.5;rx=Math.max(-89,Math.min(89,drag.rx-dy*.5));apply()});
window.addEventListener('pointerup',()=>{drag=null;cubeEl.classList.remove('dragging');setTimeout(()=>moved=false,0)});
const tx=makeTransitions({cubeEl,faceEls,stageEl,view:()=>({rx,ry,scaleK}),apply});
$('vl').onclick=()=>{ry-=90;apply()};
$('vr').onclick=()=>{ry+=90;apply()};
$('vu').onclick=()=>{rx=Math.min(62,rx+45);apply()};
$('vd').onclick=()=>{rx=Math.max(-62,rx-45);apply()};

// a cube to show behind the splash while today's loads; Play swaps in today's
window.addEventListener('resize',setH);setH();apply();applyTwistLock();newGame();void loadDaily();
// ---------- test tools (prototype only) ----------
const tkMsg=m=>{$('tkMsg').textContent=m};
// keep the cube from turning when the panel is used, and remember whether it was open
const tk=$('testkit');['pointerdown','click'].forEach(ev=>tk.addEventListener(ev,e=>e.stopPropagation()));
try{if(localStorage.getItem('nonet-tk')==='1')tk.open=true}catch(e){}
tk.addEventListener('toggle',()=>{try{localStorage.setItem('nonet-tk',tk.open?'1':'0')}catch(e){}});
const answer=()=>{const r=solveCount(vals.map((v,i)=>v),1,200000);return r[0]>0?r[1]:null};
function lockFill(list){if(stage!==2){tkMsg('Fills work in Stage 2. Use Align now first.');return}
  const sol=answer();if(!sol){tkMsg('The cube has a wrong digit in it, so there is no answer to fill from.');return}
  let n=0;for(const c of list){if(vals[c])continue;if(stars.has(c)&&!regularLocked)starWon.add(c);else if(!stars.has(c))regularLocked=true;vals[c]=sol[c];pm[c]=0;n++}
  tkMsg(n?`Filled ${n} square${n===1?'':'s'}.`:'Nothing left to fill there.');render()}
const needSel=()=>{if(sel<0){tkMsg('Tap a square first.');return false}return true};
const shownLine=()=>{const by={};for(const k of lineIdxOf[sel])(by[Math.floor(k/6)]??=[]).push(k);const ax=Object.keys(by).sort()[0];const arr=by[ax];return lines[arr[lc%arr.length]]};
$('tkAlign').onclick=()=>{if(stage!==1){tkMsg('Already aligned.');return}let m,g=0;while(stage===1&&(m=nextHomeMove())&&g++<40){doTurn(m);render()}tkMsg(`Aligned in ${turns} turn${turns===1?'':'s'}.`)};
$('tkCell').onclick=()=>{if(needSel())lockFill([sel])};
$('tkLine').onclick=()=>{if(needSel())lockFill(shownLine())};
$('tkFace').onclick=()=>{if(needSel())lockFill(groups[faceOfNormal.get(k3(cells[sel].n))])};
$('tkStars').onclick=()=>{if(!stars.size){tkMsg('No opening squares on this cube.');return}lockFill([...stars])};
$('tkWrong').onclick=()=>{if(!needSel())return;if(stage!==2||vals[sel]){tkMsg('Pick an empty square in Stage 2.');return}const sol=answer();if(!sol)return;
  const d=sol[sel]%9+1;const was=penMode;penMode=true;pressDigit(d);penMode=was;render();tkMsg(`Tried ${d}. That cost 25 points.`)};
$('tkPencil').onclick=()=>{if(!needSel()||stage!==2)return;const sol=answer();if(!sol)return;let n=0;for(const c of shownLine())if(!vals[c]){pm[c]=1<<sol[c];n++}render();tkMsg(`Pencilled ${n} square${n===1?'':'s'} with the right digits.`)};
$('tkAllBut').onclick=()=>{if(stage!==2){tkMsg('Fills work in Stage 2. Use Align now first.');return}const empty=vals.map((v,i)=>v?-1:i).filter(i=>i>=0);
  const keep=sel>=0&&!vals[sel]?sel:empty[empty.length-1];lockFill(empty.filter(i=>i!==keep));if(keep>=0){sel=keep;selFace=faceOfNormal.get(k3(cells[keep].n));render()}};

$('tkDay').onclick=()=>{if(online){tkMsg('Today is set on the server. A moderator can reset it from Redis; otherwise it resets at midnight Pacific time.');return}
  twistDay=null;try{localStorage.removeItem('nonet-twist')}catch(e){}applyTwistLock();tkMsg('Day reset: pick again.')};
// a run that used the test tools is never sent
tk.addEventListener('click',e=>{if(e.target.closest('.tk button'))tkUsed=true},true);
window.__test={get sel(){return sel},get P(){return P},get vals(){return vals},get stage(){return stage},get turns(){return turns},slide,select:(c,f)=>{sel=c;selFace=f;render()},
  nextHomeMove,doTurn:m=>{doTurn(m);render()},pressDigit,setPen:v=>{penMode=v;render()},score,cells,solveCount,N};
