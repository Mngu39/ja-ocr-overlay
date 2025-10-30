// 안정 동작판 + 우측 분할/슬라이더/Anki 우선/사전 이동/줄바꿈 보존
import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma } from "./api.js";
import { placeMainPopover } from "./place.js";

const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");
const pop     = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");
const popDrag   = document.getElementById("popDrag");

// 우측 패널
const tokHeader = document.getElementById("tokHeader");
const tokLink   = document.getElementById("tokLink");
const tokTrans  = document.getElementById("tokTrans");
const kCarousel = document.getElementById("kanjiCarousel");
const kTrack    = document.getElementById("kTrack");
const knavL     = document.querySelector(".knav-left");
const knavR     = document.querySelector(".knav-right");
const explainV  = document.getElementById("explainView");
const expBack   = document.getElementById("expBack");
const expKanji  = document.getElementById("expKanji");
const expText   = document.getElementById("expText");

// 선택
let annos = [];
let selected = [];         // [{el,text}]
let currentAnchor = null;  // 항상 "첫번째"
let currentTokens = [];
let activeToken = null;
let kanjiList = [];
let kIndex = 0;

// ===== DB =====
let KANJI = {}, ANKI = {};
async function loadDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);
    KANJI = j1.status==="fulfilled" && j1.value ? j1.value : {};

    const map = {};
    if (j2.status==="fulfilled" && j2.value){
      const stack=[j2.value];
      while(stack.length){
        const n=stack.pop();
        if(Array.isArray(n?.children)) stack.push(...n.children);
        if(Array.isArray(n?.notes)){
          for(const note of n.notes){
            const f = note?.fields || [];
            const ch = (f[1] ?? "").toString().trim();
            const mean = (f[2] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            const explain = (f[3] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            if(ch && ch.length===1) map[ch] = { mean, explain };
          }
        }
      }
    }
    ANKI = map;
  }catch(e){ console.warn("DB load fail", e); }
}
const DB_READY = loadDBs();

// ===== 유틸 =====
const esc = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
const oneLine = s => (s||"").replace(/\r?\n+/g," · ").replace(/\s+/g," ").trim();

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// ===== Bootstrap =====
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
        if(!annos.length){ hint.textContent="문장을 찾지 못했습니다."; return; }
        hint.textContent="문장상자를 탭하세요";
        renderOverlay();
      }catch(e){ rollbackQuota(q.key); console.error(e); hint.textContent="OCR 오류"; }
    };
    imgEl.onerror = ()=>{ hint.textContent="이미지를 불러오지 못했습니다"; };
    imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`;  // 절대진리
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
    currentAnchor = selected[0].el; // 항상 첫번째
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

  const aw = anchor.getBoundingClientRect().width, overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.2), 540), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  // 좌 초기화
  rubyLine.innerHTML="…"; transLine.textContent="…";
  // 우 초기화
  showTokenHeader(false); showKanjiCarousel([]); hideExplain();

  try{
    const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);
    currentTokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || []).map(t=>({
      surface: t.surface || t.text || "",
      reading: kataToHira(t.reading || t.read || t.kana || ""),
      lemma:   t.lemma || t.base || t.baseform || t.dict || (t.surface||t.text||"")
    })).filter(t=>t.surface);

    rubyLine.innerHTML = currentTokens.map(t=>{
      const surf=esc(t.surface), read=esc(t.reading||"");
      const data = `data-surf="${surf}" data-lemma="${esc(t.lemma)}" data-read="${read}"`;
      if (hasKanji(t.surface) && t.reading){
        return `<span class="tok" ${data}><ruby>${surf}<rt>${read}</rt></ruby></span>`;
      }
      return `<span class="tok" ${data}>${surf}</span>`;
    }).join("");

    rubyLine.querySelectorAll(".tok").forEach(span=>{
      span.addEventListener("click",(ev)=>{
        ev.stopPropagation();
        const tok = { surface: span.dataset.surf||"", lemma: span.dataset.lemma||"", reading: span.dataset.read||"" };
        activeToken = tok;
        renderRightForToken(tok);
      });
    });

    const out = tr?.text || tr?.result || tr?.translation || "";
    transLine.textContent = out || "(번역 없음)";

    // 기본 토큰
    activeToken = currentTokens.find(t=>t.surface.trim()) || null;
    renderRightForToken(activeToken);

    requestAnimationFrame(()=>{ placeMainPopover(anchor, pop, 8); updateArrowEnablement(); ensureSideDock(); });
  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }
}

// ===== 우측 패널 =====
async function renderRightForToken(tok){
  if (!tok){ showTokenHeader(false); showKanjiCarousel([]); hideExplain(); return; }

  // 헤더(루비+lemma 한 줄) + 번역
  const read = tok.reading ? `<rt>${esc(tok.reading)}</rt>` : "";
  tokLink.innerHTML = hasKanji(tok.surface) && tok.reading
    ? `<ruby>${esc(tok.surface)}${read}</ruby> <span class="lemma">(${esc(tok.lemma)})</span>`
    : `${esc(tok.surface)} <span class="lemma">(${esc(tok.lemma)})</span>`;
  tokLink.href = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(tok.lemma||tok.surface)}`;
  tokTrans.textContent = "…";
  showTokenHeader(true);

  try{
    const r = await translateJaKo(tok.lemma || tok.surface);
    const t = r?.text || r?.result || r?.translation || "";
    tokTrans.textContent = t || "(번역 없음)";
  }catch{ tokTrans.textContent="(번역 실패)"; }

  await DB_READY;
  kanjiList = Array.from(new Set(Array.from(tok.surface).filter(ch=>hasKanji(ch))));
  kIndex = 0;
  showKanjiCarousel(kanjiList);
  hideExplain();
}

function showTokenHeader(show){
  tokHeader.style.display = show ? "flex" : "none";
  if(!show){ tokLink.removeAttribute("href"); tokLink.textContent="—"; tokTrans.textContent=""; }
}

function showKanjiCarousel(list){
  kTrack.innerHTML = "";
  if (!list || list.length===0){ kCarousel.hidden=true; return; }
  kCarousel.hidden=false;

  list.forEach(ch=>{
    const anki = ANKI?.[ch];
    const db   = KANJI?.[ch];
    const gloss = anki ? (anki.mean||"")
                       : db ? oneLine([db["음"], db["훈"]].filter(Boolean).join(" / ")) : "";

    const btn = document.createElement("button");
    btn.className = "kbtn" + (anki ? " anki" : "");
    btn.innerHTML = `${esc(ch)}${gloss?`<small>${esc(gloss)}</small>`:""}`;

    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      if (anki){
        // Anki에 있으면 설명 모드
        expKanji.textContent = ch;
        expText.innerHTML = esc(anki.explain||"").replace(/\r?\n/g,"<br>");
        explainV.hidden = false;
        tokHeader.style.display="none";
        kCarousel.hidden=true;
      }else{
        // Anki에 없고 일반DB에만 있든 없든 → 네이버 일본어사전
        openNaverJaLemma(ch);
      }
    });

    const card = document.createElement("div");
    card.className = "kcard";
    card.appendChild(btn);
    kTrack.appendChild(card);
  });

  updateKTrack();
}

knavL?.addEventListener("click",(e)=>{ e.stopPropagation(); if(kanjiList.length){ kIndex=(kIndex-1+kanjiList.length)%kanjiList.length; updateKTrack(); }});
knavR?.addEventListener("click",(e)=>{ e.stopPropagation(); if(kanjiList.length){ kIndex=(kIndex+1)%kanjiList.length; updateKTrack(); }});
function updateKTrack(){ kTrack.style.transform = `translateX(${-kIndex*100}%)`; }

function hideExplain(){
  explainV.hidden = true;
  if (kanjiList.length){ tokHeader.style.display="flex"; kCarousel.hidden=false; }
}
expBack?.addEventListener("click",(e)=>{ e.stopPropagation(); hideExplain(); });

// ===== 사이드 도킹 아이콘(✕ / ✎) =====
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
    b.textContent=label; b.className="btn";
    Object.assign(b.style,{ width:"36px", height:"36px", borderRadius:"18px", padding:"0" });
    b.addEventListener("click",(e)=>{ e.stopPropagation(); handler(); });
    return b;
  };
  dock.appendChild(mk("✕", ()=>{ pop.hidden=true; selected.forEach(it=>{ it.el.classList.remove("selected"); it.el.querySelector(".ord")?.remove(); }); selected=[]; }));
  dock.appendChild(mk("✎", ()=>{ const t=selectedText(); const dlg=document.getElementById("editDlg"); const input=document.getElementById("editInput"); input.value=t; dlg.showModal(); }));
  pop.appendChild(dock);
}
document.getElementById("editOk").addEventListener("click", ()=>{
  const dlg=document.getElementById("editDlg");
  const input=document.getElementById("editInput");
  const t=input.value.trim(); if(!t){ dlg.close(); return; }
  dlg.close(); openMainPopover(currentAnchor, t);
});

// ===== 방향바(점프: 첫번째 박스 기준) =====
const bars = Array.from(pop.querySelectorAll(".arrow-bar"));
bars.forEach(b=>{ b.addEventListener("click",(e)=>{ e.stopPropagation(); if (b.classList.contains("disabled")) return; jumpTo(b.dataset.dir); }); });

function jumpTo(dir){
  if(!currentAnchor) return;
  const a = currentAnchor.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  const m = 8;
  let left = r.left, top = r.top;
  if (dir==="top"){    left = a.left + (a.width - r.width)/2; top = a.top - r.height - m; }
  if (dir==="bottom"){ left = a.left + (a.width - r.width)/2; top = a.bottom + m; }
  if (dir==="left"){   left = a.left - r.width - m;           top = a.top + (a.height - r.height)/2; }
  if (dir==="right"){  left = a.right + m;                    top = a.top + (a.height - r.height)/2; }
  pop.style.left = (left + window.scrollX) + "px";
  pop.style.top  = (top  + window.scrollY) + "px";
  updateArrowEnablement();
}

function vb(){ return (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX }); }
function updateArrowEnablement(){
  const r = pop.getBoundingClientRect(), v = vb(), m = 8;
  const canTop    = (r.top - m)    >= v.offsetTop;
  const canBottom = (r.bottom + m) <= (v.offsetTop + v.height);
  const canLeft   = (r.left - m)   >= v.offsetLeft;
  const canRight  = (r.right + m)  <= (v.offsetLeft + v.width);
  pop.querySelector(".arrow-top")   .classList.toggle("disabled", !canTop);
  pop.querySelector(".arrow-bottom").classList.toggle("disabled", !canBottom);
  pop.querySelector(".arrow-left")  .classList.toggle("disabled", !canLeft);
  pop.querySelector(".arrow-right") .classList.toggle("disabled", !canRight);
}

// ===== 드래그 =====
makeDraggable(pop, popDrag);
function makeDraggable(panel, handle){
  if(!panel || !handle) return;
  let sx=0, sy=0, sl=0, st=0, dragging=false;
  handle.addEventListener("pointerdown",(e)=>{
    dragging=true; handle.setPointerCapture(e.pointerId);
    const r=panel.getBoundingClientRect(); sx=e.clientX; sy=e.clientY; sl=r.left+scrollX; st=r.top+scrollY;
  });
  handle.addEventListener("pointermove",(e)=>{
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    panel.style.left=(sl+dx)+"px"; panel.style.top=(st+dy)+"px";
    updateArrowEnablement();
  });
  handle.addEventListener("pointerup",()=>{ dragging=false; });
}

// ===== 리레이아웃 =====
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(!pop.hidden) updateArrowEnablement();
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});
