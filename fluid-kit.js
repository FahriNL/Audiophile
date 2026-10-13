/*! Fluid Kit v2 — hanya gerak. Tanpa skin, tanpa emoji. Namespace: window.FK, .fk-*, --fk-*
   Semua modul opsional dan berdiri sendiri; tidak menyentuh gaya UI milikmu. */
(()=>{
const root=document.documentElement,R=matchMedia('(prefers-reduced-motion:reduce)').matches?.02:1;
const LIN=CSS.supports('animation-timing-function','linear(0,1)');

/* 1. SPRING: pegas teredam sungguhan, bukan cubic-bezier. Hasilnya dipakai JS (at) dan CSS (linear()) */
function spring({stiffness:k=170,damping:c=24,mass:m=1}={}){
  const w=Math.sqrt(k/m),z=c/(2*Math.sqrt(k*m)),wd=w*Math.sqrt(Math.abs(1-z*z));
  const x=t=>z<1?1-Math.exp(-z*w*t)*(Math.cos(wd*t)+z*w/wd*Math.sin(wd*t)):1-Math.exp(-w*t)*(1+w*t);
  const D=Math.min(2.2,Math.max(.2,6.9/(Math.min(z,1)*w)));
  const at=u=>u<=0?0:u>=1?1:x(u*D);
  const css=LIN?'linear('+Array.from({length:49},(_,i)=>+at(i/48).toFixed(4)).join(',')+')':'cubic-bezier(.2,.85,.15,1)';
  return{at,css,ms:D*1000*R,zeta:z}
}
const S={snappy:spring({stiffness:320,damping:32}),smooth:spring({stiffness:170,damping:24}),bouncy:spring({stiffness:230,damping:15})};
const pub=()=>{for(const n in S){root.style.setProperty('--fk-'+n,S[n].css);root.style.setProperty('--fk-'+n+'-t',S[n].ms+'ms')}};
const tune=(n,o)=>{Object.assign(S[n],spring(o));pub()};
pub();

/* CSS struktural (tanpa warna/ukuran visual). Override lewat variabel --fk-* */
const st=document.createElement('style');st.textContent=`
@property --fk-hue{syntax:'<number>';inherits:true;initial-value:250}
html.fk-hue{transition:--fk-hue 1.2s var(--fk-smooth)}
:where(.fk-seg,.fk-slider){position:relative}
.fk-seg{touch-action:pan-y;user-select:none}
.fk-seg>button{position:relative;z-index:1}
.fk-pill{position:absolute;top:var(--fk-pt,6px);bottom:var(--fk-pt,6px);left:0;width:0;z-index:0;pointer-events:none;border-radius:var(--fk-pr,999px);background:var(--fk-pill,rgba(255,255,255,.2))}
.fk-view{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity var(--fk-smooth-t) var(--fk-smooth),transform var(--fk-smooth-t) var(--fk-smooth)}
.fk-bf{transform:translateX(-44px) scale(.97)}.fk-af{transform:translateX(44px) scale(.97)}
.fk-on{opacity:1;transform:none;pointer-events:auto}
.fk-sheet{position:fixed;display:none;z-index:50;overflow:hidden}
.fk-content{position:absolute;left:0;top:0;width:var(--fk-w);height:var(--fk-h);overflow-y:auto}
.fk-ghost{position:absolute!important;left:0;top:0;margin:0!important;pointer-events:none;transform:none!important;background:none!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.fk-handle{display:block;touch-action:none;cursor:grab}
.fk-press{transition:transform var(--fk-bouncy-t) var(--fk-bouncy)}.fk-press:active{transform:scale(.94)}
.fk-toggle{position:relative;--fk-tw:56px;--fk-th:34px;--fk-tp:3px;--fk-tk:calc(var(--fk-th) - 2*var(--fk-tp));width:var(--fk-tw);height:var(--fk-th);border-radius:999px;border:0;flex:none}
.fk-toggle i{position:absolute;top:var(--fk-tp);left:var(--fk-tp);width:var(--fk-tk);height:var(--fk-tk);border-radius:999px;background:var(--fk-knob,#fff);transition:left var(--fk-bouncy-t) var(--fk-bouncy),width var(--fk-snappy-t) var(--fk-snappy)}
.fk-toggle[aria-pressed=true] i{left:calc(var(--fk-tw) - var(--fk-tp) - var(--fk-tk))}
.fk-toggle:active i{width:calc(var(--fk-tk)*1.3)}
.fk-toggle[aria-pressed=true]:active i{left:calc(var(--fk-tw) - var(--fk-tp) - var(--fk-tk)*1.3)}
.fk-slider{touch-action:none;user-select:none}
.fk-fill{position:absolute;left:0;width:var(--fk-p,50%)}
.fk-knob{position:absolute;left:var(--fk-p,50%);translate:-50% 0;transition:transform var(--fk-bouncy-t) var(--fk-bouncy)}
.fk-slider.fk-drag .fk-knob{transform:scale(1.2)}
.fk-light::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .45s;background:radial-gradient(200px circle at var(--fk-x,50%) var(--fk-y,0),rgba(255,255,255,.28),transparent 70%)}
.fk-lit::after{opacity:1}`;
document.head.appendChild(st);

/* 2. LIQUID: pill dengan tepi depan memimpin dan tepi belakang menyusul. Bisa digeser jari, melempar dengan momentum, dan bisa diinterupsi */
function liquid(box,{index=0,drag=true,spring:sp=S.smooth,onChange}={}){
  const pill=box.querySelector('.fk-pill'),bs=[...box.querySelectorAll('button')];
  let cur=index,anim,g=null,moved=false;
  const rect=i=>({l:bs[i].offsetLeft,w:bs[i].offsetWidth});
  const put=r=>{pill.style.left=r.l+'px';pill.style.width=r.w+'px'};
  const mark=i=>bs.forEach((b,k)=>{b.classList.toggle('on',k==i);b.setAttribute('aria-pressed',k==i)});
  function to(i,quiet){
    const a={l:pill.offsetLeft,w:pill.offsetWidth},b=rect(i);anim&&anim.cancel();mark(i);put(b);
    if(!quiet&&(a.l!=b.l||a.w!=b.w)){
      const fwd=b.l>=a.l,lag=.18,kf=[];
      for(let n=0;n<=28;n++){const t=n/28,p=sp.at(t),q=sp.at((t-lag)/(1-lag));
        const L=a.l+(b.l-a.l)*(fwd?q:p),Rg=a.l+a.w+(b.l+b.w-a.l-a.w)*(fwd?p:q);
        kf.push({left:L+'px',width:Math.max(6,Rg-L)+'px'})}
      anim=pill.animate(kf,{duration:sp.ms,easing:'linear'})}
    if(i!==cur){cur=i;onChange&&onChange(i)}}
  bs.forEach((b,i)=>b.addEventListener('click',()=>{if(!moved)to(i)}));
  if(drag){
    box.addEventListener('pointerdown',e=>{moved=false;g={x:e.clientX,l:pill.offsetLeft,px:e.clientX,t:e.timeStamp,v:0,on:false,id:e.pointerId}});
    box.addEventListener('pointermove',e=>{if(!g)return;const dx=e.clientX-g.x;
      if(!g.on){if(Math.abs(dx)<8)return;g.on=moved=true;anim&&anim.cancel();box.setPointerCapture(g.id)}
      g.v=(e.clientX-g.px)/Math.max(1,e.timeStamp-g.t);g.px=e.clientX;g.t=e.timeStamp;
      pill.style.left=Math.min(bs[bs.length-1].offsetLeft,Math.max(bs[0].offsetLeft,g.l+dx))+'px'});
    const up=()=>{if(!g)return;const s=g;g=null;if(!s.on)return;
      const c=pill.offsetLeft+pill.offsetWidth/2+s.v*160;let best=0,d=1e9;
      bs.forEach((b,k)=>{const dd=Math.abs(b.offsetLeft+b.offsetWidth/2-c);if(dd<d){d=dd;best=k}});
      to(best);setTimeout(()=>moved=false,0)};
    box.addEventListener('pointerup',up);box.addEventListener('pointercancel',up)}
  const sync=()=>{put(rect(cur))};
  mark(cur);sync();addEventListener('resize',sync);
  return{to,sync}
}

/* 3. MORPH: elemen sumber mengembang jadi sheet (dan kembali). Tarik handle ke bawah untuk menutup, dengan kecepatan jari */
function morph({sheet,spring:sp=S.smooth,closeSpring:cs=S.snappy,inset=8,radius=40,ghost=true,onOpen,onClose}={}){
  let cur=null,d=null;
  const px=o=>({top:o.top+'px',left:o.left+'px',width:o.width+'px',height:o.height+'px'});
  function open(src){
    if(cur)return;onOpen&&onOpen(src);
    const r=src.getBoundingClientRect(),br=getComputedStyle(src).borderRadius,W=innerWidth-2*inset,H=innerHeight-2*inset;
    const to={top:inset+'px',left:inset+'px',width:W+'px',height:H+'px',borderRadius:radius+'px'};
    cur={src,to,br};sheet.classList.add('fk-sheet');
    sheet.style.setProperty('--fk-w',W+'px');sheet.style.setProperty('--fk-h',H+'px');
    sheet.style.display='block';Object.assign(sheet.style,to);
    sheet.animate([{...px(r),borderRadius:br},to],{duration:sp.ms,easing:sp.css});
    if(ghost){const gh=src.cloneNode(true);gh.removeAttribute('id');gh.classList.add('fk-ghost');
      Object.assign(gh.style,{width:r.width+'px',height:r.height+'px',visibility:'visible'});
      sheet.prepend(gh);gh.animate([{opacity:1},{opacity:0}],{duration:240*R,fill:'forwards'});cur.gh=gh}
    src.style.visibility='hidden';root.dataset.fkSheet='open';
    sheet.querySelectorAll('[data-fk-reveal]').forEach((el,k)=>el.animate([{opacity:0,transform:'translateY(20px)'},{opacity:1,transform:'none'}],{duration:sp.ms,delay:(170+k*55)*R,easing:sp.css,fill:'backwards'}))}
  function close(){
    if(!cur||cur.closing)return;cur.closing=1;
    const{src,to,br,gh}=cur,r=src.getBoundingClientRect(),tf=getComputedStyle(sheet).transform;
    delete root.dataset.fkSheet;
    const c=sheet.querySelector('.fk-content');c&&c.animate([{opacity:1},{opacity:0}],{duration:200*R,fill:'forwards'});
    gh&&gh.animate([{opacity:0},{opacity:1}],{duration:240*R,delay:cs.ms*.35,fill:'forwards'});
    sheet.style.transform='';
    const a=sheet.animate([{...to,transform:tf},{...px(r),borderRadius:br,transform:'none'}],{duration:cs.ms,easing:cs.css,fill:'forwards'});
    a.onfinish=()=>{src.style.visibility='';sheet.style.display='none';sheet.getAnimations({subtree:true}).forEach(x=>x.cancel());gh&&gh.remove();cur=null;onClose&&onClose()}}
  sheet.addEventListener('pointerdown',e=>{if(!cur||cur.closing||!e.target.closest('[data-fk-handle]'))return;
    d={y:e.clientY,py:e.clientY,t:e.timeStamp,v:0,dy:0};sheet.setPointerCapture(e.pointerId)});
  sheet.addEventListener('pointermove',e=>{if(!d)return;d.dy=Math.max(0,e.clientY-d.y);
    d.v=(e.clientY-d.py)/Math.max(1,e.timeStamp-d.t);d.py=e.clientY;d.t=e.timeStamp;
    sheet.style.transform=`translateY(${d.dy*.7}px) scale(${1-Math.min(.12,d.dy/2000)})`});
  const up=()=>{if(!d)return;const s=d;d=null;
    if(s.dy>130||s.v>.6)close();
    else{const t=sheet.style.transform;sheet.style.transform='';sheet.animate([{transform:t},{transform:'none'}],{duration:sp.ms,easing:sp.css})}};
  sheet.addEventListener('pointerup',up);sheet.addEventListener('pointercancel',up);
  addEventListener('keydown',e=>e.key=='Escape'&&close());
  return{open,close}
}

/* 4. SLIDER: knob membesar saat ditekan dan menggepeng mengikuti kecepatan geser */
function slider(el,{min=0,max=100,step=1,value=min,onInput}={}){
  const knob=el.querySelector('.fk-knob');let tm,lx=0,lt=0;
  const set=v=>{v=Math.min(max,Math.max(min,Math.round(v/step)*step));el.style.setProperty('--fk-p',(v-min)/(max-min)*100+'%');return v};
  const at=e=>{const r=el.getBoundingClientRect();return set(min+(e.clientX-r.left)/r.width*(max-min))};
  set(value);
  el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);el.classList.add('fk-drag');lx=e.clientX;lt=e.timeStamp;onInput&&onInput(at(e))});
  el.addEventListener('pointermove',e=>{if(!el.classList.contains('fk-drag'))return;
    const v=Math.abs(e.clientX-lx)/Math.max(1,e.timeStamp-lt);lx=e.clientX;lt=e.timeStamp;
    knob.style.transform=`scale(${1.2+Math.min(.35,v*.35)},${1.2-Math.min(.15,v*.15)})`;
    clearTimeout(tm);tm=setTimeout(()=>knob.style.transform='',90);onInput&&onInput(at(e))});
  const up=()=>{el.classList.remove('fk-drag');knob.style.transform=''};
  el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  return{set}
}

/* 5. LAIN-LAIN */
const toggle=(el,cb)=>{el.setAttribute('aria-pressed',el.getAttribute('aria-pressed')==='true');
  el.addEventListener('click',()=>{const on=el.getAttribute('aria-pressed')!=='true';el.setAttribute('aria-pressed',on);cb&&cb(on)})};
const views=(list,i0=0)=>{const go=i=>list.forEach((v,k)=>{v.classList.remove('fk-bf','fk-on','fk-af');v.classList.add(k<i?'fk-bf':k>i?'fk-af':'fk-on')});go(i0);return{go}};
const hue=h=>{root.classList.add('fk-hue');root.style.setProperty('--fk-hue',h)};
function light(sel='.fk-light'){
  const f=e=>e.target.closest&&e.target.closest(sel);
  addEventListener('pointermove',e=>{const g=f(e);if(g){const r=g.getBoundingClientRect();g.style.setProperty('--fk-x',e.clientX-r.left+'px');g.style.setProperty('--fk-y',e.clientY-r.top+'px')}});
  addEventListener('pointerdown',e=>{const g=f(e);g&&g.classList.add('fk-lit')});
  const off=()=>document.querySelectorAll('.fk-lit').forEach(g=>g.classList.remove('fk-lit'));
  addEventListener('pointerup',off);addEventListener('pointercancel',off)}

window.FK={spring,springs:S,tune,liquid,morph,slider,toggle,views,hue,light};
})();
