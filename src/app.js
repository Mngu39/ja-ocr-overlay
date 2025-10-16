import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");
const pop     = document.getElementById("pop");
const sub     = document.getElementById("sub");
const btnEdit = document.getElementById("btnEdit");
const btnClose= document.getElementById("btnClose");
const rubyLine= document.getElementById("rubyLine");
const transLine=document.getElementById("transLine");
const editDlg = document.getElementById("editDlg");
const editInput=document.getElementById("editInput");
const popDrag = document.getElementById("popDrag");
const subDrag = document.getElementById("subDrag");

let annos=[];
let currentAnchor=null;
let selectedBoxes=[];   // [{el, text}]
let currentTokenEl=null;

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// 유틸
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji   = s => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));

// --- 외부 DB 로드(초기 한 번) ---
let KANJI_DB=null, ANKI_DB=null; // {kanji:{음,훈}}, {kanji:{mean, explain}}
(async ()=>{
  try{
    const [a,b] = await Promise.all([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.json()),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.json()).catch(()=>null)
    ]);
    KANJI_DB = a||{};
    if(b){
      // CrowdAnki → { '人': {mean:'사람 인', explain:'...' }, ... }
      const map={};
      const stacks=[b];
      while(stacks.length){
        const node=stacks.pop();
        if(Array.isArray(node?.children)) stacks.push(...node.children);
        if(Array.isArray(node?.notes)){
          for(const n of node.notes){
            const f=n?.fields||[];
            if(!f[1]) continue;
            const kanji=String(f[1]).trim();
            const mean =String(f[2]||"").replace(/<[^>]+>/g,"").trim();
            const expl =String(f[3]||"").replace(/<[^>]+>/g,"").trim();
            if(kanji.length===1) map[kanji]={ mean, explain: expl };
          }
        }
      }
      ANKI_DB = map;
    }else{
      ANKI_DB = {};
    }
  }catch(e){ console.warn("DB load failed", e); KANJI_DB={}; ANKI_DB={}; }
})();

// ---------------- Bootstrap ----------------
(async function bootstrap(){
  try{
    const qs=new URLSearchParams(location.search); const id=qs.get("id");
    if(!id) throw new Error("?id= 필요");

    imgEl.onload = async ()=>{
      const q=tryConsumeQuota(); if(!q.ok){ hint.textContent="월간 무료 사용량 초과"; return; }
      try{
        hint.textContent="OCR(Google) 중…";
        const res = await gcvOCR(id);
        // res는 [{text, polygon:[[x,y]x4]}, ...]
        annos = res;
        if(!annos.length){ hint.textContent="문장을 찾지 못했습니다."; return; }
        hint.textContent="문장상자를 탭하세요";
        renderOverlay();
      }catch(e){ rollbackQuota(q.key); hint.textContent="OCR 오류"; console.error(e); }
    };
    imgEl.src = await getImageById(id);
  }catch(e){ hint.textContent = e.message; }
})();

// ---------------- Overlay ----------------
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
    box.addEventListener("click", (ev)=>{ ev.stopPropagation(); onToggleBox(box); });
    overlay.appendChild(box);
  }
  // 기존 선택 유지 재번호
  renumberSelected();
}

function onToggleBox(box){
  const idx = selectedBoxes.findIndex(x=>x.el===box);
  if(idx>=0){
    // 선택 해제
    selectedBoxes.splice(idx,1);
    box.classList.remove("selected");
    const tag=box.querySelector(".ord"); if(tag) tag.remove();
  }else{
    // 선택 추가
    selectedBoxes.push({ el:box, text:box.dataset.text||"" });
    box.classList.add("selected");
    const tag=document.createElement("span"); tag.className="ord"; tag.textContent=selectedBoxes.length; box.appendChild(tag);
  }
  renumberSelected();
  if(selectedBoxes.length){
    currentAnchor = selectedBoxes[selectedBoxes.length-1].el;
    openMainPopoverFromSelection();
  }else{
    pop.hidden=true; sub.hidden=true;
  }
}

function renumberSelected(){
  selectedBoxes.forEach((it,i)=>{
    const tag=it.el.querySelector(".ord"); if(tag) tag.textContent = i+1;
  });
}

// ---------------- Main Popover ----------------
function openMainPopoverFromSelection(){
  const text = selectedBoxes.map(x=>x.text).join("");
  openMainPopover(currentAnchor, text);
}

function openMainPopover(anchor, text){
  pop.hidden=false;
  // 자동 너비: 선택 영역 마지막 박스 기준
  const aw=anchor.getBoundingClientRect().width, overlayW=overlay.clientWidth;
  pop.style.width=Math.min(Math.max(Math.round(aw*1.1),420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  // 원문 한 줄만(=rubyLine만) 표시
  rubyLine.innerHTML=""; transLine.textContent="…";

  // 형태소 클릭 가능: rubi 도착 전에는 임시로 원본 토큰만 보여줌
  renderTokensInto(rubyLine, text, null);

  // 실제 요청
  (async()=>{
    try{
      const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);
      const tokens = normalizeTokens(rubi);
      renderTokensInto(rubyLine, text, tokens);
      const translated = tr?.text || tr?.result || tr?.translation || "";
      transLine.textContent = translated || "(번역 없음)";
      requestAnimationFrame(()=> placeMainPopover(anchor, pop, 8));
    }catch(e){
      transLine.textContent="(번역 실패)";
      console.error(e);
    }
  })();
}

// 토큰 표준화
function normalizeTokens(rubi){
  const list = rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [];
  return list.map(t=>{
    return {
      surface: t.surface || t.text || "",
      reading: kataToHira(t.reading || t.read || t.kana || ""),
      lemma:   t.lemma || t.base || t.baseform || t.dict || "",
      pos:     t.pos || t.part || t.tag || ""
    };
  });
}

// ruby 렌더링 + 클릭 핸들러
function renderTokensInto(container, text, tokens){
  container.innerHTML="";
  if(tokens && tokens.length){
    for(const t of tokens){
      const surf = t.surface||"";
      const read = t.reading||"";
      const span=document.createElement("span");
      span.className="tok";
      span.innerHTML = hasKanji(surf)&&read
        ? `<ruby>${escapeHtml(surf)}<rt>${escapeHtml(read)}</rt></ruby>`
        : escapeHtml(surf);
      span.addEventListener("click",(ev)=>{ ev.stopPropagation(); openSubForToken(span, t); });
      container.appendChild(span);
    }
  }else{
    // 토큰정보 없음 → 통문자 클릭 제공
    text.split(/(\s+)/).forEach(tok=>{
      if(tok==='') return;
      const span=document.createElement("span");
      span.className="tok"; span.textContent=tok;
      span.addEventListener("click",(ev)=>{ ev.stopPropagation(); openSubForToken(span, {surface:tok, reading:"", lemma:""}); });
      container.appendChild(span);
    });
  }
}

// 닫기/수정/드래그
btnClose.addEventListener("click", ()=>{
  pop.hidden=true; sub.hidden=true;
  selectedBoxes.forEach(it=>{ it.el.classList.remove("selected"); const t=it.el.querySelector(".ord"); if(t) t.remove(); });
  selectedBoxes=[];
});
btnEdit.addEventListener("click",(e)=>{ e.stopPropagation(); editInput.value=selectedBoxes.map(x=>x.text).join("")||""; editDlg.showModal(); });
document.getElementById("editOk").addEventListener("click", ()=>{
  const t=editInput.value.trim(); if(!t){ editDlg.close(); return; }
  editDlg.close(); openMainPopover(currentAnchor, t);
});

// 드래그(메인/서브)
makeDraggable(pop, popDrag);
makeDraggable(sub, subDrag);
function makeDraggable(panel, handle){
  let sx=0, sy=0, sl=0, st=0, dragging=false;
  handle.addEventListener("pointerdown",(e)=>{
    dragging=true; handle.setPointerCapture(e.pointerId);
    const r=panel.getBoundingClientRect(); sx=e.clientX; sy=e.clientY; sl=r.left+scrollX; st=r.top+scrollY;
  });
  handle.addEventListener("pointermove",(e)=>{
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    Object.assign(panel.style,{ left:(sl+dx)+"px", top:(st+dy)+"px" });
  });
  handle.addEventListener("pointerup",()=>{ dragging=false; });
}

// 바깥 클릭 → 서브팝업만 닫기
document.addEventListener("click",(e)=>{
  if(!sub.hidden && !sub.contains(e.target)){ sub.hidden=true; }
}, {capture:true});

// ---------------- Sub Popup ----------------
async function openSubForToken(tokEl, tok){
  currentTokenEl=tokEl;
  const surface = tok.surface || "";
  const reading = kataToHira(tok.reading || "");
  const lemma   = tok.lemma || surface;

  // 헤더(하이퍼링크 + lemma)
  const titleHTML = `<span class="sub-title"><a href="javascript:void(0)" id="subHeadLink">
      ${hasKanji(surface)&&reading ? `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>` : escapeHtml(surface)}
    </a></span><span class="sub-lemma">(${escapeHtml(lemma)})</span>`;
  sub.querySelector(".sub-head").innerHTML = titleHTML;

  // 본문
  const body = document.getElementById("subBody");
  body.innerHTML = `<div class="sub-row" id="subTrans">…</div>
    <div class="sub-row"><div class="kwrap" id="kwrap"></div></div>`;

  // 네이버 링크
  const link = document.getElementById("subHeadLink");
  link.onclick = ()=> openNaverJaLemma(lemma || surface);

  // 번역(토큰 단위)
  try{
    const r = await translateJaKo(surface);
    const txt = r?.text || r?.result || r?.translation || "";
    document.getElementById("subTrans").textContent = txt || "(번역 없음)";
  }catch{ document.getElementById("subTrans").textContent="(번역 실패)"; }

  // 한자 박스(가로 나열)
  const kwrap = document.getElementById("kwrap");
  const uniqKanji = Array.from(new Set(Array.from(surface).filter(ch=>hasKanji(ch))));
  for(const k of uniqKanji){
    const anki = ANKI_DB?.[k];
    const db   = KANJI_DB?.[k];
    const div  = document.createElement("div");
    div.className = "k " + (anki ? "anki" : "db");
    const sub = anki ? (anki.mean||"") : (db ? `${db.음||""}` : "");
    div.innerHTML = `${escapeHtml(k)}${sub?`<small>${escapeHtml(sub)}</small>`:""}`;
    div.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if(anki){
        // 하단에 설명 토글
        let ex = body.querySelector(".k-explain");
        if(!ex){ ex=document.createElement("div"); ex.className="sub-row k-explain"; body.appendChild(ex); }
        ex.textContent = anki.explain || "(설명 없음)";
      }else{
        openNaverHanja(k);
      }
    });
    kwrap.appendChild(div);
  }

  // 크기/위치
  sub.hidden=false;
  placeSubDetached(pop, tokEl, sub, 8);
}

// ---------------- Relayout ----------------
function resizeRelayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 8);
}
window.addEventListener("resize", resizeRelayout,{passive:true});
globalThis.visualViewport?.addEventListener("resize", resizeRelayout,{passive:true});
window.addEventListener("scroll", resizeRelayout,{passive:true});
