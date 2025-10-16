// /src/app.js  — compact & stable (≈250 lines)
import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const origLine  = document.getElementById("origLine"); // 쓰지 않음(중복 제거)
const transLine = document.getElementById("transLine");
const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const btnEdit   = document.getElementById("btnEdit");

const sub = document.getElementById("sub");

let annos = [];                // { text, polygon:[[x,y]..] }
let currentAnchor = null;      // 앵커 박스(또는 합성 앵커)
let currentSentence = "";
let currentTokenEl = null;

// ===== Kanji DBs (지연로드: 이미지 로더를 절대 막지 않음) =====
let KANJI = null;      // 일반 DB: /kanji_ko_attr_irreg.min.json
let ANKI  = null;      // 사용자 덱: /일본어_한자_암기박사/deck.json
async function loadKanjiDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);
    KANJI = j1.status==="fulfilled" ? j1.value : null;
    // 덱 인덱싱(문자→설명) — 다양한 필드명에 대응
    if (j2.status==="fulfilled" && j2.value){
      const m = new Map();
      const arr = Array.isArray(j2.value) ? j2.value
                  : Array.isArray(j2.value.notes) ? j2.value.notes
                  : Object.values(j2.value);
      for (const row of (arr||[])){
        const textBlob = JSON.stringify(row);
        const m1 = textBlob && textBlob.match(/[\u4E00-\u9FFF]/g);
        if (!m1) continue;
        const explain = (row.explain || row.desc || row.meaning || row.back || row.definition || "").toString();
        for (const ch of new Set(m1)) {
          if (!m.has(ch)) m.set(ch, explain || "");
        }
      }
      ANKI = m; // Map<char, explain>
    }
  }catch{ /* ignore */ }
}
// 백그라운드 시작
const DB_READY = loadKanjiDBs().catch(()=>null);

// ===== 유틸 =====
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
const hasKanji   = s => /[\u3400-\u9FFF]/.test(s||"");

// 월 1,000건 로컬 카운트(간단)
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// ===== 이미지 → OCR =====
(async function bootstrap(){
  try{
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
    imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`; // 캐시 버스터(사파리 안전)
  }catch(e){ hint.textContent=e.message; }
})();

// ===== 오버레이 박스 =====
const sel = []; // 선택 순서 배열(요청대로 토글·순서 유지)
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
  const i = sel.indexOf(box);
  if (i>=0) sel.splice(i,1); else sel.push(box);
  if (!sel.length) { pop.hidden=true; sub.hidden=true; }
  paintSelection();
  if (sel.length) openMainFromSelection();
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

// ===== 팝업(메인) =====
function openMainFromSelection(){
  const anchorRect = unionRect(sel);
  // 가짜 앵커(div)로 배치(기존 placeMainPopover 재사용)
  const fake = document.createElement("div");
  Object.assign(fake.style,{ position:"absolute", left:anchorRect.left+window.scrollX+"px",
    top:anchorRect.top+window.scrollY+"px", width:anchorRect.width+"px", height:anchorRect.height+"px" });
  document.body.appendChild(fake);
  currentAnchor=fake; currentSentence=selectedText();
  openMainPopover(currentAnchor, currentSentence).finally(()=> fake.remove());
}

async function openMainPopover(anchor, text){
  pop.hidden=false; sub.hidden=true;
  // 폭: 앵커 대비 넉넉히, 화면폭 92% 제한
  const aw = anchor.getBoundingClientRect().width, overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.1), 420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  // 사이드 툴바(닫기/수정) — 항상 pop 오른쪽에 부착
  ensureSideDock();

  // 중복 원문 제거: origLine 비활성화
  origLine.innerHTML=""; origLine.style.display="none";
  rubyLine.innerHTML="…"; transLine.textContent="…";

  // Furigana + 번역 동시 요청
  try{
    const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);
    // rubi.tokens 기반으로 ruby HTML 구성(토큰마다 클릭 가능)
    const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [])
      .map(t=>{
        const surf = t.surface || t.text || "";
        const read = kataToHira(t.reading || t.read || "");
        const lemma= t.lemma  || t.base   || surf;
        return { surf, read, lemma };
      }).filter(t=>t.surf);

    rubyLine.innerHTML = tokens.map(t=>{
      if (hasKanji(t.surf) && t.read){
        return `<span class="tok" data-surf="${escapeHtml(t.surf)}" data-lemma="${escapeHtml(t.lemma)}" data-read="${escapeHtml(t.read)}"><ruby>${escapeHtml(t.surf)}<rt>${escapeHtml(t.read)}</rt></ruby></span>`;
      }
      return `<span class="tok" data-surf="${escapeHtml(t.surf)}" data-lemma="${escapeHtml(t.lemma||t.surf)}" data-read="">${escapeHtml(t.surf)}</span>`;
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

// 사이드 도킹(닫기/수정)
function ensureSideDock(){
  if (pop.querySelector(".dock")) return;
  const dock = document.createElement("div");
  dock.className="dock";
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
  // 닫기
  dock.appendChild(mk("✕", ()=>{ pop.hidden=true; sub.hidden=true; sel.length=0; paintSelection(); }));
  // 수정
  dock.appendChild(mk("✎", ()=>{
    editInput.value=currentSentence||""; editDlg.showModal();
  }));
  pop.appendChild(dock);

  // 방향 화살표 (얇게)
  const arrows = document.createElement("div");
  Object.assign(arrows.style,{ position:"absolute", inset:"2px", pointerEvents:"none" });
  pop.appendChild(arrows);
  [["↑","top"],["↓","bottom"],["←","left"],["→","right"]].forEach(([ch,dir])=>{
    const a=document.createElement("div");
    a.textContent=ch;
    Object.assign(a.style,{
      position:"absolute", pointerEvents:"auto", opacity:.55, fontSize:"12px",
      background:"#2b2f3a", padding:"2px 6px", borderRadius:"10px", userSelect:"none", cursor:"pointer"
    });
    if(dir==="top")    Object.assign(a.style,{ left:"50%", transform:"translateX(-50%)", top:"-20px" });
    if(dir==="bottom") Object.assign(a.style,{ left:"50%", transform:"translateX(-50%)", bottom:"-20px" });
    if(dir==="left")   Object.assign(a.style,{ top:"50%",  transform:"translateY(-50%)", left:"-24px" });
    if(dir==="right")  Object.assign(a.style,{ top:"50%",  transform:"translateY(-50%)", right:"-24px" });
    a.addEventListener("click",(e)=>{ e.stopPropagation(); nudgeTo(dir); });
    arrows.appendChild(a);
  });
}
function nudgeTo(dir){
  // 앵커 주변으로 재배치(간단한 우선 배치)
  if(!currentAnchor) return;
  placeMainPopover(currentAnchor, pop, 8); // 기본 위치부터
  const r=pop.getBoundingClientRect();
  const dx = dir==="left" ? -Math.min(24, r.left-8) : dir==="right"?  Math.min(24, innerWidth-8-r.right) : 0;
  const dy = dir==="top"  ? -Math.min(24, r.top-8)   : dir==="bottom"? Math.min(24, innerHeight-8-r.bottom) : 0;
  pop.style.left = (r.left + dx + window.scrollX) + "px";
  pop.style.top  = (r.top  + dy + window.scrollY)  + "px";
}

// 수정 다이얼로그 → 재계산
document.getElementById("editOk").addEventListener("click", ()=>{
  const t=editInput.value.trim(); if(!t){ editDlg.close(); return; }
  currentSentence=t; editDlg.close(); openMainPopover(currentAnchor, currentSentence);
});
btnEdit.addEventListener("click",(e)=>{ e.stopPropagation(); editInput.value=currentSentence||""; editDlg.showModal(); });

// ===== 서브팝업(토큰) =====
async function openSubForToken(tokEl, token){
  currentTokenEl = tokEl;
  sub.hidden=false;

  // 항상 메인팝업 아래에 밀착(요구)
  placeSubDetached(pop, tokEl, sub, 6);
  const headLink = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(token.lemma||token.surf)}`;

  // 한 줄: (루비)표기  (lemma)  —  번역
  sub.innerHTML = `
    <div class="sub-wrap">
      <div class="sub-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <a href="${headLink}" target="_blank" style="text-decoration:underline;color:#9bd1ff;">
          ${token.read ? `<ruby>${escapeHtml(token.surf)}<rt style="font-size:11px">${escapeHtml(kataToHira(token.read))}</rt></ruby>` : escapeHtml(token.surf)}
          <span style="opacity:.7">(${escapeHtml(token.lemma||token.surf)})</span>
        </a>
        <span id="tok-trans" style="opacity:.95"></span>
      </div>
      <div id="kanji-row" class="sub-row" style="display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>`;

  // 번역(단어 단위)
  try{
    const tr = await translateJaKo(token.lemma||token.surf);
    const t = tr?.text || tr?.result || tr?.translation || "";
    sub.querySelector("#tok-trans").textContent = t ? "— "+t : "";
  }catch{ sub.querySelector("#tok-trans").textContent = ""; }

  // Kanji row
  await DB_READY;
  const ks = (token.surf.match(/[\u4E00-\u9FFF]/g)||[]);
  const row = sub.querySelector("#kanji-row");
  for (const ch of new Set(ks)){
    const box = document.createElement("button");
    box.textContent = ch;
    Object.assign(box.style,{
      border:"1px solid #2a2f3b", padding:"4px 8px", borderRadius:"8px",
      background: ANKI?.get?.(ch) ? "#2d3b29" : (lookupKO(ch) ? "#222a39" : "#2a2a2a"),
      color:"#e8eefc", cursor:"pointer", fontWeight:"700"
    });
    box.addEventListener("click",(e)=>{
      e.stopPropagation();
      const ex = ANKI?.get?.(ch);
      if (ex){
        // 아래 설명 토글
        let exEl = box.nextElementSibling;
        if (exEl?.className!=="kanji-explain"){
          exEl = document.createElement("div");
          exEl.className="kanji-explain";
          exEl.style.cssText="flex-basis:100%; font-size:13px; opacity:.9; padding-top:2px;";
          box.after(exEl);
        }else{
          exEl.remove(); return;
        }
        exEl.textContent = ex;
      }else{
        const ko = lookupKO(ch);
        if (ko){
          // 간단 훈음만 보여주고, 다시 누르면 네이버
          alert(`${ch} : ${ko}`);
        }else{
          openNaverHanja(ch);
        }
      }
    });
    row.appendChild(box);
  }
}
function lookupKO(ch){
  if (!KANJI) return "";
  const v = KANJI[ch];
  if (!v) return "";
  // 다양한 필드명 대응(가벼운 휴리스틱)
  return (v.ko || v.mean || v.korean || v.gloss || v.def || "").toString();
}

// ===== 리사이즈/스크롤 시 재배치 =====
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 6);
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});

// ===== 바깥(팝업 외 영역) 클릭 시 — 메인은 유지, 서브만 닫기 =====
stage.addEventListener("click",(e)=>{
  if (!sub.hidden && !sub.contains(e.target)) sub.hidden = true;
  // 메인 팝업 닫기는 사이드 ✕ 버튼으로만(요청사항)
});
