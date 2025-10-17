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

// 멀티 선택 (예전 구조에 최소 추가)
let selectedBoxes=[]; // [{el, text}]
function renumberSelected(){
  selectedBoxes.forEach((it,i)=>{
    let badge = it.el.querySelector(".ord");
    if(!badge){
      badge = document.createElement("span");
      badge.className="ord";
      Object.assign(badge.style,{
        position:"absolute", right:"6px", top:"6px",
        minWidth:"20px", height:"20px", padding:"0 6px",
        borderRadius:"999px", background:"#1b1f2a", color:"#cfe2ff",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:"12px", fontWeight:"700"
      });
      it.el.appendChild(badge);
    }
    badge.textContent = i+1;
  });
}
function clearSelection(){
  selectedBoxes.forEach(it=>{
    it.el.classList.remove("active"); it.el.style.background="transparent";
    const bd=it.el.querySelector(".ord"); if(bd) bd.remove();
  });
  selectedBoxes=[];
}

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// 유틸
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji   = s => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));

// ▼ 이미지 로딩 흐름 = 예전 그대로 (onerror만 추가)
(async function bootstrap(){
  try{
    // 중복 원문 숨김(레이아웃 변경 최소화)
    origLine.style.display="none";

    const qs=new URLSearchParams(location.search); const id=qs.get("id");
    if(!id) throw new Error("?id= 필요");

    imgEl.onload = async ()=>{
      const q=tryConsumeQuota(); if(!q.ok){ hint.textContent="월간 무료 사용량 초과"; return; }
      try{
        hint.textContent="OCR(Google) 중…";
        annos = await gcvOCR(id);
        if(!annos.length){ hint.textContent="문장을 찾지 못했습니다."; return; }
        hint.textContent="문장상자를 탭하세요"; renderOverlay();
      }catch(e){ rollbackQuota(q.key); hint.textContent="OCR 오류"; console.error(e); }
    };
    imgEl.onerror = ()=>{ hint.textContent="이미지 로드 실패"; /* 캐시 회피 재시도 */ setTimeout(async()=>{ imgEl.src=(await getImageById(id))+"&t="+Date.now(); }, 150); };
    imgEl.src = await getImageById(id);
  }catch(e){ hint.textContent = e.message; }
})();

// ▼ 예전 렌더 그대로 (클릭만 토글식으로 변경)
function renderOverlay(){
  const rect=imgEl.getBoundingClientRect();
  overlay.style.width=rect.width+"px"; overlay.style.height=rect.height+"px";
  const sx=rect.width/imgEl.naturalWidth, sy=rect.height/imgEl.naturalHeight;

  overlay.innerHTML=""; clearSelection();
  for(const a of annos){
    const [p0,p1,p2,p3]=a.polygon;
    const l=Math.min(p0[0],p3[0])*sx, t=Math.min(p0[1],p1[1])*sy;
    const r=Math.max(p1[0],p2[0])*sx, b=Math.max(p2[1],p3[1])*sy;
    const box=document.createElement("div");
    box.className="box"; Object.assign(box.style,{ left:l+"px", top:t+"px", width:(r-l)+"px", height:(b-t)+"px" });
    box.dataset.text=a.text||"";
    box.addEventListener("click", (ev)=>{ ev.stopPropagation(); onToggleBox(box); });
    overlay.appendChild(box);
  }
}
function onToggleBox(box){
  const i = selectedBoxes.findIndex(x=>x.el===box);
  if(i>=0){
    box.classList.remove("active"); box.style.background="transparent";
    const bd=box.querySelector(".ord"); if(bd) bd.remove();
    selectedBoxes.splice(i,1);
  }else{
    selectedBoxes.push({ el:box, text:box.dataset.text||"" });
    box.classList.add("active"); box.style.background="rgba(80,200,255,.12)";
  }
  renumberSelected();

  if(selectedBoxes.length){
    currentAnchor = selectedBoxes[selectedBoxes.length-1].el;
    currentSentence = selectedBoxes.map(x=>x.text).join("");
    openMainPopover(currentAnchor, currentSentence);
  }else{
    pop.hidden=true; sub.hidden=true;
  }
}

// 리사이즈/스크롤 대응 (예전 그대로)
function resizeRelayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 8);
}
window.addEventListener("resize", resizeRelayout,{passive:true});
globalThis.visualViewport?.addEventListener("resize", resizeRelayout,{passive:true});
window.addEventListener("scroll", resizeRelayout,{passive:true});

// 바깥 클릭: 서브팝업만 닫기(메인팝업은 닫기 버튼)
stage.addEventListener("click",(e)=>{
  if(!sub.hidden && !sub.contains(e.target)) sub.hidden=true;
});

// 메인 팝업 (핵심만 변경: ruby 줄만, 토큰 클릭을 ruby에서 처리)
function openMainPopover(anchor, text){
  pop.hidden=false;
  const aw=anchor.getBoundingClientRect().width, overlayW=overlay.clientWidth;
  pop.style.width=Math.min(Math.max(Math.round(aw*1.1),420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  rubyLine.innerHTML=""; transLine.textContent="…";

  (async()=>{
    try{
      const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);

      // ruby 줄: 각 토큰을 span.tok로 감싸 클릭 가능
      const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || []).map(t=>({
        surface: t.surface || t.text || "",
        reading: kataToHira(t.reading || t.read || ""),
        lemma:   t.lemma || t.base || t.baseform || t.dict || ""
      }));
      rubyLine.innerHTML="";
      for(const t of tokens){
        const span=document.createElement("span"); span.className="tok";
        span.innerHTML = (hasKanji(t.surface) && t.reading)
          ? `<ruby>${escapeHtml(t.surface)}<rt>${escapeHtml(t.reading)}</rt></ruby>`
          : escapeHtml(t.surface);
        span.addEventListener("click",(ev)=>{ ev.stopPropagation(); openSubForToken(span, t); });
        rubyLine.appendChild(span);
      }

      const translated = tr?.text || tr?.result || tr?.translation || "";
      transLine.textContent = translated || "(번역 없음)";
      requestAnimationFrame(()=> placeMainPopover(anchor, pop, 8));
    }catch(e){
      transLine.textContent="(번역 실패)"; console.error(e);
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

// 서브팝업(간단/안전 버전: 헤더 링크 + 토큰 번역 + 한자 링크)
async function openSubForToken(tokEl, token){
  currentTokenEl=tokEl;
  const surf = token.surface || "";
  const reading = kataToHira(token.reading || "");
  const lemma = token.lemma || surf;

  sub.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px">
      <a href="https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(lemma||surf)}" target="_blank" style="font-weight:700;text-decoration:underline">
        ${hasKanji(surf)&&reading ? `<ruby>${escapeHtml(surf)}<rt>${escapeHtml(reading)}</rt></ruby>` : escapeHtml(surf)}
        ${lemma && lemma!==surf ? ` <span style="opacity:.8">(${escapeHtml(lemma)})</span>` : ""}
      </a>
    </div>
    <div id="subTrans" style="margin:6px 0 8px; font-size:14px; line-height:1.55; opacity:.95">…</div>
    <div id="kwrap" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
  `;
  sub.hidden=false; placeSubDetached(pop, tokEl, sub, 8);

  // 개별 토큰 번역
  try{
    const r = await translateJaKo(lemma||surf);
    document.getElementById("subTrans").textContent = r?.text || r?.result || r?.translation || "(번역 없음)";
  }catch{ document.getElementById("subTrans").textContent="(번역 실패)"; }

  // 한자 칩(일단 네이버 한자 링크만 — DB는 나중 단계에 안전히 붙임)
  const kwrap = document.getElementById("kwrap");
  for(const ch of surf){
    if(!hasKanji(ch)) continue;
    const a=document.createElement("a");
    a.textContent=ch; a.href=`https://hanja.dict.naver.com/hanja?q=${encodeURIComponent(ch)}`; a.target="_blank";
    Object.assign(a.style,{ display:"inline-block", padding:"4px 8px", borderRadius:"8px",
      background:"#cfe9ff", color:"#001018", fontWeight:"700", textDecoration:"none",
      border:"1px solid rgba(0,0,0,.12)" });
    kwrap.appendChild(a);
  }
}
