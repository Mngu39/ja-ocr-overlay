// 안정 동작판 + (1)화살표 스냅/비활성, (2)우측 아이콘 도킹, (3)서브팝업 위치/가독성, (5)한자DB 경로 확정
import { getImageById, gcvOCR, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const stage   = document.getElementById("stage");
const imgEl   = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint    = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");
const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const popDrag   = document.getElementById("popDrag");

const sub       = document.getElementById("sub");
const subTitle  = document.getElementById("subTitle");
const subBody   = document.getElementById("subBody");
const subDrag   = document.getElementById("subDrag");

// 선택 관련
let annos = [];
let selected = [];               // [{el,text}]
let currentAnchor = null;        // 항상 "첫번째" 박스
let currentTokenEl = null;

// ===== Kanji DBs (경로: /public/...) =====
let KANJI = null;  // 일반: { '漢': { '음': '...', '훈': '...', ... }, ... }
let ANKI  = null;  // Anki:  { '漢': { mean:'...', explain:'...' }, ... }
async function loadDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);
    KANJI = j1.status==="fulfilled" ? (j1.value||{}) : {};
    // CrowdAnki → map
    if (j2.status==="fulfilled" && j2.value){
      const map = {};
      const stack = [j2.value];
      while(stack.length){
        const node = stack.pop();
        if (Array.isArray(node?.children)) stack.push(...node.children);
        if (Array.isArray(node?.notes)){
          for (const n of node.notes){
            const f = n.fields || [];
            const ch   = (f[1] ?? "").toString().trim();
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
  }catch{ KANJI={}; ANKI={}; }
}
const DB_READY = loadDBs();

// ===== 유틸 =====
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const hasKanji   = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
const vb = () => (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });

// 월 1,000건 로컬 카운트
function quotaKey(){ const d=new Date(); return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; }
function tryConsumeQuota(){ const k=quotaKey(); const n=+(localStorage.getItem(k)||0); if(n>=1000) return{ok:false,key:k,n}; localStorage.setItem(k, n+1); return{ok:true,key:k,n:n+1}; }
function rollbackQuota(k){ const n=+(localStorage.getItem(k)||1); localStorage.setItem(k, Math.max(0,n-1)); }

// ===== Bootstrap (이미지 → OCR) =====
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
    imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`; // 캐시버스터
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
    currentAnchor = selected[0].el;  // 첫 번째 박스를 기준 앵커로 고정
    openMainFromSelection();
  }else{
    pop.hidden=true; sub.hidden=true;
  }
}
function renumber(){ selected.forEach((it,i)=> it.el.querySelector(".ord")?.textContent = i+1); }
function selectedText(){ return selected.map(x=>x.text).join(""); }

// ===== Main Popover =====
function openMainFromSelection(){ openMainPopover(currentAnchor, selectedText()); }

async function openMainPopover(anchor, text){
  pop.hidden=false; sub.hidden=true;
  ensureSideDock(); // ✎/✕ 아이콘 도킹 보장

  // 앵커 너비 기반 폭
  const aw = anchor.getBoundingClientRect().width, overlayW = overlay.clientWidth;
  pop.style.width = Math.min(Math.max(Math.round(aw*1.1), 420), Math.round(overlayW*0.92))+"px";
  placeMainPopover(anchor, pop, 8);

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
      updateArrowEnablement(); // 초기 상태 갱신
    });
  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }
}

// === 우측 아이콘 도킹(✎/✕) — 텍스트 버튼 제거 대체 ===
function ensureSideDock(){
  if (pop.querySelector(".side-dock")) return;
  const dock = document.createElement("div");
  dock.className = "side-dock";
  const mk = (label, on)=>{ const b=document.createElement("button"); b.className="icon"; b.textContent=label; b.onclick=(e)=>{ e.stopPropagation(); on(); }; return b; };
  // ✎ 수정
  dock.appendChild(mk("✎", ()=>{ editInput.value = selectedText() || ""; editDlg.showModal(); }));
  // ✕ 닫기
  dock.appendChild(mk("✕", ()=>{
    pop.hidden=true; sub.hidden=true;
    selected.forEach(it=>{ it.el.classList.remove("selected"); it.el.querySelector(".ord")?.remove(); });
    selected = [];
  }));
  pop.appendChild(dock);
}
document.getElementById("editOk").addEventListener("click", ()=>{
  const t = editInput.value.trim(); if(!t){ editDlg.close(); return; }
  editDlg.close(); openMainPopover(currentAnchor, t);
});

// === 방향바: “미세이동” 제거 → 즉시 상/하/좌/우 스냅 ===
const bars = Array.from(pop.querySelectorAll(".arrow-bar"));
bars.forEach(b=>{
  b.addEventListener("click",(e)=>{
    e.stopPropagation();
    if (b.classList.contains("disabled")) return;
    snapTo(b.dataset.dir);
  });
});

// 후보 배치 좌표 계산(해당 방향으로 ‘한 번에’)
function computeSnapRect(dir){
  if(!currentAnchor) return null;
  const rA = currentAnchor.getBoundingClientRect();
  const rP = pop.getBoundingClientRect();
  const gap = 8;
  let x,y;
  if(dir==="top"){
    x = rA.left + (rA.width - rP.width)/2;
    y = rA.top - rP.height - gap;
  }else if(dir==="bottom"){
    x = rA.left + (rA.width - rP.width)/2;
    y = rA.bottom + gap;
  }else if(dir==="left"){
    x = rA.left - rP.width - gap;
    y = rA.top + (rA.height - rP.height)/2;
  }else if(dir==="right"){
    x = rA.right + gap;
    y = rA.top + (rA.height - rP.height)/2;
  }
  return { left:x, top:y, right:x + rP.width, bottom:y + rP.height, width:rP.width, height:rP.height };
}

function snapTo(dir){
  const rect = computeSnapRect(dir); if(!rect) return;
  pop.style.left = (rect.left + window.scrollX) + "px";
  pop.style.top  = (rect.top  + window.scrollY) + "px";
  if (currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 8);
  updateArrowEnablement();
}

// “그 방향으로 스냅했을 때” 화살표가 눌릴 수 없으면 비활성(X 패턴)
function updateArrowEnablement(){
  const v = vb();
  const margin = 4; // 바 자체 두께 고려 소폭 여유
  const test = (dir)=>{
    const r = computeSnapRect(dir); if(!r) return false;
    // 해당 방향 바의 좌표가 뷰포트 안에 최소한 들어오는지 판단
    if(dir==="top")    return (r.top + margin)    >= v.offsetTop;
    if(dir==="bottom") return (r.bottom - margin) <= (v.offsetTop + v.height);
    if(dir==="left")   return (r.left + margin)   >= v.offsetLeft;
    if(dir==="right")  return (r.right - margin)  <= (v.offsetLeft + v.width);
    return false;
  };
  pop.querySelector(".arrow-top")   .classList.toggle("disabled", !test("top"));
  pop.querySelector(".arrow-bottom").classList.toggle("disabled", !test("bottom"));
  pop.querySelector(".arrow-left")  .classList.toggle("disabled", !test("left"));
  pop.querySelector(".arrow-right") .classList.toggle("disabled", !test("right"));
}

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

// 바깥 클릭 → 서브만 닫기
document.addEventListener("click",(e)=>{
  if(!sub.hidden && !sub.contains(e.target)) sub.hidden=true;
},{capture:true});

// ===== Sub Popup =====
async function openSubForToken(tokEl, tok){
  currentTokenEl = tokEl;
  const surface = tok.surface||"";
  const reading = kataToHira(tok.reading||"");
  const lemma   = tok.lemma||surface;

  // 헤더(링크 + lemma) — 가독성 강화
  const url = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(lemma||surface)}`;
  subTitle.innerHTML =
    `<a href="${url}" target="_blank" rel="noreferrer noopener">${
       hasKanji(surface)&&reading
       ? `<ruby>${escapeHtml(surface)}<rt style="font-size:11px">${escapeHtml(reading)}</rt></ruby>`
       : escapeHtml(surface)
     }</a><span class="lemma">(${escapeHtml(lemma)})</span>`;

  // 본문: 번역 + 한자박스
  subBody.innerHTML = `
    <div class="sub-row" id="subTrans">…</div>
    <div class="sub-row"><div class="kwrap" id="kwrap"></div></div>`;

  // 번역(단어)
  try{
    const r = await translateJaKo(lemma||surface);
    const txt = r?.text || r?.result || r?.translation || "";
    document.getElementById("subTrans").textContent = txt || "(번역 없음)";
  }catch{
    document.getElementById("subTrans").textContent = "(번역 실패)";
  }

  // 한자 박스(가로 나열) — ANKI(초록) > 일반DB(남색) > 없음(회색)
  await DB_READY;
  const kwrap = document.getElementById("kwrap");
  const uniq = Array.from(new Set(Array.from(surface).filter(ch=>hasKanji(ch))));
  for (const ch of uniq){
    const anki = ANKI?.[ch];
    const db   = KANJI?.[ch];
    const div  = document.createElement("div");
    div.className = "k " + (anki ? "anki" : (db ? "db" : ""));
    const gloss = anki ? (anki.mean||"")
                       : db ? [db["음"], db["훈"]].filter(Boolean).join(" / ")
                            : "";
    div.innerHTML = `${escapeHtml(ch)}${gloss?`<small>${escapeHtml(gloss)}</small>`:""}`;
    div.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if (anki){
        let ex = subBody.querySelector(".k-explain");
        if(!ex){ ex=document.createElement("div"); ex.className="k-explain sub-row"; subBody.appendChild(ex); }
        ex.textContent = anki.explain || "(설명 없음)";
      }else if (db){
        // 간단 훈음 토스트(경량) — 필요시 네이버 이동으로 대체 가능
        alert(`${ch} : ${gloss || "정보 없음"}`);
      }else{
        openNaverHanja(ch);
      }
    });
    kwrap.appendChild(div);
  }

  // 한자 수에 맞춰 서브 폭 조정(F20)
  requestAnimationFrame(()=>{
    const need = Math.min(Math.max(kwrap.scrollWidth + 24, 260), Math.floor(window.innerWidth*0.86));
    sub.style.width = need + "px";
    sub.hidden=false;
    placeSubDetached(pop, tokEl, sub, 8);
  });
}

// ===== Relayout =====
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden) placeMainPopover(currentAnchor, pop, 8);
  if(currentTokenEl && !sub.hidden) placeSubDetached(pop, currentTokenEl, sub, 8);
  if(!pop.hidden) updateArrowEnablement();
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});
