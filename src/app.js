import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");

const pop       = document.getElementById("pop");
const sub       = document.getElementById("sub");
const btnEdit   = document.getElementById("btnEdit");
const btnClose  = document.getElementById("btnClose");
const rubyLine  = document.getElementById("rubyLine");
const origLine  = document.getElementById("origLine");
const transLine = document.getElementById("transLine");
const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");

let annos = [];
let currentAnchor = null;
let currentTokenEl = null;
let userEditedSentence = "";       // 사용자가 직접 수정한 문장
let selected = [];                 // 클릭 순서대로 누적된 박스들

// 박스 테두리 살짝 좁히기(겹침 완화)
const BOX_INSET_X = 6;
const BOX_INSET_Y = 6;

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// 유틸
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji   = s => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));

(async function bootstrap(){
  try{
    const qs=new URLSearchParams(location.search); const id=qs.get("id");
    if(!id) throw new Error("?id= 필요");

    imgEl.onload = async ()=>{
      const q=tryConsumeQuota(); if(!q.ok){ hint.textContent="월간 무료 사용량 초과"; return; }
      try{
        hint.textContent="OCR(Google) 중…";
        annos = await gcvOCR(id);
        if(!annos.length){ hint.textContent="문장을 찾지 못했습니다."; return; }
        hint.textContent="문장을 탭하세요";
        renderOverlay();
      }catch(e){ rollbackQuota(q.key); hint.textContent="OCR 오류"; console.error(e); }
    };
    imgEl.src = await getImageById(id);
  }catch(e){ hint.textContent = e.message; }
})();

// ---------- Overlay & selection ----------
function renderOverlay(){
  const rect=imgEl.getBoundingClientRect();
  overlay.style.width=rect.width+"px"; overlay.style.height=rect.height+"px";
  const sx=rect.width/imgEl.naturalWidth, sy=rect.height/imgEl.naturalHeight;

  overlay.innerHTML="";
  selected = []; // 새 이미지/레이아웃 시 초기화

  for(const a of annos){
    const [p0,p1,p2,p3]=a.polygon;
    let l=Math.min(p0[0],p3[0])*sx, t=Math.min(p0[1],p1[1])*sy;
    let r=Math.max(p1[0],p2[0])*sx, b=Math.max(p2[1],p3[1])*sy;

    // ✅ 상자 살짝 줄이기(댓글/닉네임 등 붙는 현상 완화)
    l+=BOX_INSET_X; r-=BOX_INSET_X; t+=BOX_INSET_Y; b-=BOX_INSET_Y;
    if(r-l<6 || b-t<6) continue;

    const box=document.createElement("div");
    box.className="box";
    Object.assign(box.style,{ left:l+"px", top:t+"px", width:(r-l)+"px", height:(b-t)+"px" });
    box.dataset.text=a.text||"";

    box.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      toggleSelect(box);
      refreshCompose();
    });

    overlay.appendChild(box);
  }
}

function toggleSelect(box){
  const i=selected.indexOf(box);
  if(i>=0){
    selected.splice(i,1);
    box.classList.remove("sel");
    const badge=box.querySelector(".badge"); if(badge) badge.remove();
  }else{
    selected.push(box);
    box.classList.add("sel");
    ensureBadge(box).textContent = String(selected.length);
  }
  refreshBadges();
}

function ensureBadge(box){
  let b=box.querySelector(".badge");
  if(!b){ b=document.createElement("div"); b.className="badge"; box.appendChild(b); }
  return b;
}

function refreshBadges(){
  selected.forEach((b,idx)=>{ const badge=ensureBadge(b); badge.textContent=String(idx+1); });
}

function clearSelection(){
  selected.forEach(b=>{
    b.classList.remove("sel");
    const badge=b.querySelector(".badge"); if(badge) badge.remove();
  });
  selected=[];
}

// ---------- Popover open/close ----------
function closePopups(){
  pop.hidden = true;
  sub.hidden = true;
  clearSelection();
  currentAnchor = null;
  currentTokenEl = null;
  userEditedSentence = "";
}

btnClose.addEventListener("click", (e)=>{ e.stopPropagation(); closePopups(); });

// 배경 탭해서 닫히지 않도록 (요청사항)
 // stage.addEventListener("click", (e)=>{});

// ---------- Compose & open ----------
function refreshCompose(){
  if(selected.length===0){ closePopups(); return; }

  // 마지막 선택 상자를 기준으로 팝업 위치
  currentAnchor = selected[selected.length-1];

  // 연결 문장 만들기(선택 순서대로)
  const composed = selected.map(b=>b.dataset.text||"").join("");

  openMainPopover(currentAnchor, userEditedSentence || composed);
}

function openMainPopover(anchor, text){
  pop.hidden=false;

  // 팝업 폭을 앵커 폭 기준으로 보정
  const aw=anchor.getBoundingClientRect().width, overlayW=overlay.clientWidth;
  pop.style.width=Math.min(Math.max(Math.round(aw*1.1),420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  rubyLine.innerHTML="";
  origLine.textContent = text || "";
  transLine.textContent="…";

  // 루비 라인: 토큰별 span(.tok) + ruby/rt
  (async()=>{
    try{
      const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);

      const tokens = rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [];
      const frag = document.createDocumentFragment();

      tokens.forEach(t=>{
        const surf = t.surface || t.text || "";
        const base = t.base || t.lemma || t.dictionary || "";
        const read = kataToHira(t.reading || t.read || "");

        if(hasKanji(surf) && read){
          const ruby = document.createElement("ruby");
          const span = document.createElement("span");
          span.className="tok";
          span.textContent = surf;
          span.dataset.surface = surf;
          if(base) span.dataset.lemma = base;
          if(read) span.dataset.reading = read;
          span.addEventListener("click",(ev)=>{ ev.stopPropagation(); openSubForToken(span); });

          const rt = document.createElement("rt"); rt.textContent = read;
          ruby.appendChild(span); ruby.appendChild(rt);
          frag.appendChild(ruby);
        }else{
          const span=document.createElement("span");
          span.className="tok";
          span.textContent = surf || (t.space || "");
          span.dataset.surface = surf;
          if(base) span.dataset.lemma = base;
          span.addEventListener("click",(ev)=>{ ev.stopPropagation(); openSubForToken(span); });
          frag.appendChild(span);
        }
      });

      rubyLine.appendChild(frag);

      // 번역
      const translated = tr?.text || tr?.result || tr?.translation || "";
      transLine.textContent = translated || "(번역 없음)";

      requestAnimationFrame(()=> placeMainPopover(anchor, pop, 8));
    }catch(e){
      transLine.textContent="(번역 실패)";
      console.error(e);
    }
  })();
}

// ---------- 수정 다이얼로그 ----------
btnEdit.addEventListener("click",(e)=>{
  e.stopPropagation();
  const composed = selected.map(b=>b.dataset.text||"").join("");
  editInput.value = userEditedSentence || composed || "";
  editDlg.showModal();
});
document.getElementById("editOk").addEventListener("click", ()=>{
  const t=editInput.value.trim();
  userEditedSentence = t;
  editDlg.close();
  if(selected.length>0) openMainPopover(currentAnchor, userEditedSentence);
});

// ---------- Sub popup (morpheme) ----------
function openSubForToken(tokEl){
  currentTokenEl=tokEl;
  const surf = tokEl.dataset.surface || tokEl.textContent || "";
  const lemma= tokEl.dataset.lemma   || "";
  const read = tokEl.dataset.reading || "";

  sub.hidden=false;
  sub.innerHTML = `
    <div class="sub-wrap">
      <div class="sub-row">
        <ruby><b class="sub-h">${escapeHtml(surf)}</b>${read?`<rt>${escapeHtml(read)}</rt>`:''}</ruby>
        ${lemma ? ` <span class="sub-lemma">(${escapeHtml(lemma)})</span>` : ""}
      </div>
      <div class="sub-row" id="tokTrans">…</div>
      <div class="sub-actions">
        <a href="javascript:void(0)" id="openLemma">네이버 사전</a>
        ${surf.length===1 && hasKanji(surf) ? `<span> · </span><a href="javascript:void(0)" id="openHanja">네이버 한자</a>` : ""}
      </div>
    </div>`;

  // 위치
  placeSubDetached(pop, tokEl, sub, 8);

  // 번역(형태소 단위)
  translateJaKo(surf).then(res=>{
    const out = res?.text || res?.result || res?.translation || "";
    const el = document.getElementById("tokTrans");
    if(el) el.textContent = out || "(번역 없음)";
  }).catch(()=>{ const el=document.getElementById("tokTrans"); if(el) el.textContent="(번역 실패)"; });

  // 링크
  const a1=document.getElementById("openLemma"); if(a1) a1.onclick=()=> openNaverJaLemma(lemma || surf);
  const a2=document.getElementById("openHanja"); if(a2) a2.onclick=()=> openNaverHanja(surf);
}

// ---------- Relayout ----------
function resizeRelayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 8);
}
window.addEventListener("resize", resizeRelayout,{passive:true});
globalThis.visualViewport?.addEventListener("resize", resizeRelayout,{passive:true});
window.addEventListener("scroll", resizeRelayout,{passive:true});
