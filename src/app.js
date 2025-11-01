// 통합 팝업 버전. "이미지 로딩 루틴"은 절대 수정하지 않음.
import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma } from "./api.js";
import { placeMainPopover } from "./place.js";

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");
const popDrag   = document.getElementById("popDrag");

const tokHeader = document.getElementById("tokHeader");
const kcarousel = document.getElementById("kcarousel");
const kviewport = document.getElementById("kviewport");
const ktrack    = document.getElementById("ktrack");
const kprev     = document.getElementById("kprev");
const knext     = document.getElementById("knext");
const kExplain  = document.getElementById("kExplain");

// 선택 상태
let annos = [];
let selected = [];        // [{el,text}]
let currentAnchor = null; // 항상 "첫 번째" 박스
let currentToken = null;

// ===== Kanji DBs =====
let KANJI = null;  // 일반 DB: { '漢': { '음': '...', '훈': '...', ... }, ... }
let ANKI  = null;  // Anki DB:  { '漢': { mean:'...', explain:'...' }, ... }

async function loadDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("../public/kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("../public/일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);
    KANJI = j1.status==="fulfilled" ? (j1.value||{}) : {};

    if (j2.status==="fulfilled" && j2.value){
      const map = {};
      const stack = [j2.value];
      while (stack.length){
        const node = stack.pop();
        if (Array.isArray(node?.children)) stack.push(...node.children);
        if (Array.isArray(node?.notes)){
          for (const n of node.notes){
            const f = n.fields || [];
            const ch = (f[1] ?? "").toString().trim();
            const mean = (f[2] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            const explain = (f[3] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            if (ch && ch.length===1) map[ch] = { mean, explain };
          }
        }
      }
      ANKI = map;
    }else{
      ANKI = {};
    }
  }catch{
    KANJI = {}; ANKI = {};
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
// ★★★ 절대 수정 금지: 이미지 로딩 루틴
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

    imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`; // 캐시 버스터
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
    currentAnchor = selected[0].el; // 첫 박스 고정
    openMainFromSelection();
  }else{
    pop.hidden=true;
  }
}
function renumber(){ selected.forEach((it,i)=> it.el.querySelector(".ord")?.textContent = i+1); }
function selectedText(){ return selected.map(x=>x.text).join(""); }

// ===== Main Popover =====
function openMainFromSelection(){ openMainPopover(currentAnchor, selectedText()); }

async function openMainPopover(anchor, text){
  pop.hidden=false;

  // 폭: 앵커 대비
  const aw = anchor.getBoundingClientRect().width, overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.1), 560), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  rubyLine.innerHTML="…"; transLine.textContent="…";
  // 우측 패널 초기화(플레이스홀더)
  currentToken = null;
  renderRightPanelPlaceholder();

  try{
    const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);

    // 토큰 표준화
    const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || []).map(t=>({
      surface: t.surface || t.text || "",
      reading: kataToHira(t.reading || t.read || t.kana || ""),
      lemma:   t.lemma || t.base || t.baseform || t.dict || (t.surface||t.text||"")
    })).filter(t=>t.surface);

    // 루비 렌더 + 클릭(우측 패널 채움)
    rubyLine.innerHTML = tokens.map(t=>{
      const surf=escapeHtml(t.surface), read=escapeHtml(t.reading||"");
      const data = `data-surf="${surf}" data-lemma="${escapeHtml(t.lemma||t.surface)}" data-read="${read}"`;
      return (hasKanji(t.surface) && t.reading)
        ? `<span class="tok" ${data}><ruby>${surf}<rt>${read}</rt></ruby></span>`
        : `<span class="tok" ${data}>${surf}</span>`;
    }).join("");

    rubyLine.querySelectorAll(".tok").forEach(span=>{
      span.addEventListener("click",(ev)=>{
        ev.stopPropagation();
        const tok = {
          surface: span.dataset.surf || "",
          lemma:   span.dataset.lemma || span.dataset.surf || "",
          reading: span.dataset.read || ""
        };
        currentToken = tok;
        renderRightPanelForToken(tok);
      });
    });

    const out = tr?.text || tr?.result || tr?.translation || "";
    transLine.textContent = out || "(번역 없음)";
    requestAnimationFrame(()=> updateArrowEnablement());
  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }

  ensureSideDock(); // ✕/✎ 도킹
}

/* ===== 우측 패널 ===== */
function renderRightPanelPlaceholder(){
  tokHeader.innerHTML = `<span class="ph">형태소를 탭하면 상세가 여기에 표시됩니다</span>`;
  ktrack.innerHTML = "";
  kExplain.hidden = true;
  setCarouselIndex(0, true);
}

async function renderRightPanelForToken(tok){
  // 헤더 한 줄: (루비 링크) (lemma) (번역)
  const url = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(tok.lemma||tok.surface)}`;
  const rubyHTML = (hasKanji(tok.surface) && tok.reading)
    ? `<ruby>${escapeHtml(tok.surface)}<rt style="font-size:11px">${escapeHtml(tok.reading)}</rt></ruby>`
    : escapeHtml(tok.surface);

  tokHeader.innerHTML =
    `<a href="${url}" target="_blank">${rubyHTML}</a>
     <span class="lemma">(${escapeHtml(tok.lemma||tok.surface)})</span>
     <span class="inline-tr" id="inlineTokTr">…</span>`;

  // 단어 번역(헤더 옆)
  try{
    const r = await translateJaKo(tok.lemma||tok.surface);
    const txt = r?.text || r?.result || r?.translation || "";
    document.getElementById("inlineTokTr").textContent = txt || "";
  }catch{
    document.getElementById("inlineTokTr").textContent = "";
  }

  // 한자 슬라이더
  await DB_READY;
  ktrack.innerHTML = "";
  kExplain.hidden = true; kExplain.textContent = "";

  const uniq = Array.from(new Set(Array.from(tok.surface).filter(ch=>hasKanji(ch))));
  const items = [];

  for (const ch of uniq){
    const anki = ANKI?.[ch];
    const db   = KANJI?.[ch];

    // 레이블: 한 줄 표기(글자 + mean/gloss)
    const gloss = anki ? (anki.mean||"") : (db ? [db["음"], db["훈"]].filter(Boolean).join(" / ") : "");
    const div = document.createElement("div");
    div.className = "kitem " + (anki ? "anki" : "db");
    div.innerHTML = `<span class="char">${escapeHtml(ch)}</span>${gloss?`<span class="gloss">${escapeHtml(gloss)}</span>`:""}`;

    // 클릭 동작:
    // - Anki 있으면: 설명 영역에 explain 표시(스크롤 가능, pre-line)
    // - Anki 없고 KANJI만 있거나(=db), 또는 둘 다 없으면: 네이버 일본어사전으로 이동
    div.addEventListener("click", ()=>{
      if (anki){
        kExplain.hidden = false;
        kExplain.textContent = anki.explain || "(설명 없음)";
      }else{
        openNaverJaLemma(ch);
      }
    });

    ktrack.appendChild(div);
    items.push(div);
  }

  // 슬라이더 구성(한 번에 1개씩 보이도록)
  setCarouselIndex(0, true);
  if (items.length <= 1){
    kprev.disabled = true; knext.disabled = true;
  }else{
    kprev.disabled = false; knext.disabled = false;
  }
}

/* ===== 카루셀 ===== */
let kIndex = 0;
function setCarouselIndex(idx, first=false){
  const total = ktrack.children.length;
  kIndex = Math.max(0, Math.min(idx, Math.max(0,total-1)));
  const item = ktrack.children[kIndex];
  if (!item){ ktrack.style.transform = "translateX(0)"; return; }

  // 아이템 폭에 맞춰 한 개만 보이도록 중앙 정렬
  const vw = kviewport.clientWidth;
  const iw = Math.min(item.getBoundingClientRect().width, vw);
  // 모든 item을 같은 폭으로 보이게 강제
  Array.from(ktrack.children).forEach(el=> el.style.minWidth = iw+"px");
  // 트랙 이동
  const offset = Array.from(ktrack.children)
    .slice(0, kIndex)
    .reduce((acc,el)=> acc + el.getBoundingClientRect().width + 8 /*gap*/, 0);
  ktrack.style.transform = `translateX(${-offset}px)`;

  kprev.disabled = (kIndex===0);
  knext.disabled = (kIndex>=total-1);
}
kprev.addEventListener("click", ()=> setCarouselIndex(kIndex-1));
knext.addEventListener("click", ()=> setCarouselIndex(kIndex+1));

/* ===== 방향바: 즉시 점프(첫 앵커 기준 상/하/좌/우) ===== */
Array.from(pop.querySelectorAll(".arrow-bar")).forEach(b=>{
  b.addEventListener("click",(e)=>{
    e.stopPropagation();
    if (b.classList.contains("disabled")) return;
    jumpTo(b.dataset.dir);
  });
});

function vb(){ return (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX }); }

function jumpTo(side){
  if(!currentAnchor) return;
  const a = currentAnchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const gap = 8;
  let x = p.left, y = p.top;

  if (side==="top"){
    x = a.left + (a.width - p.width)/2;
    y = a.top - p.height - gap;
  } else if (side==="bottom"){
    x = a.left + (a.width - p.width)/2;
    y = a.bottom + gap;
  } else if (side==="left"){
    x = a.left - p.width - gap;
    y = a.top + (a.height - p.height)/2;
  } else if (side==="right"){
    x = a.right + gap;
    y = a.top + (a.height - p.height)/2;
  }

  const v = vb();
  const minX = v.offsetLeft + 4, maxX = v.offsetLeft + v.width - p.width - 4;
  const minY = v.offsetTop + 4,  maxY = v.offsetTop + v.height - p.height - 4;
  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));

  pop.style.left = (x + window.scrollX) + "px";
  pop.style.top  = (y + window.scrollY) + "px";

  updateArrowEnablement();
}

function willFit(side){
  if(!currentAnchor) return false;
  const a = currentAnchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const v = vb(); const gap=8;

  let x=0,y=0;
  if (side==="top"){    x=a.left+(a.width-p.width)/2; y=a.top-p.height-gap; }
  if (side==="bottom"){ x=a.left+(a.width-p.width)/2; y=a.bottom+gap; }
  if (side==="left"){   x=a.left-p.width-gap;         y=a.top+(a.height-p.height)/2; }
  if (side==="right"){  x=a.right+gap;                y=a.top+(a.height-p.height)/2; }

  return (x >= v.offsetLeft) &&
         (y >= v.offsetTop) &&
         (x + p.width  <= v.offsetLeft + v.width) &&
         (y + p.height <= v.offsetTop  + v.height);
}

function updateArrowEnablement(){
  pop.querySelector(".arrow-top")   .classList.toggle("disabled", !willFit("top"));
  pop.querySelector(".arrow-bottom").classList.toggle("disabled", !willFit("bottom"));
  pop.querySelector(".arrow-left")  .classList.toggle("disabled", !willFit("left"));
  pop.querySelector(".arrow-right") .classList.toggle("disabled", !willFit("right"));
}

/* ===== 도킹 버튼(✎/✕) ===== */
function ensureSideDock(){
  if (pop.querySelector(".dock")) return;
  const dock = document.createElement("div");
  dock.className="dock";
  Object.assign(dock.style,{
    position:"absolute", right:"-44px", top:"8px", width:"36px",
    display:"flex", flexDirection:"column", gap:"10px", zIndex:"3"
  });
  const mk = (label, handler)=> {
    const b=document.createElement("button");
    b.textContent=label;
    Object.assign(b.style,{
      width:"36px", height:"36px", borderRadius:"18px",
      background:"#4da3ff", color:"#021323", fontWeight:"700",
      border:"none", cursor:"pointer"
    });
    b.addEventListener("click",(e)=>{ e.stopPropagation(); handler(); });
    return b;
  };
  // ✕ 닫기
  dock.appendChild(mk("✕", ()=>{
    pop.hidden = true;
    selected.forEach(it=>{ it.el.classList.remove("selected"); it.el.querySelector(".ord")?.remove(); });
    selected = [];
  }));
  // ✎ 수정
  dock.appendChild(mk("✎", ()=>{
    const editDlg = document.getElementById("editDlg");
    const editInput = document.getElementById("editInput");
    editInput.value = selectedText() || "";
    editDlg.showModal();
  }));
  pop.appendChild(dock);

  // 저장 버튼 훅
  document.getElementById("editOk").onclick = ()=>{
    const editDlg = document.getElementById("editDlg");
    const editInput = document.getElementById("editInput");
    const t = (editInput.value||"").trim();
    editDlg.close();
    if(t) openMainPopover(currentAnchor, t);
  };
}

/* ===== 리레이아웃 ===== */
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) { placeMainPopover(currentAnchor, pop, 8); updateArrowEnablement(); }
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});
