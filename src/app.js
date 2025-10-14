import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");
const pop     = document.getElementById("pop");
const sub     = document.getElementById("sub");
const btnEdit = document.getElementById("btnEdit");
const rubyLine= document.getElementById("rubyLine");
const origLine= document.getElementById("origLine");
const transLine=document.getElementById("transLine");
const editDlg = document.getElementById("editDlg");
const editInput=document.getElementById("editInput");

let annos=[], currentSentence="", currentAnchor=null, currentTokenEl=null;

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
        hint.textContent="문장을 탭하세요"; renderOverlay();
      }catch(e){ rollbackQuota(q.key); hint.textContent="OCR 오류"; console.error(e); }
    };
    imgEl.src = await getImageById(id);
  }catch(e){ hint.textContent = e.message; }
})();

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
    box.className="box"; Object.assign(box.style,{ left:l+"px", top:t+"px", width:(r-l)+"px", height:(b-t)+"px" });
    box.dataset.text=a.text||"";
    box.addEventListener("click", (ev)=>{ ev.stopPropagation(); onSelectBox(box); });
    overlay.appendChild(box);
  }
}
function onSelectBox(box){
  overlay.querySelectorAll(".box").forEach(b=>b.classList.remove("active"));
  box.classList.add("active"); currentSentence=box.dataset.text||""; currentAnchor=box;
  openMainPopover(currentAnchor, currentSentence);
}

// 리사이즈/스크롤 대응
function resizeRelayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 8);
}
window.addEventListener("resize", resizeRelayout,{passive:true});
globalThis.visualViewport?.addEventListener("resize", resizeRelayout,{passive:true});
window.addEventListener("scroll", resizeRelayout,{passive:true});

// 바깥 클릭 시 닫기
document.getElementById("stage").addEventListener("click",(e)=>{
  if(!pop.hidden && !pop.contains(e.target)){ pop.hidden=true; sub.hidden=true; overlay.querySelectorAll(".box").forEach(b=>b.classList.remove("active")); }
});

function openMainPopover(anchor, text){
  pop.hidden=false;
  const aw=anchor.getBoundingClientRect().width, overlayW=overlay.clientWidth;
  pop.style.width=Math.min(Math.max(Math.round(aw*1.1),420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  rubyLine.innerHTML=""; origLine.innerHTML=""; transLine.textContent="…";

  text.split(/(\s+)/).forEach(tok=>{
    if(tok==='') return;
    if(/^\s+$/.test(tok)){ origLine.appendChild(document.createTextNode(tok)); return; }
    const span=document.createElement("span");
    span.className="tok"; span.textContent=tok;
    span.addEventListener("click",(ev)=>{ ev.stopPropagation(); openSubForToken(span, tok); });
    origLine.appendChild(span);
  });

  (async()=>{
    try{
      const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);
      const tokens = rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [];
      rubyLine.innerHTML = tokens.map(t=>{
        const surf = t.surface || t.text || "";
        const read = kataToHira(t.reading || t.read || "");
        if(hasKanji(surf) && read) return `<ruby>${escapeHtml(surf)}<rt>${escapeHtml(read)}</rt></ruby>`;
        return escapeHtml(surf);
      }).join("");

      const translated = tr?.text || tr?.result || tr?.translation || "";
      transLine.textContent = translated || "(번역 없음)";
      requestAnimationFrame(()=> placeMainPopover(anchor, pop, 8));
    }catch(e){
      transLine.textContent="(번역 실패)";
      console.error(e);
    }
  })();
}

// 수정
btnEdit.addEventListener("click",(e)=>{
  e.stopPropagation(); editInput.value=currentSentence||""; editDlg.showModal();
});
document.getElementById("editOk").addEventListener("click", ()=>{
  const t=editInput.value.trim(); if(!t){ editDlg.close(); return; }
  currentSentence=t; editDlg.close(); openMainPopover(currentAnchor, currentSentence);
});

// 서브팝업
function openSubForToken(tokEl, token){
  currentTokenEl=tokEl;
  sub.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <strong style="font-size:16px">${escapeHtml(token)}</strong>
      <div style="display:flex;gap:10px">
        ${token.length===1
          ? `<a href="javascript:void(0)" id="openHanja">네이버 한자</a>`
          : `<a href="javascript:void(0)" id="openLemma">네이버 사전</a>`}
      </div>
    </div>`;
  sub.hidden=false; placeSubDetached(pop, tokEl, sub, 8);
  const a1=document.getElementById("openLemma"); const a2=document.getElementById("openHanja");
  if(a1) a1.onclick=()=> openNaverJaLemma(token);
  if(a2) a2.onclick=()=> openNaverHanja(token);
}
