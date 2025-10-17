// /src/app.js — stable loader + requested tweaks (<=400 lines)
import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma } from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const origLine  = document.getElementById("origLine"); // 숨김(중복 제거)
const transLine = document.getElementById("transLine");
const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const btnEdit   = document.getElementById("btnEdit");
const sub       = document.getElementById("sub");

let annos = [];                // { text, polygon:[[x,y]..] }
let currentAnchor = null;      // 앵커 박스(또는 합성 앵커)
let currentSentence = "";
let currentTokenEl = null;

/* ================= Kanji DBs (지연로드: 로더 방해 X) ================= */
let KANJI = null; // /kanji_ko_attr_irreg.min.json
let ANKI  = null; // /일본어_한자_암기박사/deck.json (Map<char, explain>)
async function loadKanjiDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch(encodeURI("./일본어_한자_암기박사/deck.json")).then(r=>r.ok?r.json():null)
    ]);
    KANJI = j1.status==="fulfilled" ? j1.value : null;

    if (j2.status==="fulfilled" && j2.value){
      const m = new Map();
      const arr = Array.isArray(j2.value) ? j2.value
                : Array.isArray(j2.value.notes) ? j2.value.notes
                : Object.values(j2.value);
      for (const row of (arr||[])){
        const blob = JSON.stringify(row);
        const ks = blob && blob.match(/[\u4E00-\u9FFF]/g);
        if (!ks) continue;
        const explain = (row.explain || row.desc || row.meaning || row.back || row.definition || "").toString();
        for (const ch of new Set(ks)){ if (!m.has(ch)) m.set(ch, explain||""); }
      }
      ANKI = m;
    }
  }catch{/*ignore*/}
}
const DB_READY = loadKanjiDBs().catch(()=>null);

/* ================= Utils ================= */
const esc = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
const hasKanji   = s => /[\u3400-\u9FFF]/.test(s||"");

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

/* ================= 이미지 → OCR (네가 준 로더 그대로) ================= */
(async function bootstrap(){
  try{
    // 헤더("원문/번역") 숨김 + 원문 라인 숨김
    document.querySelectorAll(".pop-head").forEach(el=> el.style.display="none");
    origLine.innerHTML=""; origLine.style.display="none";

    const qs = new URLSearchParams(location.search);
    const id = qs.get("id");
    if(!id) throw new Error("?id= 필요");

    imgEl.onload = async ()=>{
      const q=tryConsumeQuota(); if(!q.ok){ hint.textContent="월간 무료 사용량 초과"; return; }
      try{
        hint.textContent="OCR(Google) 중…";
        annos = await gcvOCR(id);
        if (!annos.length){ hint.textContent="문장을 찾지 못했습니다."; return; }
        hint.textContent="문장상자를 탭하세요";
        renderOverlay();
      }catch(e){ rollbackQuota(q.key); console.error(e); hint.textContent="OCR 오류"; }
    };
    imgEl.onerror = ()=>{ hint.textContent="이미지를 불러오지 못했습니다"; };

    // ← 사파리 안전 캐시버스터: 이 줄이 '잘 되던' 핵심
    imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`;
  }catch(e){ hint.textContent=e.message; }
})();

/* ================= 오버레이 박스 ================= */
const sel = []; // 선택 순서(토글)
function renderOverlay(){
  const rect=imgEl.getBoundingClientRect();
  overlay.style.width=rect.width+"px"; overlay.style.height=rect.height+"px";
  const sx=rect.width/imgEl.naturalWidth, sy=rect.height/imgEl.naturalHeight;

  overlay.innerHTML="";
  for(const a of annos){
    const [p0,p1,p2,p3]=a.polygon;
    const l=Math.min(p0[0],p3[0])*sx, t=Math.min(p0[1],p1[1])*sy;
    const r=Math.max(p1[0],p2[0])*sx, b=Math.max(p2[1],p3[1])*sy;
    const box=document.createElement("div");
    box.className="box";
    Object.assign(box.style,{ left:l+"px", top:t+"px", width:(r-l)+"px", height:(b-t)+"px" });
    box.dataset.text=a.text||"";
    box.addEventListener("click",(ev)=>{ ev.stopPropagation(); toggleSelect(box); });
    overlay.appendChild(box);
  }
  paintSelection();
}
function toggleSelect(box){
  const i=sel.indexOf(box);
  if(i>=0) sel.splice(i,1); else sel.push(box);
  if(!sel.length){ pop.hidden=true; sub.hidden=true; }
  paintSelection();
  if(sel.length) openMainFromSelection();
}
function paintSelection(){
  overlay.querySelectorAll(".box").forEach(b=>{
    b.classList.remove("active"); b.style.background="transparent";
    b.querySelector(".tag")?.remove();
  });
  sel.forEach((b,idx)=>{
    b.classList.add("active");
    b.style.background="rgba(80,200,255,.10)";
    const t=document.createElement("div");
    t.className="tag";
    t.textContent=String(idx+1);
    Object.assign(t.style,{
      position:"absolute", right:"4px", top:"2px",
      background:"#50c8ff", color:"#002331", fontWeight:"700",
      padding:"0 6px", borderRadius:"10px", fontSize:"12px"
    });
    b.appendChild(t);
  });
}
function unionRect(boxes){
  const rs=boxes.map(b=>b.getBoundingClientRect());
  const l=Math.min(...rs.map(r=>r.left)), t=Math.min(...rs.map(r=>r.top));
  const r=Math.max(...rs.map(r=>r.right)), b=Math.max(...rs.map(r=>r.bottom));
  return { left:l, top:t, width:r-l, height:b-t, right:r, bottom:b };
}
function selectedText(){ return sel.map(b=>b.dataset.text||"").join(""); }

/* ================= 메인 팝업 ================= */
function openMainFromSelection(){
  const ar = unionRect(sel);
  const fake = document.createElement("div");
  Object.assign(fake.style,{ position:"absolute", left:ar.left+window.scrollX+"px",
    top:ar.top+window.scrollY+"px", width:ar.width+"px", height:ar.height+"px" });
  document.body.appendChild(fake);
  currentAnchor=fake; currentSentence=selectedText();
  openMainPopover(currentAnchor, currentSentence).finally(()=> fake.remove());
}
async function openMainPopover(anchor, text){
  pop.hidden=false; sub.hidden=true;

  // 폭: 앵커 기준(너무 작지 않게), 화면 92% 이내
  const aw = anchor.getBoundingClientRect().width, overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.1), 420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  ensureSideDock(); // 닫기/수정 도크(간결)

  rubyLine.innerHTML="…"; transLine.textContent="…";

  try{
    const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);
    const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [])
      .map(t=>{
        const surf = t.surface || t.text || "";
        const read = kataToHira(t.reading || t.read || "");
        const lemma= t.lemma  || t.base   || surf;
        return { surf, read, lemma };
      }).filter(t=>t.surf);

    // 루비 라인만 사용(중복 원문 제거)
    rubyLine.innerHTML = tokens.map(t=>{
      if (hasKanji(t.surf) && t.read){
        return `<span class="tok" data-surf="${esc(t.surf)}" data-lemma="${esc(t.lemma)}" data-read="${esc(t.read)}"><ruby>${esc(t.surf)}<rt>${esc(t.read)}</rt></ruby></span>`;
      }
      return `<span class="tok" data-surf="${esc(t.surf)}" data-lemma="${esc(t.lemma||t.surf)}" data-read="">${esc(t.surf)}</span>`;
    }).join("");

    // 토큰 클릭 → 서브팝업
    rubyLine.querySelectorAll(".tok").forEach(span=>{
      span.addEventListener("click",(ev)=>{
        ev.stopPropagation();
        openSubForToken(span, {
          surf: span.dataset.surf || "",
          lemma: span.dataset.lemma || span.dataset.surf || "",
          read: span.dataset.read || ""
        });
      });
    });

    const out = tr?.text || tr?.result || tr?.translation || "";
    transLine.textContent = out || "(번역 없음)";
    requestAnimationFrame(()=> placeMainPopover(anchor, pop, 8));
  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }
}

/* ================= 닫기/수정 도크 + 드래그 이동 ================= */
function ensureSideDock(){
  if (pop.querySelector(".dock")) return;
  const dock = document.createElement("div");
  dock.className = "dock";
  Object.assign(dock.style,{
    position:"absolute", right:"-44px", top:"8px", width:"36px",
    display:"flex", flexDirection:"column", gap:"10px", zIndex:"2"
  });
  const mk = (label, handler)=> {
    const b=document.createElement("button");
    b.textContent=label; b.className="btn sm";
    Object.assign(b.style,{ width:"36px", height:"36px", borderRadius:"18px", padding:"0" });
    b.addEventListener("click",(e)=>{ e.stopPropagation(); handler(); });
    return b;
  };
  dock.appendChild(mk("✕", ()=>{ pop.hidden=true; sub.hidden=true; sel.length=0; paintSelection(); }));
  dock.appendChild(mk("✎", ()=>{ editInput.value=currentSentence||""; editDlg.showModal(); }));
  pop.appendChild(dock);

  // 드래그(상단 24px 영역에서만)
  enableDrag(pop);
  enableDrag(sub);
}
function enableDrag(panel){
  let dragging=false, sx=0, sy=0, sl=0, st=0;
  panel.addEventListener("pointerdown",(e)=>{
    const r=panel.getBoundingClientRect();
    if(e.clientY < r.top+24){
      dragging=true; sx=e.clientX; sy=e.clientY;
      sl=r.left+window.scrollX; st=r.top+window.scrollY;
      panel.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  panel.addEventListener("pointermove",(e)=>{
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    panel.style.left=(sl+dx)+"px"; panel.style.top=(st+dy)+"px";
  });
  panel.addEventListener("pointerup",()=> dragging=false);
  panel.addEventListener("pointercancel",()=> dragging=false);
}

/* ================= 수정 다이얼로그 → 재계산 ================= */
document.getElementById("editOk").addEventListener("click", ()=>{
  const t=editInput.value.trim(); if(!t){ editDlg.close(); return; }
  currentSentence=t; editDlg.close(); openMainPopover(currentAnchor, currentSentence);
});
btnEdit.addEventListener("click",(e)=>{ e.stopPropagation(); editInput.value=currentSentence||""; editDlg.showModal(); });

/* ================= 서브팝업(토큰) ================= */
async function openSubForToken(tokEl, token){
  currentTokenEl = tokEl;
  sub.hidden=false;
  placeSubDetached(pop, tokEl, sub, 6);

  // 항상 네이버 일본어사전
  const headLink = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(token.lemma||token.surf)}`;

  sub.innerHTML = `
    <div class="sub-wrap">
      <div class="sub-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <a href="${headLink}" target="_blank" style="text-decoration:underline;color:#9bd1ff;">
          ${token.read ? `<ruby>${esc(token.surf)}<rt style="font-size:11px">${esc(kataToHira(token.read))}</rt></ruby>` : esc(token.surf)}
          <span style="opacity:.7">(${esc(token.lemma||token.surf)})</span>
        </a>
        <span id="tok-trans" style="opacity:.95"></span>
      </div>
      <div id="kanji-row" class="sub-row" style="display:flex;gap:6px;flex-wrap:wrap"></div>
      <div id="kExplain" class="sub-row" style="margin-top:6px; opacity:.95"></div>
    </div>`;

  // 단어 번역
  try{
    const tr = await translateJaKo(token.lemma||token.surf);
    const t = tr?.text || tr?.result || tr?.translation || "";
    sub.querySelector("#tok-trans").textContent = t ? "— "+t : "";
  }catch{ sub.querySelector("#tok-trans").textContent = ""; }

  await DB_READY;
  const ks = (token.surf.match(/[\u4E00-\u9FFF]/g)||[]);
  const row = sub.querySelector("#kanji-row");
  const panel = sub.querySelector("#kExplain");

  for (const ch of new Set(ks)){
    const hasAnki = ANKI?.get?.(ch);
    const hasGen  = !!(KANJI && KANJI[ch]);
    const chip = document.createElement("button");
    chip.className="kbox";
    chip.textContent = ch;
    Object.assign(chip.style,{
      border:"1px solid #2a2f3b", padding:"4px 8px", borderRadius:"8px",
      background: hasAnki ? "#ffd56a" : (hasGen ? "#8de0ff" : "#2b3a4a"),
      color: hasAnki || hasGen ? "#001018" : "#cfe8ff",
      cursor:"pointer", fontWeight:"700"
    });
    chip.addEventListener("click",(e)=>{
      e.stopPropagation();
      if (hasAnki){
        panel.innerHTML = `<div style="padding:6px 8px; border-left:3px solid #ffd56a; background:#2a2a2a; border-radius:6px;">
          <strong>${esc(ch)}</strong> — ${esc(ANKI.get(ch)||"")}
        </div>`;
      }else if (hasGen){
        const v = KANJI[ch];
        const gloss = (v?.ko || v?.mean || v?.korean || v?.gloss || v?.def || "").toString();
        panel.textContent = gloss ? `${ch} — ${gloss}` : `${ch}`;
      }else{
        // 미존재: 일본어사전으로
        openNaverJaLemma(ch);
      }
    });
    row.appendChild(chip);
  }

  // 칩 개수에 따른 최소 너비 보정
  const chipCount = new Set(ks).size;
  if (chipCount){
    const baseW = Math.max(260, Math.min(560, 80 + chipCount*56));
    sub.style.minWidth = baseW + "px";
  }
}

/* ================= 재배치/외부 클릭 ================= */
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 6);
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});

// 서브팝업만 닫기(팝업 외)
stage.addEventListener("click",(e)=>{
  if (!sub.hidden && !sub.contains(e.target)) sub.hidden = true;
});
// 문서 캡처에서도 한 번 더(토큰 제외)
document.addEventListener("click",(e)=>{
  if (!sub.hidden && !sub.contains(e.target)){
    const isTok = e.target.closest?.(".tok");
    if (!isTok) sub.hidden = true;
  }
}, {capture:true});
