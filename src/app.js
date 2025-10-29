// 동작 안정판 + 너가 요청한 4가지 수정만 반영
// (이미지 로딩 ~ OCR ~ 번역 ~ 후리가나 흐름은 그대로 둠)

import {
  getImageById,
  gcvOCR,
  getFurigana,
  translateJaKo,
  openNaverJaLemma,
  openNaverHanja
} from "./api.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const stage     = document.getElementById("stage");
const imgEl     = document.getElementById("img");
const overlay   = document.getElementById("overlay");
const hint      = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");

const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const btnEdit   = document.getElementById("btnEdit");
const btnClose  = document.getElementById("btnClose");
const popDrag   = document.getElementById("popDrag");

const sub       = document.getElementById("sub");
const subDrag   = document.getElementById("subDrag");
const subTitle  = document.getElementById("subTitle");
const subBody   = document.getElementById("subBody");

// 선택 관련 상태
let annos = [];          // [{ text, polygon:[[x,y],...4] }]
let selected = [];       // [{ el, text }]
let currentAnchor = null;   // 항상 "첫 번째 선택 박스"
let currentTokenEl = null;  // 서브팝업 기준 토큰

// 편집용 문장 캐시
let currentSentence = "";

// ===== Kanji DB 로드 (일반 DB + Anki DB) =====
// 일반 DB: { "漢": { "음":"...", "훈":"...", ... }, ... }
// Anki DB:  { "漢": { mean:"...", explain:"..." }, ... }
let KANJI = {};
let ANKI  = {};
async function loadDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);

    KANJI = (j1.status==="fulfilled" && j1.value) ? j1.value : {};

    if (j2.status==="fulfilled" && j2.value){
      // CrowdAnki 구조를 훑어서 { '字': {mean, explain} } 형태로 펴준다
      const map = {};
      const stack = [j2.value];
      while (stack.length){
        const node = stack.pop();
        if (Array.isArray(node?.children)) stack.push(...node.children);
        if (Array.isArray(node?.notes)){
          for (const n of node.notes){
            const f = n.fields || [];
            const ch      = (f[1] ?? "").toString().trim(); // 한자 1글자
            const mean    = (f[2] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            const explain = (f[3] ?? "").toString().replace(/<[^>]+>/g,"").trim();
            if (ch && ch.length===1){
              map[ch] = { mean, explain };
            }
          }
        }
      }
      ANKI = map;
    }else{
      ANKI = {};
    }
  }catch(e){
    console.warn("DB load failed", e);
    KANJI = {};
    ANKI  = {};
  }
}
const DB_READY = loadDBs();

// ===== 유틸 =====
const escapeHtml = s =>
  (s||"").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));

const hasKanji   = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s =>
  (s||"").replace(/[\u30a1-\u30f6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0)-0x60)
  );

// viewport helper (사이드독 위치 판단 등)
function vb(){
  return (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });
}

// 월 1,000건 로컬 카운트
function quotaKey(){
  const d = new Date();
  return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`;
}
function tryConsumeQuota(){
  const k = quotaKey();
  const n = +(localStorage.getItem(k)||0);
  if(n>=1000) return { ok:false, key:k, n };
  localStorage.setItem(k, n+1);
  return { ok:true, key:k, n:n+1 };
}
function rollbackQuota(k){
  const n=+(localStorage.getItem(k)||1);
  localStorage.setItem(k, Math.max(0,n-1));
}

// ===== bootstrap (이미지 불러오기 → OCR) =====
// !!! 이 영역은 "절대진리" 그대로 유지 !!!
(function bootstrap(){
  (async ()=>{
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
          annos = await gcvOCR(id); // [{text, polygon}, ...]
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

      // 캐시 버스터 포함. 이 라인은 손대지 않는다.
      imgEl.src = (await getImageById(id)) + `&t=${Date.now()}`;

    }catch(e){
      hint.textContent = e.message;
    }
  })();
})();

// ===== overlay(문장 상자) 렌더링 & 선택 =====
function renderOverlay(){
  const rect = imgEl.getBoundingClientRect();
  overlay.style.width  = rect.width+"px";
  overlay.style.height = rect.height+"px";

  const sx = rect.width  / imgEl.naturalWidth;
  const sy = rect.height / imgEl.naturalHeight;

  overlay.innerHTML="";
  for(const a of annos){
    const [p0,p1,p2,p3] = a.polygon;
    const l = Math.min(p0[0],p3[0]) * sx;
    const t = Math.min(p0[1],p1[1]) * sy;
    const r = Math.max(p1[0],p2[0]) * sx;
    const b = Math.max(p2[1],p3[1]) * sy;
    const w = Math.max(6, r-l);
    const h = Math.max(6, b-t);

    const box = document.createElement("div");
    box.className = "box";
    Object.assign(box.style,{
      left:l+"px", top:t+"px", width:w+"px", height:h+"px"
    });
    box.dataset.text = a.text || "";
    box.addEventListener("click", ev=>{
      ev.stopPropagation();
      toggleSelect(box);
    });
    overlay.appendChild(box);
  }
  renumberSelection();
}

function toggleSelect(box){
  const i = selected.findIndex(x=>x.el===box);
  if(i>=0){
    // 이미 선택 → 해제
    selected[i].el.classList.remove("selected");
    selected[i].el.querySelector(".ord")?.remove();
    selected.splice(i,1);
  }else{
    // 새로 선택
    selected.push({ el:box, text:box.dataset.text||"" });
    box.classList.add("selected");
    const tag=document.createElement("span");
    tag.className="ord";
    tag.textContent=selected.length;
    box.appendChild(tag);
  }

  renumberSelection();

  if(selected.length){
    currentAnchor = selected[0].el; // 첫 번째 박스를 기준 앵커로 고정
    openMainFromSelection();
  }else{
    pop.hidden = true;
    sub.hidden = true;
  }
}

function renumberSelection(){
  selected.forEach((it,i)=>{
    const tag = it.el.querySelector(".ord");
    if(tag) tag.textContent = i+1;
  });
}

function selectedText(){
  return selected.map(x=>x.text).join("");
}

// ===== 메인 팝업 =====

// 사이드 독(닫기/수정 아이콘) 처리
let dockEl = null;
function closePopover(){
  pop.hidden = true;
  sub.hidden = true;
  selected.forEach(it=>{
    it.el.classList.remove("selected");
    it.el.querySelector(".ord")?.remove();
  });
  selected = [];
}
function ensureSideDock(){
  if(!dockEl){
    dockEl = document.createElement("div");
    dockEl.className="dock";

    const btnCloseIcon=document.createElement("button");
    btnCloseIcon.className="dock-btn";
    btnCloseIcon.textContent="✕";
    btnCloseIcon.title="닫기";
    btnCloseIcon.addEventListener("click",e=>{
      e.stopPropagation();
      closePopover();
    });

    const btnEditIcon=document.createElement("button");
    btnEditIcon.className="dock-btn";
    btnEditIcon.textContent="✎";
    btnEditIcon.title="수정";
    btnEditIcon.addEventListener("click",e=>{
      e.stopPropagation();
      editInput.value = currentSentence || selectedText() || "";
      editDlg.showModal();
    });

    dockEl.appendChild(btnCloseIcon);
    dockEl.appendChild(btnEditIcon);
    pop.appendChild(dockEl);
  }

  positionDock();
}
function positionDock(){
  if(!dockEl) return;
  // 기본적으로 팝업 오른쪽 바깥(-44px)에 붙이되,
  // 화면 오른쪽 끝이라 dock이 잘리면 팝업 안쪽(8px)에 붙임
  const pr = pop.getBoundingClientRect();
  const viewportRight = vb().offsetLeft + vb().width;
  const wouldOverflow = (pr.right + 44 + 8 > viewportRight);

  if(wouldOverflow){
    dockEl.style.right = "8px";
  }else{
    dockEl.style.right = "-44px";
  }
  dockEl.style.top = "8px";
}

function openMainFromSelection(){
  const text = selectedText();
  openMainPopover(currentAnchor, text);
}

async function openMainPopover(anchor, text){
  currentSentence = text;
  pop.hidden = false;
  sub.hidden = true;

  // 팝업 폭: 기준 앵커(첫 박스) 너비 기반 + 상한/하한
  const aw = anchor.getBoundingClientRect().width;
  const overlayW = overlay.clientWidth;
  pop.style.width = Math.min(
    Math.max(Math.round(aw*1.1), 420),
    Math.round(overlayW*0.92)
  )+"px";

  // 먼저 대충 배치
  placeMainPopover(anchor, pop, 8);

  // 사이드독 생성/재배치
  ensureSideDock();

  // 본문 초기화
  rubyLine.innerHTML   = "…";
  transLine.textContent= "…";

  try{
    // 후리가나 & 번역 동시에
    const [rubi, tr] = await Promise.all([
      getFurigana(text),
      translateJaKo(text)
    ]);

    // 토큰 표준화
    const tokens = (rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes || [])
      .map(t=>({
        surface: t.surface || t.text || "",
        reading: kataToHira(t.reading || t.read || t.kana || ""),
        lemma:   t.lemma  || t.base || t.baseform || t.dict || (t.surface||t.text||"")
      }))
      .filter(t=>t.surface);

    // rubyLine 렌더링 + 각 토큰 클릭 시 서브팝업
    rubyLine.innerHTML = tokens.map(t=>{
      const surfEsc  = escapeHtml(t.surface);
      const readEsc  = escapeHtml(t.reading||"");
      const lemmaEsc = escapeHtml(t.lemma||t.surface);

      const dataAttr = `data-surf="${surfEsc}" data-lemma="${lemmaEsc}" data-read="${readEsc}"`;
      if(hasKanji(t.surface) && t.reading){
        return `<span class="tok" ${dataAttr}><ruby>${surfEsc}<rt>${readEsc}</rt></ruby></span>`;
      }
      return `<span class="tok" ${dataAttr}>${surfEsc}</span>`;
    }).join("");

    rubyLine.querySelectorAll(".tok").forEach(span=>{
      span.addEventListener("click",ev=>{
        ev.stopPropagation();
        openSubForToken(span,{
          surface: span.dataset.surf || "",
          lemma:   span.dataset.lemma || span.dataset.surf || "",
          reading: span.dataset.read || ""
        });
      });
    });

    // 번역 라인
    const out = tr?.text || tr?.result || tr?.translation || "";
    transLine.textContent = out || "(번역 없음)";

    // 최종 위치 보정(사이드독도 다시 보정)
    requestAnimationFrame(()=>{
      placeMainPopover(anchor, pop, 8);
      positionDock();
    });
  }catch(e){
    console.error(e);
    transLine.textContent="(번역 실패)";
  }
}

// ===== 수정 다이얼로그 =====
btnClose.addEventListener("click", ()=>{
  closePopover();
});
btnEdit.addEventListener("click", e=>{
  e.stopPropagation();
  editInput.value = currentSentence || selectedText() || "";
  editDlg.showModal();
});

document.getElementById("editOk").addEventListener("click", ()=>{
  const t = editInput.value.trim();
  if(!t){
    editDlg.close();
    return;
  }
  editDlg.close();
  // 수정된 문장을 다시 메인팝업에 넣어준다
  currentSentence = t;
  openMainPopover(currentAnchor, t);
});

// ===== 드래그(메인팝업/서브팝업) =====
makeDraggable(pop, popDrag);
makeDraggable(sub, subDrag);

function makeDraggable(panel, handle){
  if(!panel || !handle) return;
  let sx=0, sy=0, sl=0, st=0, dragging=false;
  handle.addEventListener("pointerdown", e=>{
    dragging=true;
    handle.setPointerCapture(e.pointerId);
    const r=panel.getBoundingClientRect();
    sx=e.clientX; sy=e.clientY;
    sl=r.left+scrollX; st=r.top+scrollY;
  });
  handle.addEventListener("pointermove", e=>{
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    panel.style.left=(sl+dx)+"px";
    panel.style.top =(st+dy)+"px";
    if(panel===pop){
      positionDock(); // 드래그 중에도 사이드독 다시 보정
    }
  });
  handle.addEventListener("pointerup",()=>{
    dragging=false;
  });
}

// ===== 바깥 클릭 시: 메인팝업은 유지, 서브팝업만 닫기 =====
document.addEventListener("click", e=>{
  if(!sub.hidden && !sub.contains(e.target)){
    sub.hidden = true;
  }
}, {capture:true});

// ===== 서브팝업 =====
// 요구사항 반영:
//  1) 형태소+후리가나+(원형) 바로 옆에 번역까지 한 줄로
//  2) 드래그용 회색 막대(정체불명의 선) 안 보이게 처리(CSS에서 투명 오버레이화)
//  3) 모르는 한자는 네이버 일본어 사전으로
//  4) 메인팝업 우하단에 붙여주되, 짧아도 너무 떨어지지 않도록 placeSubDetached() 수정 (place.js)

async function openSubForToken(tokEl, tok){
  currentTokenEl = tokEl;

  const surface = tok.surface || "";
  const reading = kataToHira(tok.reading || "");
  const lemma   = tok.lemma   || surface;

  // 1) 상단 타이틀 영역: 단어(루비) + (원형) + 번역결과까지 한 줄
  //    번역은 나중에 채워넣으니까 먼저 틀부터 렌더
  const dictUrl = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(lemma||surface)}`;

  subTitle.innerHTML = `
    <a href="${dictUrl}" target="_blank">
      ${
        hasKanji(surface) && reading
          ? `<ruby>${escapeHtml(surface)}<rt style="font-size:11px">${escapeHtml(reading)}</rt></ruby>`
          : escapeHtml(surface)
      }
      <span class="lemma">(${escapeHtml(lemma)})</span>
    </a>
    <span id="tokTrans" class="tok-trans"></span>
  `;

  // 2) 본문(한자 박스들) 영역 초기화
  subBody.innerHTML = `
    <div class="kwrap" id="kwrap"></div>
    <div class="k-explain" id="kExplain" style="display:none;"></div>
  `;

  // 3) 번역(토큰 단위) - 번역 결과를 같은 줄에 이어붙임
  try{
    const r = await translateJaKo(lemma || surface);
    const txt = r?.text || r?.result || r?.translation || "";
    const tgt = document.getElementById("tokTrans");
    tgt.textContent = txt ? ` — ${txt}` : "";
  }catch(e){
    const tgt = document.getElementById("tokTrans");
    tgt.textContent = ""; // 실패 시 그냥 비움
  }

  // 4) 한자 박스들
  await DB_READY;
  const kwrapEl   = document.getElementById("kwrap");
  const explainEl = document.getElementById("kExplain");

  const uniqKanji = Array.from(new Set(Array.from(surface).filter(ch=>hasKanji(ch))));
  for(const ch of uniqKanji){
    const anki = ANKI?.[ch];
    const db   = KANJI?.[ch];

    // 짧은 gloss 만들기
    const glossFromDB = (entry)=>{
      if(!entry) return "";
      // 다양한 키를 잡아 본다: 음/훈/뜻 등
      const cand = [
        entry["음"], entry["훈"], entry["훈2"],
        entry["뜻"], entry["mean"], entry["ko"], entry["korean"]
      ].filter(Boolean);
      return cand.join(" / ");
    };

    const gloss = anki
      ? (anki.mean || "")
      : glossFromDB(db);

    const box = document.createElement("div");
    box.className = "k " + (anki ? "anki" : (db ? "db" : "none"));
    box.innerHTML = `
      ${escapeHtml(ch)}
      ${gloss ? `<small>${escapeHtml(gloss)}</small>` : ""}
    `;

    box.addEventListener("click", ev=>{
      ev.stopPropagation();

      // ANKI에 있으면 암기 설명을 아래에 펼쳐주기
      if(anki){
        explainEl.style.display = "block";
        explainEl.textContent = anki.explain || "(설명 없음)";
        return;
      }

      // 일반 DB만 있는 경우: 그 한자의 간단 의미/훈음 등을 아래에 보여주기
      if(db){
        const g = gloss || "(정보 없음)";
        explainEl.style.display = "block";
        explainEl.textContent = `${ch} : ${g}`;
        return;
      }

      // 둘 다 없으면 네이버 일본어 사전으로 (← 요구사항)
      openNaverJaLemma(ch);
    });

    kwrapEl.appendChild(box);
  }

  // 5) 서브팝업 크기/위치 조정
  requestAnimationFrame(()=>{
    // 가로폭은 한자 박스들을 기준으로 적당히 (너무 작지도, 너무 크지도)
    const need = Math.min(
      Math.max(kwrapEl.scrollWidth + 24, 260),
      Math.floor(window.innerWidth*0.86)
    );
    sub.style.width = need + "px";

    sub.hidden = false;
    placeSubDetached(pop, tokEl, sub, 8);
  });
}

// ===== 레이아웃 재계산 (윈도우 리사이즈 / 스크롤 등) =====
function relayout(){
  renderOverlay();
  if(currentAnchor && !pop.hidden){
    placeMainPopover(currentAnchor, pop, 8);
    positionDock();
  }
  if(currentTokenEl && !sub.hidden){
    placeSubDetached(pop, currentTokenEl, sub, 8);
  }
}
addEventListener("resize", relayout, {passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout, {passive:true});
addEventListener("scroll", relayout, {passive:true});
