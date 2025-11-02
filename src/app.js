import {
  getImageById,
  gcvOCR,
  getFurigana,
  translateJaKo,
  openNaverJaLemma,
  openNaverHanja
} from "./api.js";
import { placeMainPopover } from "./place.js";

const stage     = document.getElementById("stage");
const imgEl     = document.getElementById("img");
const overlay   = document.getElementById("overlay");
const hint      = document.getElementById("hint");

const pop       = document.getElementById("pop");
const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");

const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const editOkBtn = document.getElementById("editOk");

const sub       = document.getElementById("sub");
const subHead   = document.getElementById("subHead");
const kwrapDiv  = document.getElementById("kwrap");
const kExplain  = document.getElementById("kExplain");

// 현재 선택 상태
let annos = [];            // [{text, polygon:[[x,y]..]}, ...]
let selected = [];         // [{el,text}]
let currentAnchor = null;  // 항상 첫 번째 선택 박스
let currentDir = null;     // pop이 anchor 기준 어디에 붙어있는지(top/bottom/left/right)
let currentTokenObj = null;

// ===== Kanji DBs =====
// 일반 DB(KANJI): { '漢': { "음": "...", "훈": "...", ... }, ... }
// 암기 DB(ANKI):  { '漢': { mean:"...", explain:"..." }, ... }
let KANJI = {};
let ANKI  = {};

async function loadDBs(){
  try{
    const [j1, j2] = await Promise.allSettled([
      fetch("./kanji_ko_attr_irreg.min.json").then(r=>r.ok?r.json():null),
      fetch("./일본어_한자_암기박사/deck.json").then(r=>r.ok?r.json():null)
    ]);

    if(j1.status==="fulfilled" && j1.value){
      KANJI = j1.value || {};
    }

    if(j2.status==="fulfilled" && j2.value){
      const map={};
      const stack=[ j2.value ];
      while(stack.length){
        const node=stack.pop();
        if(Array.isArray(node?.children)){
          stack.push(...node.children);
        }
        if(Array.isArray(node?.notes)){
          for(const n of node.notes){
            const f=n.fields||[];
            const ch      =(f[1]??"").toString().trim();
            const mean    =(f[2]??"").toString().replace(/<[^>]+>/g,"").trim();
            const explain =(f[3]??"").toString().replace(/<[^>]+>/g,"").trim();
            if(ch && ch.length===1){
              if(!map[ch]){
                map[ch]={ mean, explain };
              }
            }
          }
        }
      }
      ANKI = map;
    }
  }catch(e){
    console.warn("DB load failed", e);
  }
}
const DB_READY = loadDBs();

// ===== 유틸 =====
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[m]));
const hasKanji = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s =>
  (s||"").replace(/[\u30a1-\u30f6]/g,
    ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
function nl2br(s){
  return escapeHtml(s).replace(/\n/g,"<br>");
}

// ===== 사용량 카운트 =====
function quotaKey(){
  const d=new Date();
  return `gcv_quota_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`;
}
function tryConsumeQuota(){
  const k=quotaKey();
  const n=+(localStorage.getItem(k)||0);
  if(n>=1000) return {ok:false,key:k,n};
  localStorage.setItem(k,n+1);
  return {ok:true,key:k,n:n+1};
}
function rollbackQuota(k){
  const n=+(localStorage.getItem(k)||1);
  localStorage.setItem(k,Math.max(0,n-1));
}

// ===== 이미지 로드 → OCR (절대진리 부분 변경 없음) =====
(async function bootstrap(){
  try{
    const qs=new URLSearchParams(location.search);
    const id=qs.get("id");
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

    // 절대 건드리지 않는 라인
    imgEl.src = await getImageById(id);

  }catch(e){
    hint.textContent = e.message;
  }
})();

// ===== OCR 박스 렌더/선택 =====
function renderOverlay(){
  const rect=imgEl.getBoundingClientRect();
  overlay.style.width  = rect.width +"px";
  overlay.style.height = rect.height+"px";

  const sx = rect.width  / imgEl.naturalWidth;
  const sy = rect.height / imgEl.naturalHeight;

  overlay.innerHTML="";
  for(const a of annos){
    const [p0,p1,p2,p3]=a.polygon;
    const l=Math.min(p0[0],p3[0])*sx;
    const t=Math.min(p0[1],p1[1])*sy;
    const r=Math.max(p1[0],p2[0])*sx;
    const b=Math.max(p2[1],p3[1])*sy;
    const w=Math.max(6,r-l);
    const h=Math.max(6,b-t);

    const box=document.createElement("div");
    box.className="box";
    Object.assign(box.style,{
      left:l+"px",
      top:t+"px",
      width:w+"px",
      height:h+"px"
    });
    box.dataset.text = a.text||"";

    box.addEventListener("click",ev=>{
      ev.stopPropagation();
      toggleSelect(box);
    });

    overlay.appendChild(box);
  }
  renumberSelected();
}

function toggleSelect(box){
  const i = selected.findIndex(x=>x.el===box);
  if(i>=0){
    // 해제
    box.classList.remove("selected");
    box.querySelector(".ord")?.remove();
    selected.splice(i,1);
  }else{
    // 선택
    selected.push({el:box, text:box.dataset.text||""});
    box.classList.add("selected");
    const tag=document.createElement("span");
    tag.className="ord";
    tag.textContent=selected.length;
    box.appendChild(tag);
  }

  renumberSelected();

  if(selected.length){
    currentAnchor = selected[0].el; // 기준은 항상 첫번째
    openMainFromSelection();
  }else{
    pop.hidden=true;
    sub.hidden=true;
  }
}

function renumberSelected(){
  selected.forEach((it,idx)=>{
    const tag=it.el.querySelector(".ord");
    if(tag) tag.textContent = idx+1;
  });
}

function selectedText(){
  return selected.map(x=>x.text).join("");
}

// ===== 메인 팝업 =====
function openMainFromSelection(){
  openMainPopover(currentAnchor, selectedText());
}

// dock: 팝업 옆에 ✕ / ✎
function ensureDock(){
  let dock = pop.querySelector(".dock");
  if(!dock){
    dock = document.createElement("div");
    dock.className="dock dock-right";

    // 닫기
    const btnClose=document.createElement("div");
    btnClose.className="dock-btn";
    btnClose.textContent="✕";
    btnClose.title="닫기";
    btnClose.addEventListener("click",e=>{
      e.stopPropagation();
      pop.hidden=true;
      sub.hidden=true;
      selected.forEach(it=>{
        it.el.classList.remove("selected");
        it.el.querySelector(".ord")?.remove();
      });
      selected=[];
    });

    // 수정
    const btnEdit=document.createElement("div");
    btnEdit.className="dock-btn";
    btnEdit.textContent="✎";
    btnEdit.title="수정";
    btnEdit.addEventListener("click",e=>{
      e.stopPropagation();
      editInput.value = selectedText() || "";
      editDlg.showModal();
    });

    dock.appendChild(btnClose);
    dock.appendChild(btnEdit);
    pop.appendChild(dock);
  }

  // dock이 화면을 벗어나면 반대편으로
  const vb=getVB();
  const pr=pop.getBoundingClientRect();
  const dockW=44;
  const canRight = (pr.right + dockW) <= (vb.offsetLeft+vb.width-8);

  dock.classList.toggle("dock-right", !!canRight);
  dock.classList.toggle("dock-left",  !canRight);
}

// 수정 다이얼로그 저장
editOkBtn.addEventListener("click",()=>{
  const t=editInput.value.trim();
  if(!t){
    editDlg.close();
    return;
  }
  editDlg.close();
  openMainPopover(currentAnchor, t); // 수정된 텍스트로 다시 렌더
});

// fallback 토큰: 후리가나 없어도 먼저 clickable하게
function renderFallbackTokens(container, text){
  container.innerHTML="";
  text.split(/(\s+)/).forEach(tok=>{
    if(!tok.trim()) return;
    const span=document.createElement("span");
    span.className="tok";
    span.lang="ja";
    span.textContent=tok;
    span.addEventListener("click",ev=>{
      ev.stopPropagation();
      openSubForToken({
        surface: tok,
        reading: "",
        lemma: tok
      });
    });
    container.appendChild(span);
  });
}

// 실제 후리가나 토큰 구성
function renderFuriganaTokens(container, tokens){
  container.innerHTML = tokens.map(t=>{
    const surf = escapeHtml(t.surface);
    const read = escapeHtml(t.reading||"");
    const dataAttr =
      `data-surf="${surf}" data-lemma="${escapeHtml(t.lemma||t.surface)}" data-read="${read}"`;
    if(hasKanji(t.surface) && t.reading){
      return `<span class="tok" lang="ja" ${dataAttr}><ruby lang="ja">${surf}<rt>${read}</rt></ruby></span>`;
    }
    return `<span class="tok" lang="ja" ${dataAttr}>${surf}</span>`;
  }).join("");

  container.querySelectorAll(".tok").forEach(span=>{
    span.addEventListener("click",ev=>{
      ev.stopPropagation();
      openSubForToken({
        surface: span.dataset.surf || "",
        lemma:   span.dataset.lemma || span.dataset.surf || "",
        reading: span.dataset.read  || ""
      });
    });
  });
}

// 메인 팝업 실제 렌더
async function openMainPopover(anchor, text){
  pop.hidden=false;
  sub.hidden=true;
  currentDir=null; // 아직 방향(위/아래/좌/우) 고정 안 함

  // 팝업 폭: anchor 폭 기반
  const aw = anchor.getBoundingClientRect().width;
  const overlayW = overlay.clientWidth;
  pop.style.width = Math.min(
    Math.max(Math.round(aw*1.1), 420),
    Math.round(overlayW*0.92)
  )+"px";

  // 일단 기본 위치로 한 번 놓고
  placeMainPopover(anchor, pop, 8);

  // 1차 표시: fallback 토큰 / 번역 placeholder
  renderFallbackTokens(rubyLine, text);
  transLine.textContent="…";

  requestAnimationFrame(()=>{
    ensureDock();
    updateArrowEnablement();
  });

  // 실제 후리가나 / 번역
  try{
    const [rubi, tr] = await Promise.all([
      getFurigana(text),
      translateJaKo(text)
    ]);

    const tokens = (rubi?.tokens ||
                    rubi?.result ||
                    rubi?.morphs ||
                    rubi?.morphemes || [])
      .map(t=>({
        surface: t.surface || t.text || "",
        reading: kataToHira(t.reading || t.read || t.kana || ""),
        lemma:   t.lemma || t.base || t.baseform ||
                 t.dict || (t.surface||t.text||"")
      }))
      .filter(t=>t.surface);

    if(tokens.length){
      renderFuriganaTokens(rubyLine, tokens);
    }

    const out = tr?.text || tr?.result || tr?.translation || "";
    transLine.textContent = out || "(번역 없음)";
  }catch(e){
    console.error(e);
    if(!transLine.textContent || transLine.textContent==="…"){
      transLine.textContent="(번역 실패)";
    }
  }

  requestAnimationFrame(()=>{
    ensureDock();
    updateArrowEnablement();
  });
}

// ===== 팝업 이동 화살표 =====
function getVB(){
  return (globalThis.visualViewport || {
    width:innerWidth,
    height:innerHeight,
    offsetTop:scrollY,
    offsetLeft:scrollX
  });
}

// anchor 기준으로 pop을 특정 방향(dir)에 "딱 붙여서" 둘 좌표 계산
function calcPosForDir(dir){
  if(!currentAnchor) return null;
  const gap=8;
  const ar=currentAnchor.getBoundingClientRect();
  const pr=pop.getBoundingClientRect();
  let left, top;

  if(dir==="top"){
    left = ar.left + (ar.width-pr.width)/2;
    top  = ar.top - pr.height - gap;
  }else if(dir==="bottom"){
    left = ar.left + (ar.width-pr.width)/2;
    top  = ar.bottom + gap;
  }else if(dir==="left"){
    left = ar.left - pr.width - gap;
    top  = ar.top + (ar.height-pr.height)/2;
  }else if(dir==="right"){
    left = ar.right + gap;
    top  = ar.top + (ar.height-pr.height)/2;
  }else{
    return null;
  }

  return {
    left: left + window.scrollX,
    top : top  + window.scrollY,
    width: pr.width,
    height: pr.height
  };
}

// dir 위치가 화면 안에 들어가는지 검사
function canPlaceDir(dir){
  const vb=getVB();
  const box=calcPosForDir(dir);
  if(!box) return false;

  const margin=8;
  const rLeft   = box.left;
  const rTop    = box.top;
  const rRight  = box.left + box.width;
  const rBottom = box.top  + box.height;

  const minX = vb.offsetLeft + margin;
  const maxX = vb.offsetLeft + vb.width  - margin;
  const minY = vb.offsetTop  + margin;
  const maxY = vb.offsetTop  + vb.height - margin;

  return (
    rLeft   >= minX &&
    rRight  <= maxX &&
    rTop    >= minY &&
    rBottom <= maxY
  );
}

// 실제로 dir로 이동
function applyDir(dir){
  const box=calcPosForDir(dir);
  if(!box) return;
  Object.assign(pop.style,{
    left:box.left+"px",
    top :box.top +"px"
  });
  currentDir=dir;

  ensureDock();
  // placeSubNearMain() removed // 서브팝업이 열려 있다면 갱신
  updateArrowEnablement();
}

// 화살표 활성/비활성
function updateArrowEnablement(){
  const topBar    = pop.querySelector(".arrow-top");
  const bottomBar = pop.querySelector(".arrow-bottom");
  const leftBar   = pop.querySelector(".arrow-left");
  const rightBar  = pop.querySelector(".arrow-right");

  if(topBar){
    const ok = canPlaceDir("top");
    topBar.classList.toggle("disabled", !ok);
  }
  if(bottomBar){
    const ok = canPlaceDir("bottom");
    bottomBar.classList.toggle("disabled", !ok);
  }
  if(leftBar){
    const ok = canPlaceDir("left");
    leftBar.classList.toggle("disabled", !ok);
  }
  if(rightBar){
    const ok = canPlaceDir("right");
    rightBar.classList.toggle("disabled", !ok);
  }
}

// 화살표 클릭
Array.from(pop.querySelectorAll(".arrow-bar")).forEach(bar=>{
  bar.addEventListener("click",e=>{
    e.stopPropagation();
    if(bar.classList.contains("disabled")) return;
    const dir=bar.dataset.dir;
    applyDir(dir);
  });
});

// ===== 서브팝업 =====
async function openSubForToken(tok){
  currentTokenObj = tok;

  const surface = tok.surface || "";
  const reading = kataToHira(tok.reading || "");
  const lemma   = tok.lemma   || surface;

  // 헤더(표면형+루비는 링크), lemma, 번역 자리
  const navUrl = `https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(lemma||surface)}`;

  subHead.innerHTML = `
    <a class="surf" href="${navUrl}" target="_blank" rel="noopener noreferrer">
      ${
        hasKanji(surface) && reading
        ? `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`
        : escapeHtml(surface)
      }
    </a>
    <span class="lemma">(${escapeHtml(lemma)})</span>
    <span id="subMeaning" class="meaning"></span>
  `;

  kwrapDiv.innerHTML = "";
  kExplain.style.display="none";
  kExplain.innerHTML="";

  // 일단 서브팝업을 바로 보이게 해서 "안 떠" 문제 제거
  sub.hidden = false;
  // placeSubNearMain() removed // 먼저 자리 잡고 시작

  // 단어 번역 (lemma 기준)
  try{
    const r = await translateJaKo(lemma||surface);
    const txt = r?.text || r?.result || r?.translation || "";
    const mEl = document.getElementById("subMeaning");
    if(mEl){
      mEl.textContent = txt || "";
    }
  }catch{
    /* ignore - 번역 실패해도 그냥 빈칸 */
  }

  // 한자 박스
  await DB_READY;
  const uniqKanji = Array.from(new Set(Array.from(surface).filter(ch=>hasKanji(ch))));

  // 박스 공통 최소폭 계산 (가장 긴 gloss 기준)
  let maxGlossLen=0;
  const previewList=[];
  for(const ch of uniqKanji){
    const anki = ANKI[ch];
    const db   = KANJI[ch];

    let glossText="";
    if(anki && anki.mean){
      glossText = anki.mean;
    }else if(db){
      // 일반 DB는 박스 안에 음/훈만 넣어줄 수 있음
      const yomi=(db["음"]||"").toString().trim();
      const hun =(db["훈"]||"").toString().trim();
      glossText=[yomi, hun].filter(Boolean).join(" · ");
    }else{
      glossText = "";
    }

    maxGlossLen=Math.max(maxGlossLen, glossText.replace(/\n/g," ").length);
    previewList.push({ ch, anki, db, glossText });
  }

  const minW = Math.min(240, Math.max(72, maxGlossLen*8));
  kwrapDiv.innerHTML="";

  for(const item of previewList){
    const {ch, anki, db, glossText} = item;

    const box=document.createElement("div");
    box.className="kbox"+(anki ? " anki" : "");
    box.style.minWidth = minW+"px";
    box.innerHTML = `
      <div class="kbox-head">${escapeHtml(ch)}</div>
      <div class="kbox-body">${nl2br(glossText)}</div>
    `;

    // 클릭 동작:
    // - 암기장(anki) 있으면: 아래 kExplain 토글 (설명 전개)
    // - 암기장에 없으면: 네이버 일본어 사전으로 이동
    box.addEventListener("click",ev=>{
      ev.stopPropagation();
      if(anki){
        if(kExplain.style.display==="none"){
          kExplain.style.display="block";
          kExplain.innerHTML = nl2br(anki.explain || "(설명 없음)");
        }else{
          kExplain.style.display="none";
          kExplain.innerHTML="";
        }
      }else{
        // anki에 없으면 그냥 일본어 사전으로
        openNaverJaLemma(ch);
      }
    });

    kwrapDiv.appendChild(box);
  }

  // 최종적으로 내용까지 다 들어간 뒤 위치 다시 조정
  // placeSubNearMain() removed
}

// 메인 팝업 우하단 대각선 쪽에 서브팝업을 놓되, 겹치지 않도록
function placeSubNearMain(){ /* sub-popup removed; integrated into main pop */ }
  if(left + sr.width > vb.offsetLeft + vb.width - 8){
    left = vb.offsetLeft + vb.width - sr.width - 8;
  }
  if(left < vb.offsetLeft + 8){
    left = vb.offsetLeft + 8;
  }
  if(top < vb.offsetTop + 8){
    top = vb.offsetTop + 8;
  }

  Object.assign(sub.style,{
    left:(left + window.scrollX)+"px",
    top :(top  + window.scrollY)+"px"
  });
}

// ===== 레이아웃 재계산 =====
function relayout(){
  renderOverlay();

  if(currentAnchor && !pop.hidden){
    if(currentDir){
      // 현재 방향 유지해서 재배치
      applyDir(currentDir);
    }else{
      // 아직 방향 고정 전이면 기본 알고리즘
      placeMainPopover(currentAnchor, pop, 8);
      ensureDock();
      updateArrowEnablement();
    }
  }

  if(!sub.hidden){
    // placeSubNearMain() removed
  }
}

window.addEventListener("resize", relayout,{passive:true});
globalThis.visualViewport?.addEventListener("resize", relayout,{passive:true});
window.addEventListener("scroll", relayout,{passive:true});

// (sub-popup removed; no background-close behavior needed for sub)

