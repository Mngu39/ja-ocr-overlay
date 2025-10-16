// /src/app.js  — 2025-10-17 build
import {
  getImageById, gcvOCR, getFurigana, translateJaKo,
  openNaverJaLemma, openNaverHanja
} from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

/* ===================== DOM refs ===================== */
const stage      = document.getElementById("stage");
const imgEl      = document.getElementById("img");
const overlay    = document.getElementById("overlay");
const hint       = document.getElementById("hint");
const pop        = document.getElementById("pop");
const sub        = document.getElementById("sub");
const btnEdit    = document.getElementById("btnEdit");
const rubyLine   = document.getElementById("rubyLine");
const origLine   = document.getElementById("origLine");
const transLine  = document.getElementById("transLine");
const editDlg    = document.getElementById("editDlg");
const editInput  = document.getElementById("editInput");

/* ===================== State ===================== */
let annos = [];                 // [{ text, polygon:[[x,y],...]}]
let currentAnchor = null;       // 활성 박스(첫 번째 선택 기준)
let currentSentence = "";       // 팝업에 표시 중인 문장
let currentTokenEl = null;      // 서브팝업 기준 토큰 엘리먼트
let selected = [];              // 다중 선택된 박스들(좌→우, 상→하 정렬)
let furiCache = new Map();      // 문장 -> furigana 결과 캐시
let transCache = new Map();     // 문장 -> 번역 캐시

// 월 1,000건 로컬 카운트 (Google Vision만)
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

/* ===================== Utils ===================== */
const esc = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30fa]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
const byReadingOrder = (a,b) => (a.t !== b.t) ? (a.t - b.t) : (a.l - b.l);

/* ===================== Kanji DB (덱/일반) ===================== */
let ankiIndex = null;   // Map<kanji, {gloss, explain?, media?}>
let kanjiIndex = null;  // Map<kanji, {gloss, ...}>

async function loadDBs(){
  try{
    // 일반 DB (루트)
    const g = await fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null).catch(()=>null);
    if (g){
      kanjiIndex = new Map();
      // 유연 파서: 배열/객체 모두 처리
      if (Array.isArray(g)){
        for (const it of g){
          const k = it.k || it.kanji || it.ch || it.key;
          const gloss = it.ko || it.mean || it.gloss || it.def || it.korean || it.translation || "";
          if (k) kanjiIndex.set(k, { gloss: String(gloss||"") });
        }
      }else{
        for (const [k,v] of Object.entries(g)){
          const gloss = v?.ko || v?.mean || v?.gloss || v?.def || "";
          kanjiIndex.set(k, { gloss: String(gloss||"") });
        }
      }
    }
  }catch{}

  try{
    // 안키 덱 (하위 폴더)
    const d = await fetch(encodeURI("./일본어_한자_암기박사/deck.json")).then(r=>r.ok?r.json():null).catch(()=>null);
    if (d){
      ankiIndex = new Map();
      const rows = Array.isArray(d?.notes) ? d.notes : (Array.isArray(d) ? d : []);
      for (const n of rows){
        // 다양한 구조 대비
        const f = n.fields || n;
        const k = f.kanji || f.Kanji || f.k || f.ch || f.character || f[0];
        const gloss = f.gloss || f.mean || f.ko || f.translation || f[1] || "";
        const explain = f.explain || f.desc || f.note || f[2] || "";
        if (k) ankiIndex.set(String(k), { gloss: String(gloss||""), explain: String(explain||"") });
      }
    }
  }catch{}
}

function lookupKanji(ch){
  if (ankiIndex && ankiIndex.has(ch)) return { source:"anki", ...ankiIndex.get(ch) };
  if (kanjiIndex && kanjiIndex.has(ch)) return { source:"general", ...kanjiIndex.get(ch) };
  return null;
}

/* ===================== Bootstrap ===================== */
(async function bootstrap(){
  // 팝 헤더(“원문/번역”)은 자리만 먹으니 숨김
  document.querySelectorAll(".pop-head").forEach(el=> el.style.display="none");
  origLine.style.display = "none"; // 중복 원문 제거

  await loadDBs();

  const qs=new URLSearchParams(location.search);
  const id=qs.get("id");
  if(!id){ hint.textContent="Bad request: ?id= required"; return; }

  // 이미지 로딩 → OCR
  imgEl.onload = async ()=>{
    const q = tryConsumeQuota();
    if(!q.ok){ hint.textContent="월간 무료 사용량 초과"; return; }
    try{
      hint.textContent = "OCR(Google) 중…";
      annos = await gcvOCR(id);
      if(!annos.length){ hint.textContent="문장을 찾지 못했습니다."; return; }
      hint.textContent = "문장상자를 탭하세요";
      renderOverlay();
    }catch(e){
      rollbackQuota(q.key);
      hint.textContent="OCR 오류";
      console.error(e);
    }
  };
  imgEl.src = await getImageById(id);
})();

/* ===================== Overlay(박스) ===================== */
function renderOverlay(){
  // 이미지 실제 표시 크기에 맞춤
  const rect = imgEl.getBoundingClientRect();
  overlay.style.width  = rect.width + "px";
  overlay.style.height = rect.height + "px";
  overlay.style.left = rect.left + window.scrollX + "px";
  overlay.style.top  = rect.top  + window.scrollY + "px";

  const sx = rect.width  / imgEl.naturalWidth;
  const sy = rect.height / imgEl.naturalHeight;

  overlay.innerHTML = "";
  selected = []; // 새 스크린마다 초기화

  annos.forEach((a, idx)=>{
    const [p0,p1,p2,p3] = a.polygon;
    const l = Math.min(p0[0],p3[0])*sx;
    const t = Math.min(p0[1],p1[1])*sy;
    const r = Math.max(p1[0],p2[0])*sx;
    const b = Math.max(p2[1],p3[1])*sy;

    const box = document.createElement("div");
    box.className = "box";
    Object.assign(box.style, {
      left: l+"px", top: t+"px", width: (r-l)+"px", height: (b-t)+"px",
      position:"absolute"
    });

    // 선택/순번 배지용
    const badge = document.createElement("div");
    Object.assign(badge.style, {
      position:"absolute", left:"4px", top:"2px",
      minWidth:"18px", height:"18px", padding:"0 4px",
      background:"rgba(80,200,255,.85)", color:"#001018",
      borderRadius:"9px", fontSize:"12px", fontWeight:"700",
      lineHeight:"18px", textAlign:"center",
      display:"none", pointerEvents:"none"
    });
    box.appendChild(badge);

    // 좌표(정렬용) 보관
    box.dataset.text = a.text || "";
    box.dataset.t = String(t);
    box.dataset.l = String(l);

    box.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      toggleSelectBox(box);
    });

    overlay.appendChild(box);
  });
}

function toggleSelectBox(box){
  const idx = selected.indexOf(box);
  if (idx>=0){
    // 선택 해제
    selected.splice(idx,1);
    box.style.background = "transparent";
    box.querySelector("div").style.display = "none";
  }else{
    // 선택
    selected.push(box);
    selected.sort((A,B)=> byReadingOrder(
      {t:+A.dataset.t, l:+A.dataset.l},
      {t:+B.dataset.t, l:+B.dataset.l}
    ));
    const order = selected.indexOf(box)+1;
    box.style.background = "rgba(80,200,255,.08)";
    const badge = box.querySelector("div");
    badge.textContent = order;
    badge.style.display = "block";
  }

  if (selected.length===0){
    pop.hidden = true;
    sub.hidden = true;
    return;
  }

  // 앵커는 첫 번째 선택
  currentAnchor = selected[0];
  const text = selected.map(b=> b.dataset.text).join("");
  currentSentence = text;
  openMainPopover(currentAnchor, text);
}

/* ===================== Relayout ===================== */
function relayout(){
  renderOverlay();
  if (currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if (currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 8);
}
window.addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
window.addEventListener("scroll", relayout, {passive:true});

/* ===================== 외부 클릭 처리 ===================== */
// 화면(=stage) 클릭 → 서브팝업만 닫기 (메인팝업은 닫기 버튼으로)
stage.addEventListener("click",(e)=>{
  if (!sub.hidden && !sub.contains(e.target)) sub.hidden = true;
});

/* ===================== 메인 팝업 ===================== */
// 닫기 버튼을 동적으로 추가 (index.html 수정 없이)
(function ensureCloseButton(){
  const head = document.createElement("div");
  head.style.display="flex";
  head.style.justifyContent="flex-end";
  head.style.marginBottom="6px";
  const btnClose = document.createElement("button");
  btnClose.textContent = "닫기";
  btnClose.className = "btn sm";
  btnClose.addEventListener("click",(e)=>{
    e.stopPropagation();
    pop.hidden = true;
    sub.hidden = true;
    // 선택 전부 초기화
    overlay.querySelectorAll(".box").forEach(b=>{
      b.style.background="transparent";
      const bd=b.querySelector("div"); if(bd) bd.style.display="none";
    });
    selected = [];
  });
  head.appendChild(btnClose);
  pop.prepend(head);
})();

btnEdit.addEventListener("click",(e)=>{
  e.stopPropagation();
  editInput.value = currentSentence || "";
  editDlg.showModal();
});
document.getElementById("editOk").addEventListener("click", ()=>{
  const t=editInput.value.trim();
  if(!t){ editDlg.close(); return; }
  currentSentence=t;
  editDlg.close();
  openMainPopover(currentAnchor, currentSentence);
});

function openMainPopover(anchor, text){
  if (!anchor) return;

  pop.hidden = false;
  sub.hidden = true;

  // 폭: 앵커 폭 기준 (과하게 작지 않게), 화면 92% 이내
  const aw = anchor.getBoundingClientRect().width;
  const overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.1), 420), Math.round(overlayW*0.92)) + "px";
  placeMainPopover(anchor, pop, 8);

  // 라인 초기화
  rubyLine.innerHTML = "";
  transLine.textContent = "…";

  // 토큰/번역 동시 처리 (캐시 사용)
  (async ()=>{
    try{
      let furi = furiCache.get(text);
      if (!furi){
        furi = await getFurigana(text);
        furiCache.set(text, furi);
      }
      let tr = transCache.get(text);
      if (!tr){
        tr = await translateJaKo(text);
        transCache.set(text, tr);
      }

      // furigana → 토큰(span.tok) + ruby
      const tokens = furi?.tokens || furi?.result || furi?.morphs || furi?.morphemes || [];
      rubyLine.innerHTML = ""; // 재생성
      for (const t of tokens){
        const surf = (t.surface || t.text || t.form || t.word || "");
        if (!surf){ rubyLine.appendChild(document.createTextNode("")); continue; }

        const lemma = t.lemma || t.base || t.dictionary || t.normalized || surf;
        const reading = kataToHira(t.reading || t.read || "");

        const span = document.createElement("span");
        span.className = "tok";
        span.dataset.token = surf;
        span.dataset.lemma = lemma;

        // ruby 구성
        const rby = document.createElement("ruby");
        const rb  = document.createElement("rb");  rb.textContent = surf;
        const rt  = document.createElement("rt");  rt.textContent = (hasKanji(surf) && reading) ? reading : "";
        rby.appendChild(rb); rby.appendChild(rt);
        span.appendChild(rby);

        // 클릭 → 서브팝업
        span.addEventListener("click",(ev)=>{
          ev.stopPropagation();
          openSubForToken(span, {surf, lemma, reading});
        });

        rubyLine.appendChild(span);
      }

      const translated = tr?.text || tr?.result || tr?.translation || "";
      transLine.textContent = translated || "(번역 없음)";
      requestAnimationFrame(()=> placeMainPopover(anchor, pop, 8));
    }catch(e){
      console.error(e);
      transLine.textContent = "(번역 실패)";
    }
  })();
}

/* ===================== 드래그(메인/서브 팝업) ===================== */
enableDrag(pop);
enableDrag(sub);
function enableDrag(panel){
  let dragging=false, sx=0, sy=0, sl=0, st=0;
  panel.addEventListener("pointerdown",(e)=>{
    // 상단 24px 안쪽에서만 드래그(실수 방지)
    const r = panel.getBoundingClientRect();
    if (e.clientY < r.top+24){
      dragging=true; sx=e.clientX; sy=e.clientY;
      sl=r.left + window.scrollX; st=r.top + window.scrollY;
      panel.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  panel.addEventListener("pointermove",(e)=>{
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    Object.assign(panel.style, { left:(sl+dx)+"px", top:(st+dy)+"px" });
  });
  panel.addEventListener("pointerup",()=> dragging=false);
  panel.addEventListener("pointercancel",()=> dragging=false);
}

/* ===================== 서브 팝업 ===================== */
async function openSubForToken(tokEl, info){
  currentTokenEl = tokEl;

  // 헤더(토큰 + 루비 + (lemma)) 자체를 네이버 링크로
  const isSingleKanji = (info.surf.length===1 && hasKanji(info.surf));
  const href = isSingleKanji
    ? `https://hanja.dict.naver.com/hanja?q=${encodeURIComponent(info.surf)}`
    : `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(info.lemma || info.surf)}`;

  // 토큰 번역(짧으니 개별 호출)
  let tRes = null;
  try{
    tRes = await translateJaKo(info.lemma || info.surf);
  }catch{}

  // 한자 박스 (가로 나열)
  const chars = Array.from(info.surf).filter(ch=> hasKanji(ch));
  const boxes = [];
  for (const ch of chars){
    const rec = lookupKanji(ch);
    const badge = `<button class="kbox" data-k="${esc(ch)}" data-src="${rec?rec.source:""}" 
      style="border:0;cursor:pointer;margin:2px 6px 2px 0;padding:4px 8px;border-radius:8px;
             font-size:14px;font-weight:700;
             color:${rec? "#061014":"#cfe8ff"};
             background:${!rec ? "#2b3a4a" : (rec.source==="anki" ? "#ffd56a" : "#8de0ff")};">${esc(ch)}</button>`;
    boxes.push(badge);
  }

  sub.innerHTML = `
    <div class="sub-wrap">
      <div class="sub-h">
        <a href="${href}" target="_blank" rel="noopener"
           style="color:#9bd1ff;text-decoration:underline;">
          <ruby><rb>${esc(info.surf)}</rb><rt style="font-size:12px">${esc(info.reading||"")}</rt></ruby>
          <span style="opacity:.8">（${esc(info.lemma||info.surf)}）</span>
        </a>
      </div>
      ${tRes?.text ? `<div class="sub-row">${esc(tRes.text)}</div>` : ``}
      ${boxes.length ? `<div class="sub-row" id="kRows" style="display:flex;flex-wrap:wrap;align-items:center">${boxes.join("")}</div>` : ``}
      <div id="kExplain" class="sub-row" style="margin-top:6px; opacity:.95"></div>
    </div>
  `;
  sub.hidden = false;
  // 크기/위치
  const baseW = Math.max(260, Math.min(560, 80 + (chars.length*56)));
  sub.style.minWidth = baseW + "px";
  placeSubDetached(pop, tokEl, sub, 8);

  // 한자 박스 클릭 핸들러
  sub.querySelectorAll(".kbox").forEach(btn=>{
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const ch = btn.dataset.k;
      const src = btn.dataset.src;
      const panel = document.getElementById("kExplain");
      const rec = lookupKanji(ch);
      if (rec && src==="anki" && rec.explain){
        panel.innerHTML = `<div style="padding:6px 8px; border-left:3px solid #ffd56a; background:#2a2a2a; border-radius:6px;">
          <strong>${esc(ch)}</strong> — ${esc(rec.gloss)}<br/>${esc(rec.explain)}
        </div>`;
      }else if (rec){
        panel.textContent = `${ch} — ${rec.gloss}`;
      }else{
        // 없는 경우 네이버 한자 사전으로
        openNaverHanja(ch);
      }
    });
  });
}

/* ===================== 스타일(선택 배지/토큰 hover) 보완 ===================== */
/* CSS를 건드리지 않고 최소 인라인 스타일로 보완 */
rubyLine.style.lineHeight = "1.8";
rubyLine.style.fontSize = "18px";