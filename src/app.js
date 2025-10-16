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
// ⬇︎ 추가: 최근 후리가나 토큰(형태소) 보관 (서브팝업용)
let lastFuriganaTokens = [];

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// 유틸
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji   = s => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));

// ⬇︎ 추가: 루비용 토큰을 클릭 가능한 .tok로 감싸서 렌더
function renderRubyFromTokens(tokens){
  return tokens.map((t,i)=>{
    const surf = t.surface || t.text || "";
    const read = kataToHira(t.reading || t.read || "");
    const body = (hasKanji(surf) && read)
      ? `<ruby>${escapeHtml(surf)}<rt>${escapeHtml(read)}</rt></ruby>`
      : escapeHtml(surf);
    return `<span class="tok" data-idx="${i}">${body}</span>`;
  }).join("");
}

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

// ⬇︎ 변경: 팝업 열린 상태면 문장 “연결”, 닫혀 있으면 새로 시작
function onSelectBox(box){
  // 이전엔 모두 비활성화했지만, 연결 모드에서는 기존 선택을 남겨두는 것이 직관적
  if (pop.hidden) overlay.querySelectorAll(".box").forEach(b=>b.classList.remove("active"));
  box.classList.add("active");

  const text = box.dataset.text || "";
  currentAnchor = box;
  if (pop.hidden) currentSentence = text;
  else currentSentence += text; // 일본어 문장 연결은 공백 없이

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

// ⬇︎ 변경: 바깥 클릭해도 “메인 팝업은 닫지 않음”(연결 모드 유지). 대신 서브팝업만 닫기.
document.getElementById("stage").addEventListener("click",(e)=>{
  if (!sub.hidden && !sub.contains(e.target) && !pop.contains(e.target)) {
    sub.hidden = true; currentTokenEl = null;
  }
});

function openMainPopover(anchor, text){
  pop.hidden=false;
  const aw=anchor.getBoundingClientRect().width, overlayW=overlay.clientWidth;
  pop.style.width=Math.min(Math.max(Math.round(aw*1.1),420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

  // ⬇︎ 중복 제거: 원래의 origLine 토큰 분할 표시 제거
  rubyLine.innerHTML=""; 
  origLine.innerHTML=""; // 쓰지 않음(빈 상태 유지)
  transLine.textContent="…";

  // ⬇︎ 루비 라인에서만 형태소 클릭 허용 (위임)
  rubyLine.onclick = (ev)=>{
    const t = ev.target.closest(".tok");
    if(!t) return;
    const idx = +t.dataset.idx;
    const tokObj = lastFuriganaTokens[idx] || null;
    if (!tokObj) return;
    openSubForMorph(t, tokObj);
  };

  (async()=>{
    try{
      const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);

      // ⬇︎ 후리가나 토큰 보강/저장
      const tokens = rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [];
      lastFuriganaTokens = tokens;
      rubyLine.innerHTML = renderRubyFromTokens(tokens);

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

// ⬇︎ 변경: 서브팝업은 “루비 토큰 객체” 기준
function openSubForMorph(tokEl, tokObj){
  currentTokenEl = tokEl;
  const surf = tokObj.surface || tokObj.text || "";
  const read = kataToHira(tokObj.reading || tokObj.read || "");
  sub.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-weight:700;font-size:16px">${escapeHtml(surf)}</div>
        ${read ? `<div style="font-size:13px;opacity:.85">${escapeHtml(read)}</div>` : ""}
      </div>
      <div style="display:flex;gap:10px">
        ${surf.length===1 && hasKanji(surf)
          ? `<a href="javascript:void(0)" id="openHanja">네이버 한자</a>`
          : `<a href="javascript:void(0)" id="openLemma">네이버 사전</a>`}
      </div>
    </div>`;
  sub.hidden=false; placeSubDetached(pop, tokEl, sub, 8);
  const a1=document.getElementById("openLemma"); const a2=document.getElementById("openHanja");
  if(a1) a1.onclick=()=> openNaverJaLemma(surf);
  if(a2) a2.onclick=()=> openNaverHanja(surf);
}

// (참고) 기존 함수 openSubForToken은 더 이상 사용하지 않지만, 다른 곳에서 참조 없으므로 제거하지 않고 그대로 둬도 무해.
// 필요시 아래처럼 남겨 둘 수 있음.
// function openSubForToken(tokEl, token){ ... }
