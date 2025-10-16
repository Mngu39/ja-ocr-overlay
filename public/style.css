// JA OCR Overlay — app.js (pop toolbar + arrow move + local kanji DB + improved subpopup)
// - 절대 경로/도메인 의존 없음: 리포 내부 JSON을 그대로 fetch
// - 여러 문장상자 선택(토글) + 순번 배지 + 하이라이트
// - 메인 팝업: 우측 도킹 툴바(닫기/수정), 가장자리 얇은 방향 화살표로 상하좌우 재배치
// - 서브팝업: 메인팝업 하단에 항상 도킹, 1줄(형태소·후리가나 – (lemma) – 번역), 2줄(한자 박스들)
// - 한자 DB: /kanji_ko_attr_irreg.min.json, /일본어_한자_암기박사/deck.json

import {
  getImageById, gcvOCR,
  getFurigana, translateJaKo,
  openNaverJaLemma, openNaverHanja
} from "./api.js";
import { placeMainPopover } from "./place.js"; // (상/하 기준 배치 사용)

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");
const pop     = document.getElementById("pop");
const sub     = document.getElementById("sub");
const btnEdit = document.getElementById("btnEdit");
const rubyLine= document.getElementById("rubyLine");
const transLine=document.getElementById("transLine");
const editDlg = document.getElementById("editDlg");
const editInput=document.getElementById("editInput");

// ───────────── Local Kanji DB (리포 내 파일을 그대로 사용) ─────────────
const KANJI_DB_URL = "./kanji_ko_attr_irreg.min.json";
const ANKI_DECK_URL = "./일본어_한자_암기박사/deck.json";

let KANJI_MAP = null;       // 일반 DB: { '漢': {ko:'…', on:'…', kun:'…', …}, … }
let ANKI_MAP  = null;       // 안키 DB: { '漢': {gloss:'…', explain:'…'} }
async function loadKanjiDBs(){
  try{
    // 일반 DB
    const r1 = await fetch(KANJI_DB_URL, { cache:"no-store" });
    if (r1.ok){
      const j = await r1.json();
      // 다양한 스키마 대비: {char: {...}} 또는 [{char:'漢', ...}] 모두 지원
      KANJI_MAP = new Map();
      if (Array.isArray(j)){
        for (const it of j){
          const ch = it.char || it.kanji || it.k || it.c;
          if (ch && ch.length===1) KANJI_MAP.set(ch, it);
        }
      } else {
        for (const k of Object.keys(j)){ if(k.length===1) KANJI_MAP.set(k, j[k]); }
      }
    }
  }catch{}

  try{
    // 안키 DB(덱 json): 구조가 제각각일 수 있어 느슨한 인덱싱
    const r2 = await fetch(ANKI_DECK_URL, { cache:"no-store" });
    if (r2.ok){
      const j = await r2.json();
      ANKI_MAP = new Map();
      const pool = [];
      // 형태 1) {notes:[{fields:{…}}]}
      if (Array.isArray(j?.notes)){
        for (const n of j.notes){
          const f = n.fields || n.data || n;
          pool.push(f);
        }
      }
      // 형태 2) {cards:[{…}], items:[…]} 등 기타 루트에 배열 하나만 있는 경우
      for (const k of Object.keys(j)){
        if (Array.isArray(j[k]) && !k.startsWith("_")){
          for (const v of j[k]){
            if (v && typeof v === "object" && (v.fields || v.data)) pool.push(v.fields || v.data);
          }
        }
      }
      // 느슨한 추출: 한 글자 표제어 + 한국어 의미/설명 후보
      const pick = (obj, keys) => keys.map(k=>obj[k]).find(Boolean);
      for (const f of pool){
        const entries = Object.entries(f).map(([k,v])=>[String(k), String(v??"")]);
        const allText = entries.map(([,v])=>v).join(" ");
        // 한 글자 한자 후보
        const kanji = (allText.match(/[\u4E00-\u9FFF]/g)||[]).filter(ch=>ch.length===1);
        if (!kanji.length) continue;
        // 설명/뜻 후보 필드
        const gloss = pick(f, ["뜻","의미","훈음","음훈","keyword","ko","mean","meaning"]) || "";
        const explain = pick(f, ["설명","설명문","설명1","explain","memo","description"]) || "";
        for (const ch of kanji){
          if (!ANKI_MAP.has(ch)){
            ANKI_MAP.set(ch, { gloss: gloss || "", explain: explain || "" });
          }
        }
      }
    }
  }catch{}
}
const hasKanji = s => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30fa]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
const esc = s => (s||"").replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

// ───────────── 전역 상태 ─────────────
let annos = [];                          // OCR 결과
let selected = [];                       // 선택된 상자 DOM (순서 중요)
let currentAnchor = null;               // 앵커 상자
let currentSentence = "";               // 결합 텍스트
let currentTokenEl = null;              // 서브 토큰 엘리먼트
let placeMode = "auto";                 // 팝업 배치 모드: "top"|"bottom"|"left"|"right"|"auto"

// ───────────── 부트스트랩 ─────────────
(async function bootstrap(){
  await loadKanjiDBs();

  try{
    const qs = new URLSearchParams(location.search);
    const id = qs.get("id");
    if (!id) throw new Error("?id= 필요");

    imgEl.onload = async ()=>{
      try{
        hint.textContent = "OCR(Google) 중…";
        annos = await gcvOCR(id);
        if (!annos.length){ hint.textContent="문장을 찾지 못했습니다."; return; }
        hint.textContent = "문장상자를 탭하세요";
        renderOverlay();
      }catch(e){ console.error(e); hint.textContent="OCR 오류"; }
    };
    imgEl.src = await getImageById(id);
  }catch(e){ hint.textContent = e.message; }
})();

// ───────────── 오버레이 렌더링 ─────────────
function renderOverlay(){
  const rect = imgEl.getBoundingClientRect();
  overlay.style.width = rect.width+"px";
  overlay.style.height= rect.height+"px";

  const sx=rect.width/imgEl.naturalWidth, sy=rect.height/imgEl.naturalHeight;
  overlay.innerHTML="";

  annos.forEach((a, idx)=>{
    const [p0,p1,p2,p3]=a.polygon;
    const l=Math.min(p0[0],p3[0])*sx, t=Math.min(p0[1],p1[1])*sy;
    const r=Math.max(p1[0],p2[0])*sx, b=Math.max(p2[1],p3[1])*sy;
    const box=document.createElement("div");
    box.className="box";
    Object.assign(box.style,{left:l+"px",top:t+"px",width:(r-l)+"px",height:(b-t)+"px"});
    box.dataset.text=a.text||"";
    box.addEventListener("click",(ev)=>{ ev.stopPropagation(); onToggleBox(box); });
    overlay.appendChild(box);
    // 선택 상태 유지 시 시각화
    const pos = selected.indexOf(box);
    if (pos>=0) decorateSelected(box, pos);
  });
}

// 선택 토글 + 순번/하이라이트 + 팝업 갱신
function onToggleBox(box){
  const i = selected.indexOf(box);
  if (i>=0){
    selected.splice(i,1);
    undecorate(box);
  }else{
    selected.push(box);
    decorateSelected(box, selected.length-1);
  }
  if (selected.length===0){
    closeAll();
    return;
  }
  currentAnchor = selected[0];
  currentSentence = selected.map(b=>b.dataset.text||"").join("");
  openMainPopover(currentAnchor, currentSentence);
}
function decorateSelected(box, order){
  box.classList.add("selected");
  box.dataset.order = (order+1);
}
function undecorate(box){
  box.classList.remove("selected");
  delete box.dataset.order;
  // 재번호
  selected.forEach((b,idx)=> b.dataset.order=(idx+1));
}

// 외부 클릭: 서브팝업만 닫기 (메인팝업은 버튼으로 닫음)
stage.addEventListener("click",(e)=>{
  if (!sub.hidden && !sub.contains(e.target)) sub.hidden = true;
});

// 리사이즈 대응
function relayout(){
  renderOverlay();
  if (currentAnchor && !pop.hidden) repositionMain();
  if (!sub.hidden) dockSub();
}
window.addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
window.addEventListener("scroll", relayout, {passive:true});

// ───────────── 메인 팝업 ─────────────
function openMainPopover(anchor, text){
  // 내용 초기화
  pop.hidden=false;
  rubyLine.innerHTML="";
  transLine.textContent="…";

  // 폭: 앵커 폭 기준으로 살짝 넓게, 화면의 92% 제한
  const aw=anchor.getBoundingClientRect().width;
  const overlayW=overlay.clientWidth;
  pop.style.width=Math.min(Math.max(Math.round(aw*1.1), 440), Math.round(overlayW*0.92))+"px";

  // 툴바/화살표 한번만 생성
  ensureToolbar();
  ensureArrows();

  // 배치
  repositionMain();

  // 문장 토큰을 "루비 포함 클릭 가능" 형태로 단 한 줄에 렌더
  // 먼저 형태소 분석/후리가나 + 번역 병렬로
  (async()=>{
    try{
      const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);
      const tokens = rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [];

      rubyLine.innerHTML = tokens.map((t,i)=>{
        const surf = t.surface ?? t.text ?? "";
        const read = kataToHira(t.reading ?? t.read ?? "");
        const lemma= t.lemma ?? t.base ?? t.dict ?? t.normalized ?? "";
        // 각 토큰을 클릭 가능으로 감싸기
        const clickable = hasKanji(surf) || lemma || true;
        const spanOpen = `<span class="tok" data-i="${i}" data-s="${esc(surf)}" data-r="${esc(read)}" data-l="${esc(lemma)}">`;
        const spanClose= `</span>`;
        const ruby = read
          ? `<ruby>${esc(surf)}<rt>${esc(read)}</rt></ruby>`
          : esc(surf);
        return clickable ? `${spanOpen}${ruby}${spanClose}` : ruby;
      }).join("");

      // 토큰 클릭 핸들러
      rubyLine.querySelectorAll(".tok").forEach(el=>{
        el.addEventListener("click",(ev)=>{
          ev.stopPropagation();
          const s = el.dataset.s||"", r = el.dataset.r||"", l = el.dataset.l||"";
          openSubForToken(el, s, r, l);
        });
      });

      const translated = tr?.text || tr?.result || tr?.translation || "";
      transLine.textContent = translated || "(번역 없음)";
      repositionMain();
      // 도킹 서브팝업은 토큰 선택 시에만 열린다.
    }catch(e){
      transLine.textContent="(번역 실패)";
      console.error(e);
    }
  })();
}

function repositionMain(){
  // place.js 의 상/하 우선 배치 + 모드 힌트
  if (placeMode==="top" || placeMode==="bottom") {
    placeMainPopover(currentAnchor, pop, 8); // 상/하 자동
  } else {
    // 좌/우 모드는 간단히 수동 배치
    const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
    const ar = currentAnchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let x = (placeMode==="left") ? (ar.left - pr.width - 8) : (ar.right + 8);
    let y = ar.top + (ar.height - pr.height)/2;
    x = Math.max(vb.offsetLeft+8, Math.min(x, vb.offsetLeft+vb.width - pr.width - 8));
    y = Math.max(vb.offsetTop+8, Math.min(y, vb.offsetTop+vb.height - pr.height - 8));
    Object.assign(pop.style, { left:`${x + scrollX}px`, top:`${y + scrollY}px` });
  }
  // 툴바/화살표/서브 도킹 위치 갱신
  positionToolbar();
  positionArrows();
  if (!sub.hidden) dockSub();
}

// 툴바(우측 도킹) 생성/위치
let toolbar=null;
function ensureToolbar(){
  if (toolbar) return;
  toolbar = document.createElement("div");
  toolbar.className = "pop-toolbar";
  toolbar.innerHTML = `
    <button class="icon btn-close" title="닫기">✕</button>
    <button id="btnEditGhost" class="icon" title="수정">✎</button>
  `;
  stage.appendChild(toolbar);
  toolbar.querySelector(".btn-close").onclick = closeAll;
  // 기존 버튼과 동일 동작
  document.getElementById("btnEdit").onclick = openEdit;
  toolbar.querySelector("#btnEditGhost").onclick = openEdit;
}
function positionToolbar(){
  if (!toolbar || pop.hidden) return;
  const pr = pop.getBoundingClientRect();
  Object.assign(toolbar.style, {
    left: `${pr.right + 8 + scrollX}px`,
    top:  `${pr.top   + scrollY}px`,
  });
}
function openEdit(e){
  e?.stopPropagation();
  editInput.value = currentSentence || "";
  editDlg.showModal();
}
document.getElementById("editOk").addEventListener("click", ()=>{
  const t=editInput.value.trim();
  if (t){ currentSentence=t; openMainPopover(currentAnchor, currentSentence); }
  editDlg.close();
});

// 방향 화살표(얇은 버튼) 생성/위치/동작
let arrowTop=null, arrowBottom=null, arrowLeft=null, arrowRight=null;
function ensureArrows(){
  if (arrowTop) return;
  arrowTop    = mkArrow("top","▲");
  arrowBottom = mkArrow("bottom","▼");
  arrowLeft   = mkArrow("left","◀");
  arrowRight  = mkArrow("right","▶");
  [arrowTop,arrowBottom,arrowLeft,arrowRight].forEach(a=>stage.appendChild(a));
}
function mkArrow(pos, label){
  const el = document.createElement("button");
  el.className = `pop-nudge ${pos}`;
  el.textContent = label;
  el.onclick = (e)=>{ e.stopPropagation(); placeMode = pos==="top"||pos==="bottom" ? pos : pos; repositionMain(); };
  return el;
}
function positionArrows(){
  const pr = pop.getBoundingClientRect();
  const base = { x: pr.left + scrollX, y: pr.top + scrollY, w: pr.width, h: pr.height };
  if (arrowTop)    Object.assign(arrowTop.style,    { left:`${base.x + base.w/2 - 10}px`, top:`${base.y - 22}px` });
  if (arrowBottom) Object.assign(arrowBottom.style, { left:`${base.x + base.w/2 - 10}px`, top:`${base.y + base.h + 6}px` });
  if (arrowLeft)   Object.assign(arrowLeft.style,   { left:`${base.x - 22}px`,             top:`${base.y + base.h/2 - 10}px` });
  if (arrowRight)  Object.assign(arrowRight.style,  { left:`${base.x + base.w + 6}px`,     top:`${base.y + base.h/2 - 10}px` });
}

// 닫기
function closeAll(){
  pop.hidden=true;
  sub.hidden=true;
  selected.forEach(undecorate);
  selected = [];
}

// ───────────── 서브팝업 (도킹형) ─────────────
function openSubForToken(tokEl, surf, read, lemma){
  currentTokenEl = tokEl;
  const hasLemma = (lemma||"").trim().length>0;

  // 1줄: [ruby(surf/read)] – (lemma) – 번역
  (async()=>{
    // 번역은 토큰 단위로
    let tr = "";
    try{
      const t = await translateJaKo(surf);
      tr = t?.text || t?.result || "";
    }catch{}

    const ruby = read ? `<ruby>${esc(surf)}<rt>${esc(kataToHira(read))}</rt></ruby>` : esc(surf);
    const lemmaPart = hasLemma ? ` <span class="lemma">(${esc(lemma)})</span>` : "";
    sub.innerHTML = `
      <div class="sub-line">
        <a class="morph-link" href="javascript:void(0)">${ruby}</a>${lemmaPart}
        <span class="sep"> — </span>
        <span class="mtr">${esc(tr)}</span>
      </div>
      <div class="kanji-row"></div>
      <div class="anki-explain" hidden></div>
    `;

    // 네이버 사전: 형태소 클릭 시
    sub.querySelector(".morph-link").onclick = ()=> openNaverJaLemma(surf);

    // 2줄: 한자 박스 가로 나열 (DB → ANKI 우선)
    const row = sub.querySelector(".kanji-row");
    const exp = sub.querySelector(".anki-explain");
    const used = new Set();

    for (const ch of (surf.match(/[\u4E00-\u9FFF]/g)||[])){
      if (used.has(ch)) continue;
      used.add(ch);
      const anki = ANKI_MAP?.get(ch);
      const base = KANJI_MAP?.get(ch);

      const box = document.createElement("button");
      box.className = "kanji-box";
      box.textContent = ch;

      if (anki){ // 안키 우선
        box.classList.add("anki");
        box.onclick = ()=>{
          exp.innerHTML = `
            <div class="exp-h"><strong>${ch}</strong> · ${esc(anki.gloss||"")}</div>
            ${anki.explain ? `<div class="exp-b">${anki.explain}</div>` : ``}
          `;
          exp.hidden = false;
        };
      }else if (base){
        box.classList.add("db");
        const gloss =
          base.뜻 || base.의미 || base.ko || base.mean || base.korean || base.gloss || "";
        box.title = gloss || "";
        box.onclick = ()=> openNaverHanja(ch);
      }else{
        box.classList.add("ext");
        box.onclick = ()=> openNaverHanja(ch);
      }
      row.appendChild(box);
    }

    // 도킹 및 바깥 클릭 시 닫기
    sub.hidden = false;
    dockSub();
  })();
}
function dockSub(){
  const pr = pop.getBoundingClientRect();
  const left = pr.left + scrollX;
  const top  = pr.bottom + 8 + scrollY;
  Object.assign(sub.style, { left:`${left}px`, top:`${top}px`, width:`${pr.width}px` });
}

// ───────────── 수정 다이얼로그 헬퍼 ─────────────
function openEdit(e){ e?.stopPropagation?.(); editInput.value=currentSentence||""; editDlg.showModal(); }
document.getElementById("btnEdit").onclick = openEdit;
