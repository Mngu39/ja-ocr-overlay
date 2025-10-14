// … (상단 import/DOM/유틸/부트스트랩 동일)

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
        const surf = t.surface || t.text || ""; // 호환
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
