// 안정 동작판(이미지 로더 절대 고정) + 지정 수정사항 반영
import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { placeMainPopover } from "./place.js"; // 메인은 place.js 사용. 서브는 아래에서 전용 배치 사용.

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");
const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const btnEdit   = document.getElementById("btnEdit");   // 원래 버튼(숨김 처리)
const btnClose  = document.getElementById("btnClose");  // 원래 버튼(숨김 처리)
const popDrag   = document.getElementById("popDrag");

const sub       = document.getElementById("sub");
const subTitle  = document.getElementById("subTitle");
const subBody   = document.getElementById("subBody");
const subDrag   = document.getElementById("subDrag");

// 선택 관련
let annos = [];                // [{ text, polygon:[[x,y]x4] }...]
let selected = [];             // [{ el, text }]
let currentAnchor = null;      // 항상 "첫 번째" 선택 박스 기준
let currentTokenEl = null;     // 현재 토큰 엘리먼트(서브팝업 기준)

// ===== Kanji DBs =====
let KANJI = null;  // 일반: { '漢': { '음': '...', '훈': '...', ... }, ... }
let ANKI  = null;  // Anki:  { '漢': { mean:'...', explain:'...' }, ... }
async function loadDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);
    KANJI = j1.status==="fulfilled" ? (j1.value||{}) : {};

    // CrowdAnki 구조 → 단일 맵으로 변환
    if (j2.status==="fulfilled" && j2.value){
      const map = {};
      const stack = [j2.value];
      while(stack.length){
        const node = stack.pop();
        if (Array.isArray(node?.children)) stack.push(...node.children);
        if (Array.isArray(node?.notes)){
          for (const n of node.notes){
            const f = n.fields || [];
            const ch     = (f[1] ?? "").toString().trim();
            const mean   = (f[2] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            const explain= (f[3] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            if (ch && ch.length===1) map[ch] = { mean, explain };
          }
        }
      }
      ANKI = map;
    }else{
      ANKI = {};
    }
  }catch{
    KANJI={}; ANKI={};
  }
}
const DB_READY = loadDBs();

// ===== 유틸 =====
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji   = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// ===== Bootstrap (이미지 → OCR) =====
// ⚠️ 이 3줄은 절대 고정 (요청대로)
(async function bootstrap(){
  try{
    const qs=new URLSearchParams(location.search);
    const id=qs.get("id");
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
    imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`; // 캐시 버스터(고정)
  }catch(e){ hint.textContent=e.message; }
})();

// ===== Overlay =====
function renderOverlay(){
  const rect=imgEl.getBoundingClientRect();
  overlay.style.width=rect.width+"px"; overlay.style.height=rect.height+"px";
  const sx=rect.width/imgEl.naturalWidth, sy=rect.height/imgEl.naturalHeight;

  overlay.innerHTML="";
  for(const a of annos){
    const [p0,p1,p2,p3]=a.polygon;
    const l=Math.min(p0[0],p3[0])*sx, t=Math.min(p0[1],p1[1])*sy;
    const r=Math.max(p1[0],p2[0])*sx, b=Math.max(p2[1],p3[1])*sy;
    const w=Math.max(6, r-l), h=Math.max(6, b-t);
    const box=document.createElement("div");
    box.className="box";
    Object.assign(box.style,{ left:l+"px", top:t+"px", width:w+"px", height:h+"px" });
    box.dataset.text=a.text||"";
    box.addEventListener("click",(ev)=>{ ev.stopPropagation(); toggleSelect(box); });
    overlay.appendChild(box);
  }
  renumber();
}

function toggleSelect(box){
  const i = selected.findIndex(x=>x.el===box);
  if (i>=0){
    box.classList.remove("selected"); box.querySelector(".ord")?.remove();
    selected.splice(i,1);
  }else{
    selected.push({ el:box, text:box.dataset.text||"" });
    box.classList.add("selected");
    const tag=document.createElement("span"); tag.className="ord"; tag.textContent=selected.length; box.appendChild(tag);
  }
  renumber();

  if (selected.length){
    currentAnchor = selected[0].el;             // 기준 앵커 = 첫 번째
    openMainFromSelection();
  }else{
    pop.hidden=true; sub.hidden=true;
  }
}

function renumber(){
  selected.forEach((it,i)=> it.el.querySelector(".ord")?.textContent = i+1);
}
function selectedText(){ return selected.map(x=>x.text).join(""); }

// ===== Main Popover =====
function openMainFromSelection(){
  openMainPopover(currentAnchor, selectedText());
}

async function openMainPopover(anchor, text){
  pop.hidden=false; sub.hidden=true;

  // 기존 한글 버튼 숨김 + 우측 도킹 아이콘 생성
  hideLegacyHeadButtons();
  ensureSideDock();

  // 폭: 앵커 기준, 화면폭 92% 제한
  const aw = anchor.getBoundingClientRect().width, overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.1), 420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  // 루비/번역 초기화
  rubyLine.innerHTML="…"; transLine.textContent="…";

  try{
    const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);

    // 토큰 표준화
    const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || []).map(t=>({
      surface: t.surface || t.text || "",
      reading: kataToHira(t.reading || t.read || t.kana || ""),
      lemma:   t.lemma || t.base || t.baseform || t.dict || (t.surface||t.text||"")
    })).filter(t=>t.surface);

    // 루비 HTML + 클릭(서브팝업)
    rubyLine.innerHTML = tokens.map(t=>{
      const surf=escapeHtml(t.surface), read=escapeHtml(t.reading||"");
      const data = `data-surf="${surf}" data-lemma="${escapeHtml(t.lemma||t.surface)}" data-read="${read}"`;
      if (hasKanji(t.surface) && t.reading){
        return `<span class="tok" ${data}><ruby>${surf}<rt>${read}</rt></ruby></span>`;
      }
      return `<span class="tok" ${data}>${surf}</span>`;
    }).join("");

    rubyLine.querySelectorAll(".tok").forEach(span=>{
      span.addEventListener("click",(ev)=>{
        ev.stopPropagation();
        openSubForToken(span, {
          surface: span.dataset.surf || "",
          lemma:   span.dataset.lemma || span.dataset.surf || "",
          reading: span.dataset.read || ""
        });
      });
    });

    const out = tr?.text || tr?.result || tr?.translation || "";
    transLine.textContent = out || "(번역 없음)";

    requestAnimationFrame(()=>{
      placeMainPopover(anchor, pop, 8);
      updateArrowEnablement(); // 화살표 가능/불가 갱신
    });
  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }
}

// ── 상단 한글 버튼 숨기고, 우측 도킹 아이콘 생성 ──
function hideLegacyHeadButtons(){
  const actions = pop.querySelector(".pop-actions");
  if (actions) actions.style.display = "none"; // “수정/닫기” 텍스트 버튼 숨김
}
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
    b.textContent=label;
    b.title = (label==="✎"?"원문 수정":"닫기");
    b.className="btn sm";
    Object.assign(b.style,{ width:"36px", height:"36px", borderRadius:"18px", padding:"0" });
    b.addEventListener("click",(e)=>{ e.stopPropagation(); handler(); });
    return b;
  };
  // 닫기
  dock.appendChild(mk("✕", ()=>{
    pop.hidden = true; sub.hidden = true;
    selected.forEach(it=>{ it.el.classList.remove("selected"); it.el.querySelector(".ord")?.remove(); });
    selected = [];
  }));
  // 수정
  dock.appendChild(mk("✎", ()=>{
    editInput.value = selectedText() || "";
    editDlg.showModal();
  }));
  pop.appendChild(dock);
}

// 수정 다이얼로그
document.getElementById("editOk").addEventListener("click", ()=>{
  const t = editInput.value.trim(); if(!t){ editDlg.close(); return; }
  editDlg.close(); openMainPopover(currentAnchor, t);
});

// ===== 얇고 긴 방향바: ‘스냅’ 이동(첫 박스 기준 상/하/좌/우) =====
const bars = Array.from(pop.querySelectorAll(".arrow-bar"));
bars.forEach(b=>{
  b.addEventListener("click",(e)=>{
    e.stopPropagation();
    if (b.classList.contains("disabled")) return;
    snapTo(b.dataset.dir);
  });
});
function vb(){ return (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX }); }

function simulateSnap(dir){
  if(!currentAnchor) return null;
  const gap = 8;
  const ar = currentAnchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = pr.left, top = pr.top;

  if (dir==="top"){
    left = ar.left + (ar.width - pr.width)/2;
    top  = ar.top - pr.height - gap;
  }else if (dir==="bottom"){
    left = ar.left + (ar.width - pr.width)/2;
    top  = ar.bottom + gap;
  }else if (dir==="left"){
    left = ar.left - pr.width - gap;
    top  = ar.top + (ar.height - pr.height)/2;
  }else if (dir==="right"){
    left = ar.right + gap;
    top  = ar.top + (ar.height - pr.height)/2;
  }
  return { left: Math.round(left + window.scrollX), top: Math.round(top + window.scrollY), width: pr.width, height: pr.height };
}

function snapTo(dir){
  const pos = simulateSnap(dir); if(!pos) return;
  // 바로 스냅(잘려도 허용). 단, 화살표 자체가 완전히 화면 밖으로 사라질 것 같으면 동작 안 함.
  if (!canShowArrowAfter(pos, dir)) return;
  pop.style.left = pos.left + "px";
  pop.style.top  = pos.top  + "px";

  // 서브팝업 재배치
  if (currentTokenEl && !sub.hidden) placeSubBelow();
  updateArrowEnablement();
}

function canShowArrowAfter(pos, dir){
  const v = vb();
  const barMargin = 12; // 바 자체 클릭 여유
  const left   = pos.left, top = pos.top, right = left + pos.width, bottom = top + pos.height;
  if (dir==="top")    return (top - barMargin)    >= v.offsetTop;
  if (dir==="bottom") return (bottom + barMargin) <= (v.offsetTop + v.height);
  if (dir==="left")   return (left - barMargin)   >= v.offsetLeft;
  if (dir==="right")  return (right + barMargin)  <= (v.offsetLeft + v.width);
  return true;
}

function updateArrowEnablement(){
  ["top","bottom","left","right"].forEach(d=>{
    const pos = simulateSnap(d);
    const el = pop.querySelector(`.arrow-${d}`);
    if (!pos || !canShowArrowAfter(pos, d)) el?.classList.add("disabled");
    else el?.classList.remove("disabled");
  });
}

// ===== 서브팝업(가독성/위치 개선) =====
document.addEventListener("click",(e)=>{
  // 바깥 클릭 → 서브만 닫기
  if(!sub.hidden && !sub.contains(e.target)) sub.hidden = true;
},{capture:true});

async function openSubForToken(tokEl, tok){
  currentTokenEl = tokEl;
  const surface = tok.surface||"";
  const reading = kataToHira(tok.reading||"");
  const lemma   = tok.lemma||surface;

  // 헤더(가독성 높인 링크 + lemma)
  const url = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(lemma||surface)}`;
  subTitle.innerHTML = `
    <a href="${url}" target="_blank" style="color:#9bd1ff;text-decoration:underline;font-weight:700;">
      ${hasKanji(surface)&&reading
        ? `<ruby>${escapeHtml(surface)}<rt style="font-size:11px">${escapeHtml(reading)}</rt></ruby>`
        : escapeHtml(surface)}
    </a><span class="lemma" style="opacity:.85;margin-left:6px;">(${escapeHtml(lemma)})</span>`;

  // 본문: 번역 + 한자박스(가로 배치)
  subBody.innerHTML = `
    <div class="sub-row" id="subTrans" style="font-size:14px;line-height:1.6;">…</div>
    <div class="sub-row"><div class="kwrap" id="kwrap" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>`;

  // 번역(단어)
  try{
    const r = await translateJaKo(lemma||surface);
    const txt = r?.text || r?.result || r?.translation || "";
    document.getElementById("subTrans").textContent = txt || "(번역 없음)";
  }catch{
    document.getElementById("subTrans").textContent = "(번역 실패)";
  }

  // 한자 박스
  await DB_READY;
  const kwrap = document.getElementById("kwrap");
  const uniq = Array.from(new Set(Array.from(surface).filter(ch=>hasKanji(ch))));
  for (const ch of uniq){
    const anki = ANKI?.[ch];
    const db   = KANJI?.[ch];
    const div  = document.createElement("div");
    div.className = "k " + (anki ? "anki" : "db");
    Object.assign(div.style, {
      border:"1px solid #2a2f3b", padding:"4px 8px", borderRadius:"8px",
      fontWeight:"700",
      background: anki ? "#2d3b29" : (db ? "#222a39" : "#2a2a2a"),
      color:"#e8eefc", cursor:"pointer"
    });
    const gloss = anki ? (anki.mean||"") : (db ? [db["음"], db["훈"]].filter(Boolean).join(" / ") : "");
    div.innerHTML = `${escapeHtml(ch)}${gloss?`<small style="display:block;opacity:.85;">${escapeHtml(gloss)}</small>`:""}`;

    div.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if (anki){
        let ex = subBody.querySelector(".k-explain");
        if(!ex){ ex=document.createElement("div"); ex.className="k-explain sub-row"; subBody.appendChild(ex); }
        ex.textContent = anki.explain || "(설명 없음)";
      }else{
        if (db){
          // 간단 훈/음 토글 알림(간단 표시). 상세는 네이버 한자.
          alert(`${ch} : ${gloss || "-"}`);
        }else{
          openNaverHanja(ch);
        }
      }
    });
    kwrap.appendChild(div);
  }

  // 폭/배치: 메인 팝업 외측 "하단" 우선, 공간 없으면 상단
  sub.hidden = false;
  placeSubBelow();
}

function placeSubBelow(){
  const v  = vb();
  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();
  const gap = 8;

  let left = pr.left; // 기본: 메인팝업의 왼쪽에 맞춤
  // 뷰포트 내로 좌우 조정(필요 시만)
  left = Math.max(v.offsetLeft + 8, Math.min(left, v.offsetLeft + v.width - sr.width - 8));

  let top  = pr.bottom + gap; // 기본: 하단
  if (top + sr.height > v.offsetTop + v.height - 8){
    top = pr.top - sr.height - gap; // 상단 폴백
  }

  sub.style.left = (left + window.scrollX) + "px";
  sub.style.top  = (top  + window.scrollY) + "px";
}

// ===== Relayout =====
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(!sub.hidden){
    if (currentTokenEl) placeSubBelow();
  }
  if(!pop.hidden) updateArrowEnablement();
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});

// ===== 원래 상단 버튼(숨겨져 있지만 안전망으로 동작 유지) =====
btnClose?.addEventListener("click", ()=>{
  pop.hidden = true; sub.hidden = true;
  selected.forEach(it=>{ it.el.classList.remove("selected"); it.el.querySelector(".ord")?.remove(); });
  selected = [];
});
btnEdit?.addEventListener("click",(e)=>{ e.stopPropagation(); editInput.value = selectedText() || ""; editDlg.showModal(); });
document.getElementById("editOk").addEventListener("click", ()=>{
  const t = editInput.value.trim(); if(!t){ editDlg.close(); return; }
  editDlg.close(); openMainPopover(currentAnchor, t);
});
