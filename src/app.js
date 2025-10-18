// 안정판 유지 + 지정 수정(1~5)만 반영
import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { placeMainPopover } from "./place.js"; // top/bottom 배치는 그대로 사용

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");
const popDrag   = document.getElementById("popDrag");
const sideDock  = document.getElementById("sideDock");

const sub       = document.getElementById("sub");
const subTitle  = document.getElementById("subTitle");
const subBody   = document.getElementById("subBody");
const subDrag   = document.getElementById("subDrag");
const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");

// 선택 관련 (안정판 그대로)
let annos = [];
let selected = [];        // [{el,text}]
let currentAnchor = null; // 항상 "첫 번째" 박스 기준
let currentTokenEl = null;

// Kanji DB 로드 (제공 JSON 구조에 맞춤)
let KANJI = {};  // { '漢': { '음': '...', '훈': '...', ... }, ... }
let ANKI  = {};  // { '漢': { mean:'...', explain:'...' }, ... }
(async function loadDBs(){
  try{
    const [k, a] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():{}),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);
    KANJI = (k.status==="fulfilled" && k.value) ? k.value : {};
    if (a.status==="fulfilled" && a.value){
      const map = {};
      const stack = [a.value];
      while(stack.length){
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
    }
  }catch(_e){ /* ignore */ }
})();

// 유틸 (안정판 그대로)
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji   = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// ===== Bootstrap (안정판 로직 그대로) =====
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

// ===== Overlay (안정판 그대로 + 번호/음영 유지) =====
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
    currentAnchor = selected[0].el;   // 항상 첫 번째 박스 기준
    openMainFromSelection();
  }else{
    pop.hidden=true; sub.hidden=true;
  }
}
function renumber(){ selected.forEach((it,i)=> it.el.querySelector(".ord")?.textContent = i+1); }
function selectedText(){ return selected.map(x=>x.text).join(""); }

// ===== 메인 팝업 =====
let currentSide = null; // 'top' | 'bottom' | 'left' | 'right' | null(자동)
function openMainFromSelection(){ openMainPopover(currentAnchor, selectedText()); }

async function openMainPopover(anchor, text){
  pop.hidden=false; sub.hidden=true;

  // 팝업 폭: 앵커 너비 기반(안정판), 화면폭 92% 제한
  const aw = anchor.getBoundingClientRect().width, overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.1), 420), Math.round(overlayW*0.92))+"px";

  // 기본 배치: 공간 넓은 쪽(top/bottom) — 안정판 placeMainPopover 사용
  if (!currentSide || currentSide==="top" || currentSide==="bottom"){
    placeMainPopover(anchor, pop, 8);
  }else{
    // 좌/우 고정 배치
    placeAroundAnchor(anchor, pop, currentSide, 8);
  }
  updateArrowEnablement();

  // 루비/번역 초기화
  rubyLine.innerHTML="…"; transLine.textContent="…";

  try{
    const [rubi, tr] = await Promise.all([ getFurigana(text), translateJaKo(text) ]);

    const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || []).map(t=>({
      surface: t.surface || t.text || "",
      reading: kataToHira(t.reading || t.read || t.kana || ""),
      lemma:   t.lemma || t.base || t.baseform || t.dict || (t.surface||t.text||"")
    })).filter(t=>t.surface);

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
      if (!currentSide || currentSide==="top" || currentSide==="bottom") placeMainPopover(anchor, pop, 8);
      else placeAroundAnchor(anchor, pop, currentSide, 8);
      updateArrowEnablement();
    });
  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }

  ensureSideDock(); // 아이콘 버튼(✎/✕) 세팅
}

// ——— 좌/우 고정 배치(수정사항 1 반영) ———
function placeAroundAnchor(anchor, panel, side, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const ar = anchor.getBoundingClientRect();
  const pr = panel.getBoundingClientRect(); // 폭/높이 참조

  let x = 0, y = 0;
  if (side==="left"){
    x = ar.left - pr.width - gap;
    y = ar.top + (ar.height - pr.height)/2;
  }else if (side==="right"){
    x = ar.right + gap;
    y = ar.top + (ar.height - pr.height)/2;
  }else if (side==="top"){
    x = ar.left + (ar.width - pr.width)/2;
    y = ar.top - pr.height - gap;
  }else{ // bottom
    x = ar.left + (ar.width - pr.width)/2;
    y = ar.bottom + gap;
  }

  // 화면 안으로 최소한의 클램프(잘려도 되지만, 완전 손실 방지)
  const minX = vb.offsetLeft + 4, maxX = vb.offsetLeft + vb.width - pr.width - 4;
  const minY = vb.offsetTop + 4,  maxY = vb.offsetTop + vb.height - pr.height - 4;
  x = Math.min(Math.max(x, minX), maxX);
  y = Math.min(Math.max(y, minY), maxY);

  Object.assign(panel.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}

// ——— 방향바 클릭: 한 번에 해당 면으로 이동 ———
Array.from(pop.querySelectorAll(".arrow-bar")).forEach(b=>{
  b.addEventListener("click",(e)=>{
    e.stopPropagation();
    if (b.classList.contains("disabled")) return;
    const dir = b.dataset.dir;
    currentSide = dir;                     // 사용자가 명시한 면으로 고정
    placeAroundAnchor(currentAnchor, pop, dir, 8);
    if (currentTokenEl && !sub.hidden) placeSubRelativeToPop(currentTokenEl); // 서브도 동반 이동
    updateArrowEnablement();
  });
});

function updateArrowEnablement(){
  const v = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const pr = pop.getBoundingClientRect();

  // 각 방향으로 이동했을 때 "해당 방향바 자체가 거의 전부 화면 밖"이면 비활성
  const will = (side)=>{
    const fake = { left:0, top:0, width:pr.width, height:pr.height };
    const ar = currentAnchor?.getBoundingClientRect?.() || pr;
    if (side==="left"){ fake.left = ar.left - pr.width - 8; fake.top = ar.top + (ar.height-pr.height)/2; }
    if (side==="right"){ fake.left = ar.right + 8; fake.top = ar.top + (ar.height-pr.height)/2; }
    if (side==="top"){ fake.left = ar.left + (ar.width-pr.width)/2; fake.top = ar.top - pr.height - 8; }
    if (side==="bottom"){ fake.left = ar.left + (ar.width-pr.width)/2; fake.top = ar.bottom + 8; }
    // 바가 자리할 모서리 여유(8px) 체크
    const pad = 8;
    const fullyOut =
      (fake.left+pr.width < v.offsetLeft+pad) ||
      (fake.left > v.offsetLeft+v.width-pad) ||
      (fake.top+pr.height < v.offsetTop+pad) ||
      (fake.top > v.offsetTop+v.height-pad);
    return !fullyOut;
  };

  pop.querySelector(".arrow-top")   .classList.toggle("disabled", !will("top"));
  pop.querySelector(".arrow-bottom").classList.toggle("disabled", !will("bottom"));
  pop.querySelector(".arrow-left")  .classList.toggle("disabled", !will("left"));
  pop.querySelector(".arrow-right") .classList.toggle("disabled", !will("right"));
}

// ——— 우측 도크(✎/✕) ———
function ensureSideDock(){
  if (sideDock.dataset.ready==="1") return;
  sideDock.dataset.ready="1";
  const mk=(txt, cb)=>{
    const b=document.createElement("button");
    b.className="ic"; b.type="button"; b.textContent=txt;
    b.addEventListener("click",(e)=>{ e.stopPropagation(); cb(); });
    return b;
  };
  sideDock.appendChild(mk("✎", ()=>{
    editInput.value = selectedText() || "";
    editDlg.showModal();
  }));
  sideDock.appendChild(mk("✕", ()=>{
    pop.hidden = true; sub.hidden = true;
    selected.forEach(it=>{ it.el.classList.remove("selected"); it.el.querySelector(".ord")?.remove(); });
    selected = []; currentSide=null;
  }));
}

// 수정 저장
document.getElementById("editOk").addEventListener("click", ()=>{
  const t = editInput.value.trim(); if(!t){ editDlg.close(); return; }
  editDlg.close(); openMainPopover(currentAnchor, t);
});

// 드래그(메인/서브)
makeDraggable(pop, popDrag);
makeDraggable(sub, subDrag);
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
    if(panel===pop) updateArrowEnablement();
  });
  handle.addEventListener("pointerup",()=>{ dragging=false; });
}

// 바깥 클릭 → 서브만 닫기 (메인은 유지)
document.addEventListener("click",(e)=>{
  if(!sub.hidden && !sub.contains(e.target)) sub.hidden=true;
},{capture:true});

// ===== 서브 팝업 =====
async function openSubForToken(tokEl, tok){
  currentTokenEl = tokEl;
  const surface = tok.surface||"";
  const reading = kataToHira(tok.reading||"");
  const lemma   = tok.lemma||surface;

  // 헤더: 링크 + lemma(가독성 향상)
  const url = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(lemma||surface)}`;
  subTitle.innerHTML =
    `<a href="${url}" target="_blank" rel="noopener">
      ${hasKanji(surface)&&reading ? `<ruby>${escapeHtml(surface)}<rt style="font-size:11px">${escapeHtml(reading)}</rt></ruby>` : escapeHtml(surface)}
     </a><span class="lemma">(${escapeHtml(lemma)})</span>`;

  // 본문: 번역 + 한자박스(가로)
  subBody.innerHTML = `
    <div class="sub-row" id="subTrans">…</div>
    <div class="sub-row"><div class="kwrap" id="kwrap"></div></div>`;

  // 단어 번역
  try{
    const r = await translateJaKo(lemma||surface);
    const txt = r?.text || r?.result || r?.translation || "";
    document.getElementById("subTrans").textContent = txt || "(번역 없음)";
  }catch{ document.getElementById("subTrans").textContent = "(번역 실패)"; }

  // 한자 박스(Anki 우선 → DB → 네이버)
  const kwrap = document.getElementById("kwrap");
  const uniq = Array.from(new Set(Array.from(surface).filter(ch=>hasKanji(ch))));
  for (const ch of uniq){
    const anki = ANKI[ch];
    const db   = KANJI[ch];
    const div  = document.createElement("div");
    div.className = "k " + (anki ? "anki" : "db");
    const gloss = anki ? (anki.mean||"") : (db ? [db["음"], db["훈"]].filter(Boolean).join(" / ") : "");
    div.innerHTML = `${escapeHtml(ch)}${gloss?`<small>${escapeHtml(gloss)}</small>`:""}`;
    div.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if (anki){
        let ex = subBody.querySelector(".k-explain");
        if(!ex){ ex=document.createElement("div"); ex.className="k-explain sub-row"; subBody.appendChild(ex); }
        ex.textContent = anki.explain || "(설명 없음)";
      }else{
        if (db){ /* 간단 훈음만 */ alert(`${ch} : ${gloss}`); }
        else{ openNaverHanja(ch); }
      }
    });
    kwrap.appendChild(div);
  }

  // 위치: 메인팝업 외측 하단 우선, 불가 시 상단 (팝업 폭 고려)
  sub.hidden=false;
  placeSubRelativeToPop(tokEl);
}

// 서브팝업 배치 (메인팝업 폭/뷰포트 고려)
function placeSubRelativeToPop(tokEl, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();
  const tr = tokEl.getBoundingClientRect();

  // 우선: 팝업 하단
  let x = Math.min(Math.max(tr.left + (tr.width - sr.width)/2, vb.offsetLeft + 8), vb.offsetLeft + vb.width - sr.width - 8);
  let y = pr.bottom + gap;

  // 하단에 공간 부족하면 상단
  if (y + sr.height > vb.offsetTop + vb.height - 8){
    y = pr.top - sr.height - gap;
  }
  // 상단도 부족하면, 화면 안으로만 살짝 클램프
  y = Math.min(Math.max(y, vb.offsetTop + 8), vb.offsetTop + vb.height - sr.height - 8);

  Object.assign(sub.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}

// ===== 리레이아웃 =====
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden){
    if (!currentSide || currentSide==="top" || currentSide==="bottom") placeMainPopover(currentAnchor, pop, 8);
    else placeAroundAnchor(currentAnchor, pop, currentSide, 8);
    updateArrowEnablement();
  }
  if(currentTokenEl && !sub.hidden) placeSubRelativeToPop(currentTokenEl);
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});
