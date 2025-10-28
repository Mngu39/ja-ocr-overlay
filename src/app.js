// 안정 동작판 + 요구 수정사항 반영
// (이미지 로딩 라인 절대 변경 없음)

import {
  getImageById,
  gcvOCR,
  getFurigana,
  translateJaKo,
  openNaverJaLemma,
  openNaverHanja
} from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

// DOM refs
const stage    = document.getElementById("stage");
const imgEl    = document.getElementById("img");
const overlay  = document.getElementById("overlay");
const hint     = document.getElementById("hint");

const pop      = document.getElementById("pop");
const rubyLine = document.getElementById("rubyLine");
const transLine= document.getElementById("transLine");
const popDrag  = document.getElementById("popDrag");

const sub      = document.getElementById("sub");
const subTitle = document.getElementById("subTitle");
const subBody  = document.getElementById("subBody");
const subDrag  = document.getElementById("subDrag");

const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const editOkBtn = document.getElementById("editOk");

// 선택 상태
let annos = [];            // [{ text, polygon:[[x,y]x4] }, ...]
let selected = [];         // [{ el, text }]
let currentAnchor = null;  // 항상 첫 번째 선택 박스
let currentTokenEl = null; // 현재 서브팝업 기준 토큰

// ===== Kanji DBs =====
// KANJI: { '漢': { '음': '...', '훈': '...' , ... }, ... }
// ANKI:  { '漢': { mean:'...', explain:'...' }, ... }
let KANJI = {};
let ANKI  = {};

async function loadDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);

    // 일반 DB
    KANJI = (j1.status==="fulfilled" && j1.value) ? j1.value : {};

    // CrowdAnki → map {kanji:{mean,explain}}
    ANKI = {};
    if (j2.status==="fulfilled" && j2.value){
      const stack = [j2.value];
      while(stack.length){
        const node = stack.pop();
        if (Array.isArray(node?.children)) stack.push(...node.children);
        if (Array.isArray(node?.notes)){
          for(const n of node.notes){
            const f = n.fields || [];
            const ch      = (f[1] ?? "").toString().trim();
            const meanRaw = (f[2] ?? "").toString();
            const expRaw  = (f[3] ?? "").toString();
            const mean = meanRaw.replace(/<[^>]+>/g,"").trim();
            const explain = expRaw.replace(/<[^>]+>/g,"").trim();
            if (ch && ch.length===1){
              ANKI[ch] = { mean, explain };
            }
          }
        }
      }
    }
  }catch(e){
    console.warn("DB load failed", e);
    KANJI={}; ANKI={};
  }
}
const DB_READY = loadDBs();

// ===== 유틸 =====
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[m]));

const hasKanji = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s => (s||"").replace(/[\u30a1-\u30f6]/g,
  ch=>String.fromCharCode(ch.charCodeAt(0)-0x60)
);

// 월 1,000건 로컬 카운트
function quotaKey(){
  const d=new Date();
  return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`;
}
function tryConsumeQuota(){
  const k=quotaKey();
  const n=+(localStorage.getItem(k)||0);
  if(n>=1000) return { ok:false, key:k, n };
  localStorage.setItem(k, n+1);
  return { ok:true, key:k, n:n+1 };
}
function rollbackQuota(k){
  const n=+(localStorage.getItem(k)||1);
  localStorage.setItem(k, Math.max(0,n-1));
}

// ===== 부트스트랩 (이미지 → OCR) =====
(async function bootstrap(){
  try{
    const qs = new URLSearchParams(location.search);
    const id = qs.get("id");
    if(!id) throw new Error("?id= 필요");

    imgEl.onload = async ()=>{
      const q=tryConsumeQuota();
      if(!q.ok){
        hint.textContent="월간 무료 사용량 초과";
        return;
      }
      try{
        hint.textContent="OCR(Google) 중…";
        annos = await gcvOCR(id);
        // annos는 [{text, polygon:[[x,y]x4]}, ...]
        if(!annos.length){
          hint.textContent="문장을 찾지 못했습니다.";
          return;
        }
        hint.textContent="문장상자를 탭하세요";
        renderOverlay();
      }catch(e){
        rollbackQuota(q.key);
        console.error(e);
        hint.textContent="OCR 오류";
      }
    };

    imgEl.onerror = ()=>{
      hint.textContent="이미지를 불러오지 못했습니다";
    };

    // ⛔ 절대진리: 이 라인들은 손대지 않는다
    imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`;
  }catch(e){
    hint.textContent = e.message;
  }
})();

// ===== Overlay =====
function renderOverlay(){
  const rect=imgEl.getBoundingClientRect();
  overlay.style.width  = rect.width+"px";
  overlay.style.height = rect.height+"px";

  const sx = rect.width  / imgEl.naturalWidth;
  const sy = rect.height / imgEl.naturalHeight;

  overlay.innerHTML="";
  for(const a of annos){
    const [p0,p1,p2,p3] = a.polygon;
    const l = Math.min(p0[0],p3[0])*sx;
    const t = Math.min(p0[1],p1[1])*sy;
    const r = Math.max(p1[0],p2[0])*sx;
    const b = Math.max(p2[1],p3[1])*sy;
    const w = Math.max(6, r-l);
    const h = Math.max(6, b-t);

    const box=document.createElement("div");
    box.className="box";
    Object.assign(box.style,{
      left:l+"px", top:t+"px",
      width:w+"px", height:h+"px"
    });
    box.dataset.text = a.text || "";
    box.addEventListener("click", ev=>{
      ev.stopPropagation();
      toggleSelect(box);
    });
    overlay.appendChild(box);
  }
  renumberSelected();
}

function toggleSelect(box){
  const i = selected.findIndex(x=>x.el===box);
  if (i>=0){
    // 해제
    box.classList.remove("selected");
    box.querySelector(".ord")?.remove();
    selected.splice(i,1);
  }else{
    // 선택
    selected.push({ el:box, text:box.dataset.text||"" });
    box.classList.add("selected");
    const tag=document.createElement("span");
    tag.className="ord";
    tag.textContent=selected.length;
    box.appendChild(tag);
  }

  renumberSelected();

  if(selected.length){
    // 기준 앵커는 "첫 번째" 선택 박스
    currentAnchor = selected[0].el;
    openMainFromSelection();
  }else{
    pop.hidden=true;
    sub.hidden=true;
  }
}

function renumberSelected(){
  selected.forEach((it,i)=>{
    const tag=it.el.querySelector(".ord");
    if(tag) tag.textContent = i+1;
  });
}

function selectedText(){
  return selected.map(x=>x.text).join("");
}

// ===== 메인 팝업 =====
function openMainFromSelection(){
  openMainPopover(currentAnchor, selectedText());
}

async function openMainPopover(anchor, text){
  pop.hidden=false;
  sub.hidden=true;

  // 폭: 앵커 박스 기준 (최소 420px, 최대 stage 폭 92%)
  const aw = anchor.getBoundingClientRect().width;
  const overlayW = overlay.clientWidth;
  pop.style.width = Math.min(
    Math.max(Math.round(aw*1.1), 420),
    Math.round(overlayW*0.92)
  )+"px";

  placeMainPopover(anchor, pop, 8);

  // 우측 도킹(✕,✎)이 아직 없다면 붙이기
  ensureDock();

  // 초기 텍스트
  rubyLine.innerHTML="…";
  transLine.textContent="…";

  try{
    const [rubi, tr] = await Promise.all([
      getFurigana(text),
      translateJaKo(text)
    ]);

    // rubi 표준화
    const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || []).map(t=>({
      surface: t.surface || t.text || "",
      reading: kataToHira(t.reading || t.read || t.kana || ""),
      lemma:   t.lemma || t.base || t.baseform || t.dict || (t.surface||t.text||"")
    })).filter(t=>t.surface);

    // 루비 라인 렌더
    rubyLine.innerHTML = tokens.map(t=>{
      const surfEsc = escapeHtml(t.surface);
      const readEsc = escapeHtml(t.reading || "");
      const lemmaEsc= escapeHtml(t.lemma   || t.surface);

      if(hasKanji(t.surface) && t.reading){
        return `
          <span class="tok"
                data-surf="${surfEsc}"
                data-lemma="${lemmaEsc}"
                data-read="${readEsc}">
            <ruby>${surfEsc}<rt>${readEsc}</rt></ruby>
          </span>`;
      }else{
        return `
          <span class="tok"
                data-surf="${surfEsc}"
                data-lemma="${lemmaEsc}"
                data-read="">
            ${surfEsc}
          </span>`;
      }
    }).join("");

    // 토큰 클릭 → 서브팝업
    rubyLine.querySelectorAll(".tok").forEach(span=>{
      span.addEventListener("click", ev=>{
        ev.stopPropagation();
        openSubForToken(span, {
          surface: span.dataset.surf || "",
          lemma:   span.dataset.lemma || span.dataset.surf || "",
          reading: span.dataset.read || ""
        });
      });
    });

    // 번역 라인
    const out = tr?.text || tr?.result || tr?.translation || "";
    transLine.textContent = out || "(번역 없음)";

    // 팝업 위치 재보정 후 화살표 가능 여부 갱신
    requestAnimationFrame(()=>{
      placeMainPopover(anchor, pop, 8);
      updateArrowEnablement();
    });

  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }
}

// 도킹 버튼(✕,✎)을 팝업 오른쪽에 수직으로 붙인다
function ensureDock(){
  if(pop.querySelector(".dock")) return;

  const dock = document.createElement("div");
  dock.className="dock";

  // 닫기(✕)
  const bClose=document.createElement("button");
  bClose.className="dock-btn";
  bClose.textContent="✕";
  bClose.title="닫기";
  bClose.addEventListener("click",()=>{
    pop.hidden=true;
    sub.hidden=true;
    selected.forEach(it=>{
      it.el.classList.remove("selected");
      it.el.querySelector(".ord")?.remove();
    });
    selected=[];
  });
  dock.appendChild(bClose);

  // 수정(✎)
  const bEdit=document.createElement("button");
  bEdit.className="dock-btn";
  bEdit.textContent="✎";
  bEdit.title="원문 수정";
  bEdit.addEventListener("click",e=>{
    e.stopPropagation();
    editInput.value = selectedText() || "";
    editDlg.showModal();
  });
  dock.appendChild(bEdit);

  pop.appendChild(dock);
}

// ===== 화살표(팝업 재배치) =====
const arrowBars = Array.from(pop.querySelectorAll(".arrow-bar"));
arrowBars.forEach(bar=>{
  bar.addEventListener("click", e=>{
    e.stopPropagation();
    if(bar.classList.contains("disabled")) return;
    snapTo(bar.dataset.dir);
  });
});

// viewport helper
function getViewportBox(){
  const vv = globalThis.visualViewport;
  if(vv){
    return {
      left: vv.offsetLeft,
      top:  vv.offsetTop,
      width: vv.width,
      height: vv.height
    };
  }
  return {
    left: window.scrollX,
    top:  window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight
  };
}

// 화살표 눌렀을 때: 첫 번째 박스(currentAnchor) 기준으로
// pop을 위/아래/왼쪽/오른쪽으로 "스냅"
function snapTo(dir){
  if(!currentAnchor) return;

  const gap = 8;
  const ar = currentAnchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  let left = pr.left;
  let top  = pr.top;

  if(dir==="top"){
    left = ar.left + (ar.width - pr.width)/2;
    top  = ar.top  - pr.height - gap;
  }else if(dir==="bottom"){
    left = ar.left + (ar.width - pr.width)/2;
    top  = ar.bottom + gap;
  }else if(dir==="left"){
    left = ar.left - pr.width - gap;
    top  = ar.top  + (ar.height - pr.height)/2;
  }else if(dir==="right"){
    left = ar.right + gap;
    top  = ar.top   + (ar.height - pr.height)/2;
  }

  pop.style.left = (left + window.scrollX)+"px";
  pop.style.top  = (top  + window.scrollY)+"px";

  // 서브팝업도 재배치
  if(currentTokenEl && !sub.hidden){
    placeSubDetached(pop, currentTokenEl, sub, 8);
  }

  updateArrowEnablement();
}

// 이동 가능 여부(=화살표 disable 여부)
// 팝업이 너무 나가서 화살표조차 못 누르는 상황이면 비활성화
function updateArrowEnablement(){
  if(!currentAnchor) return;

  const vp = getViewportBox();
  const gap=8;
  const ar = currentAnchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  const canTop =
    (ar.top - pr.height - gap) >= (vp.top + 4);
  const canBottom =
    (ar.bottom + gap + pr.height) <= (vp.top + vp.height - 4);
  const canLeft =
    (ar.left - pr.width - gap) >= (vp.left + 4);
  const canRight =
    (ar.right + gap + pr.width) <= (vp.left + vp.width - 4);

  pop.querySelector(".arrow-top")
    .classList.toggle("disabled", !canTop);
  pop.querySelector(".arrow-bottom")
    .classList.toggle("disabled", !canBottom);
  pop.querySelector(".arrow-left")
    .classList.toggle("disabled", !canLeft);
  pop.querySelector(".arrow-right")
    .classList.toggle("disabled", !canRight);
}

// ===== 수정 다이얼로그 OK =====
editOkBtn.addEventListener("click", ()=>{
  const t = editInput.value.trim();
  if(!t){
    editDlg.close();
    return;
  }
  editDlg.close();
  openMainPopover(currentAnchor, t);
});

// ===== 드래그(메인 팝업 / 서브팝업) =====
makeDraggable(pop, popDrag);
makeDraggable(sub, subDrag);

function makeDraggable(panel, handle){
  if(!panel || !handle) return;
  let sx=0, sy=0, sl=0, st=0, dragging=false;
  handle.addEventListener("pointerdown",e=>{
    dragging=true;
    handle.setPointerCapture(e.pointerId);
    const r=panel.getBoundingClientRect();
    sx=e.clientX; sy=e.clientY;
    sl=r.left+scrollX; st=r.top+scrollY;
  });
  handle.addEventListener("pointermove",e=>{
    if(!dragging) return;
    const dx=e.clientX-sx;
    const dy=e.clientY-sy;
    panel.style.left=(sl+dx)+"px";
    panel.style.top =(st+dy)+"px";
    if(panel===pop){
      updateArrowEnablement();
      if(currentTokenEl && !sub.hidden){
        placeSubDetached(pop, currentTokenEl, sub, 8);
      }
    }
  });
  handle.addEventListener("pointerup",()=>{
    dragging=false;
  });
}

// ===== 바깥 클릭 시: 서브팝업만 닫기 =====
document.addEventListener("click", e=>{
  if(!sub.hidden && !sub.contains(e.target)){
    sub.hidden=true;
  }
}, {capture:true});

// ===== 서브 팝업 =====
async function openSubForToken(tokEl, tok){
  currentTokenEl = tokEl;

  const surface = tok.surface || "";
  const reading = kataToHira(tok.reading || "");
  const lemma   = tok.lemma   || surface;

  // 헤더(네이버 일본어사전 링크 + lemma)
  const url = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(lemma || surface)}`;
  subTitle.innerHTML = `
    <a href="${url}" target="_blank" class="sub-word">
      ${
        (hasKanji(surface) && reading)
        ? `<ruby>${escapeHtml(surface)}<rt style="font-size:11px">${escapeHtml(reading)}</rt></ruby>`
        : escapeHtml(surface)
      }
    </a>
    <span class="lemma">(${escapeHtml(lemma)})</span>
  `;

  // 본문(번역 + 한자박스)
  subBody.innerHTML = `
    <div class="sub-row" id="subTrans">…</div>
    <div class="sub-row">
      <div class="kwrap" id="kwrap"></div>
    </div>
  `;

  // 단어 단위 번역
  try{
    const r = await translateJaKo(lemma || surface);
    const txt = r?.text || r?.result || r?.translation || "";
    document.getElementById("subTrans").textContent = txt || "(번역 없음)";
  }catch{
    document.getElementById("subTrans").textContent = "(번역 실패)";
  }

  // 한자 박스 구성
  await DB_READY;
  const kwrap = document.getElementById("kwrap");
  const uniqKanji = Array.from(new Set(
    Array.from(surface).filter(ch=>hasKanji(ch))
  ));

  for(const ch of uniqKanji){
    const anki = ANKI[ch];
    const db   = KANJI[ch];

    const gloss = anki
      ? (anki.mean || "")
      : (db ? [db["음"], db["훈"]].filter(Boolean).join(" / ") : "");

    const div = document.createElement("div");
    div.className = "k " + (anki ? "anki" : "db");
    div.innerHTML = `
      ${escapeHtml(ch)}
      ${gloss ? `<small>${escapeHtml(gloss)}</small>` : ""}
    `;

    div.addEventListener("click", ev=>{
      ev.stopPropagation();
      if(anki){
        // 안키쪽이면 상세 설명 토글
        let ex = subBody.querySelector(".k-explain");
        if(!ex){
          ex=document.createElement("div");
          ex.className="k-explain sub-row";
          subBody.appendChild(ex);
        }else{
          // 이미 있었으면 토글 제거/닫기
          if(ex.dataset.forChar === ch){
            ex.remove();
            return;
          }
        }
        ex.dataset.forChar = ch;
        ex.textContent = anki.explain || "(설명 없음)";
      }else{
        if(db){
          // 일반 DB만 있는 경우: 간단히 alert
          alert(`${ch} : ${gloss || ""}`);
        }else{
          // DB에도 없으면 네이버 한자사전으로
          openNaverHanja(ch);
        }
      }
    });

    kwrap.appendChild(div);
  }

  // 서브팝업 폭 조정 (한자 박스 수에 맞게)
  requestAnimationFrame(()=>{
    const need = Math.min(
      Math.max(kwrap.scrollWidth + 24, 260),
      Math.floor(window.innerWidth*0.86)
    );
    sub.style.width = need + "px";

    sub.hidden = false;
    placeSubDetached(pop, tokEl, sub, 8);
  });
}

// ===== 리레이아웃 (스크롤/리사이즈 시) =====
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden){
    placeMainPopover(currentAnchor, pop, 8);
    updateArrowEnablement();
  }
  if(currentTokenEl && !sub.hidden){
    placeSubDetached(pop, currentTokenEl, sub, 8);
  }
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});
