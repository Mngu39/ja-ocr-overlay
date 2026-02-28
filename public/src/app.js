import {
  getImageById,
  gcvOCR,
  getFurigana,
  translateJaKo,
  openNaverJaLemma,
} from "./api.js";
import { placeMainPopover } from "./place.js";

const stage     = document.getElementById("stage");
const imgEl     = document.getElementById("img");
const overlay   = document.getElementById("overlay");
const hint      = document.getElementById("hint");

const pop       = document.getElementById("pop");
const popBody   = document.getElementById("popBody");
const viewSentence = document.getElementById("viewSentence");
const viewToken    = document.getElementById("viewToken");

const btnBack   = document.getElementById("btnBack");
const btnFwd    = document.getElementById("btnFwd");
const btnGhost  = document.getElementById("btnGhost");
const btnEdit   = document.getElementById("btnEdit");
const btnClose  = document.getElementById("btnClose");

const rubyLine  = document.getElementById("rubyLine");
const transLine = document.getElementById("transLine");

const editDlg   = document.getElementById("editDlg");
const editInput = document.getElementById("editInput");
const editOkBtn = document.getElementById("editOk");

const subHead   = document.getElementById("subHead");
const kwrapDiv  = document.getElementById("kwrap");
const kExplain  = document.getElementById("kExplain");

// ===== 상태 =====
let annos = [];            // [{text, polygon:[[x,y]..]}, ...]
let selectedIdxs = [];     // [idx, ...] (선택 순서)
let ghostMode = false;

let lastToken = null;      // {surface, lemma, reading}
let inTokenView = false;

// ===== Kanji DBs =====
let KANJI = {};            // attr
let ANKI  = {};            // deck (anki)

// ===== 유틸 =====
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[m]));
const stripHtml = s => (s||"").toString().replace(/<[^>]+>/g,"").trim();
const hasKanji = s => /[\u3400-\u9FFF]/.test(s||"");
const kataToHira = s =>
  (s||"").replace(/[\u30a1-\u30f6]/g, ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));

function nl2br(s){ return escapeHtml(s).replace(/\n/g,"<br>"); }

function getVB(){
  return (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });
}

function uniq(arr){
  return Array.from(new Set(arr));
}

// ====== 사용량 카운트 =====
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

// ====== DB 로드: 텍스트번역기(Test-deepl-furigana) 우선, 실패 시 로컬 폴백 =====
async function fetchFirstJson(urls){
  for(const url of urls){
    try{
      const r = await fetch(url, { cache:"no-store" });
      if(r.ok) return await r.json();
    }catch{ /* ignore */ }
  }
  return null;
}

function parseCrowdAnki(deck){
  if(!deck) return {};
  const midToFieldNames = {};
  const models = deck.note_models || deck.models || [];
  for(const m of models){
    const mid = m.id ?? m.mid ?? m.modelId;
    const flds = m.flds || m.fields || [];
    const names = flds.map(f => (f.name||f.fldName||"").toString());
    if(mid!=null) midToFieldNames[mid] = names;
  }

  const candidatesExpr = ["Expression","Kanji","漢字","한자","표현","expression"];
  const candidatesMeaning = ["Meaning","훈음","뜻","meaning","Gloss","gloss"];
  const candidatesExplain = ["Explain","설명","비고","Notes","note","explain"];
  const candidatesUnit = ["Unit","순번","번호","unit"];
  const candidatesTheme = ["Kanji Theme","Theme","목차","theme","kanji theme"];

  const pickIndex = (names, candidates) => {
    const lower = names.map(n=>n.toLowerCase());
    for(const c of candidates){
      const i = lower.indexOf(c.toLowerCase());
      if(i>=0) return i;
    }
    // 느슨한 포함 검색
    for(const c of candidates){
      const cc = c.toLowerCase();
      const i = lower.findIndex(n => n.includes(cc));
      if(i>=0) return i;
    }
    return -1;
  };

  const out = {};
  const stack=[deck];
  while(stack.length){
    const node = stack.pop();
    if(Array.isArray(node?.children)) stack.push(...node.children);
    const notes = node?.notes || node?.cards || [];
    if(Array.isArray(notes)){
      for(const n of notes){
        const f = n.fields || n.flds || [];
        const mid = n.mid ?? n.modelId ?? n.note_model_id;
        const names = midToFieldNames[mid] || [];
        const idxExpr = pickIndex(names, candidatesExpr);
        const idxMeaning = pickIndex(names, candidatesMeaning);
        const idxExplain = pickIndex(names, candidatesExplain);
        const idxUnit = pickIndex(names, candidatesUnit);
        const idxTheme = pickIndex(names, candidatesTheme);

        // 폴백(구버전 덱)
        const expr = stripHtml(f[idxExpr>=0?idxExpr:1] ?? "");
        if(!expr || expr.length!==1) continue;

        const mean = stripHtml(f[idxMeaning>=0?idxMeaning:2] ?? "");
        let explain = stripHtml(f[idxExplain>=0?idxExplain:3] ?? "");

        const unit = stripHtml(f[idxUnit] ?? "");
        const theme = stripHtml(f[idxTheme] ?? "");
        if(!explain){
          const line = [theme, unit?`#${unit}`:""].filter(Boolean).join(" ");
          explain = line;
        }

        if(!out[expr]) out[expr] = { mean, explain, unit, theme };
      }
    }
  }
  return out;
}

async function loadDBs(){
  const base = "https://mngu39.github.io/Test-deepl-furigana";
  const [j1, j2] = await Promise.all([
    fetchFirstJson([`${base}/kanji_ko_attr_irreg.min.json`, "./kanji_ko_attr_irreg.min.json"]),
    fetchFirstJson([`${base}/deck.json`, "./일본어_한자_암기박사/deck.json"]),
  ]);

  if(j1) KANJI = j1 || {};
  if(j2) ANKI = parseCrowdAnki(j2);
}
const DB_READY = loadDBs();

// ===== OCR: soft 줄바꿈 병합 (문단 내 엔터 1회 느낌) =====
function mergeSoftLineBreakAnnots(list){
  if(!Array.isArray(list) || list.length<=1) return list || [];
  // polygon bbox 계산
  const withBox = list.map((a,i)=>{
    const v = a.polygon || [];
    const xs = v.map(p=>p[0]||0), ys = v.map(p=>p[1]||0);
    const l = Math.min(...xs), r=Math.max(...xs);
    const t = Math.min(...ys), b=Math.max(...ys);
    return {...a, _i:i, _l:l,_r:r,_t:t,_b:b, _w:r-l, _h:b-t};
  }).sort((a,b)=> (a._t-b._t) || (a._l-b._l));

  const out=[];
  for(const a of withBox){
    const prev = out[out.length-1];
    if(!prev){
      out.push(a);
      continue;
    }
    // 같은 문단의 줄바꿈으로 보이면 merge
    const vertGap = a._t - prev._b;
    const overlap = Math.max(0, Math.min(prev._r,a._r) - Math.max(prev._l,a._l));
    const overlapRate = overlap / Math.max(1, Math.min(prev._w, a._w));
    const leftClose = Math.abs(a._l - prev._l) <= Math.max(10, prev._w*0.08);
    const prevEndsSentence = /[。！？!?]$/.test((prev.text||"").trim());
    const isSoftBreak = (vertGap >= 0 && vertGap <= Math.max(18, prev._h*0.55)) && overlapRate>=0.55 && leftClose && !prevEndsSentence;

    if(isSoftBreak){
      // merge
      prev.text = (prev.text||"") + "\n" + (a.text||"");
      prev._l = Math.min(prev._l,a._l);
      prev._r = Math.max(prev._r,a._r);
      prev._t = Math.min(prev._t,a._t);
      prev._b = Math.max(prev._b,a._b);
      prev._w = prev._r-prev._l;
      prev._h = prev._b-prev._t;
      // polygon은 bbox로 재구성(간단히)
      prev.polygon = [[prev._l,prev._t],[prev._r,prev._t],[prev._r,prev._b],[prev._l,prev._b]];
    }else{
      out.push(a);
    }
  }
  // 원본 속성 정리
  return out.map(a=>({text:a.text, polygon:a.polygon}));
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
        annos = mergeSoftLineBreakAnnots(await gcvOCR(id));
        if(!annos.length){
          hint.textContent="문장을 찾지 못했습니다.";
          return;
        }
        hint.textContent="문장상자를 탭하세요";
        renderOverlay(true);
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
function renderOverlay(keepSelection=false){
  const rect=imgEl.getBoundingClientRect();
  overlay.style.width  = rect.width +"px";
  overlay.style.height = rect.height+"px";

  const sx = rect.width  / imgEl.naturalWidth;
  const sy = rect.height / imgEl.naturalHeight;

  overlay.innerHTML="";
  for(let i=0;i<annos.length;i++){
    const a = annos[i];
    const [p0,p1,p2,p3]=a.polygon;
    const l=Math.min(p0[0],p3[0])*sx;
    const t=Math.min(p0[1],p1[1])*sy;
    const r=Math.max(p1[0],p2[0])*sx;
    const b=Math.max(p2[1],p3[1])*sy;
    const w=Math.max(6,r-l);
    const h=Math.max(6,b-t);

    const box=document.createElement("div");
    box.className="box";
    box.dataset.idx = String(i);
    box.dataset.text = a.text||"";
    Object.assign(box.style,{
      left:l+"px",
      top:t+"px",
      width:w+"px",
      height:h+"px"
    });

    box.addEventListener("click",ev=>{
      ev.stopPropagation();
      toggleSelect(box);
    });

    overlay.appendChild(box);
  }

  if(keepSelection){
    // 선택 복원
    applySelectionVisuals();
  }else{
    selectedIdxs = [];
  }
}

function getBoxByIdx(idx){
  return overlay.querySelector(`.box[data-idx="${idx}"]`);
}

function applySelectionVisuals(){
  // 모든 박스 ord 제거/선택 해제
  overlay.querySelectorAll(".box.selected").forEach(b=>{
    b.classList.remove("selected");
    b.querySelector(".ord")?.remove();
  });

  selectedIdxs.forEach((idx,order)=>{
    const box = getBoxByIdx(idx);
    if(!box) return;
    box.classList.add("selected");
    const tag=document.createElement("span");
    tag.className="ord";
    tag.textContent=String(order+1);
    box.appendChild(tag);
  });
}

function selectedText(){
  return selectedIdxs.map(i => annos[i]?.text || "").join("");
}

function currentAnchorEl(){
  const idx = selectedIdxs[0];
  if(idx==null) return null;
  return getBoxByIdx(idx);
}

function clearSelection(){
  selectedIdxs = [];
  applySelectionVisuals();
  hidePop();
}

function toggleSelect(box){
  const idx = Number(box.dataset.idx);
  const pos = selectedIdxs.indexOf(idx);
  if(pos>=0){
    selectedIdxs.splice(pos,1);
  }else{
    selectedIdxs.push(idx);
  }
  applySelectionVisuals();

  if(selectedIdxs.length){
    if(ghostMode){
      // 선택 변경이 있으면 자동으로 불투명 복귀
      setGhost(false);
    }
    openMainFromSelection();
  }else{
    hidePop();
  }
}

function hidePop(){
  pop.hidden = true;
  setGhost(false);
  inTokenView = false;
  lastToken = null;
  updateNavButtons();
}

// ===== 메인 팝업 =====
let repositionQueued = false;
function scheduleReposition(){
  if(pop.hidden) return;
  if(repositionQueued) return;
  repositionQueued = true;
  requestAnimationFrame(()=>{
    repositionQueued=false;
    const anchor = currentAnchorEl();
    if(anchor && !pop.hidden){
      placeMainPopover(anchor, pop, 8);
    }
  });
}

function openMainFromSelection(){
  const anchor = currentAnchorEl();
  if(!anchor) return;
  openMainPopover(anchor, selectedText());
}

function setGhost(on){
  ghostMode = !!on;
  pop.classList.toggle("ghost", ghostMode);
}

btnGhost.addEventListener("click",(e)=>{
  e.stopPropagation();
  if(pop.hidden) return;
  setGhost(!ghostMode);
});

btnClose.addEventListener("click",(e)=>{
  e.stopPropagation();
  clearSelection();
});

btnEdit.addEventListener("click",(e)=>{
  e.stopPropagation();
  editInput.value = selectedText() || "";
  editDlg.showModal();
});

editOkBtn.addEventListener("click",()=>{
  const t = editInput.value.trim();
  editDlg.close();
  if(!t) return;
  const anchor = currentAnchorEl();
  if(anchor) openMainPopover(anchor, t, { forceText:t });
});

// Back/Forward: 문장뷰 <-> 토큰뷰 전환
btnBack.addEventListener("click",(e)=>{
  e.stopPropagation();
  if(inTokenView){
    showSentenceView();
  }
});
btnFwd.addEventListener("click",(e)=>{
  e.stopPropagation();
  if(!inTokenView && lastToken){
    showTokenView(lastToken, {reuse:true});
  }
});

function updateNavButtons(){
  btnBack.disabled = !inTokenView;
  btnFwd.disabled  = inTokenView || !lastToken;
}

function showSentenceView(){
  inTokenView = false;
  viewToken.hidden = true;
  viewSentence.hidden = false;
  updateNavButtons();
  scheduleReposition();
}

function showTokenView(tok, {reuse=false}={}){
  inTokenView = true;
  lastToken = tok;
  viewSentence.hidden = true;
  viewToken.hidden = false;
  updateNavButtons();
  // 토큰뷰는 내용이 길어질 수 있으므로 배치 갱신
  scheduleReposition();
  if(!reuse) fillTokenView(tok);
}

// fallback 토큰: 후리가나 없어도 먼저 clickable하게
function renderFallbackTokens(container, text){
  container.innerHTML="";
  text.split(/(\s+)/).forEach(tok=>{
    if(!tok.trim()) return;
    const span=document.createElement("span");
    span.className="tok";
    span.textContent=tok;
    span.addEventListener("click",ev=>{
      ev.stopPropagation();
      showTokenView({ surface: tok, reading:"", lemma: tok });
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
      return `<span class="tok" ${dataAttr}><ruby>${surf}<rt>${read}</rt></ruby></span>`;
    }
    return `<span class="tok" ${dataAttr}>${surf}</span>`;
  }).join("");

  container.querySelectorAll(".tok").forEach(span=>{
    span.addEventListener("click",ev=>{
      ev.stopPropagation();
      showTokenView({
        surface: span.dataset.surf || "",
        lemma:   span.dataset.lemma || span.dataset.surf || "",
        reading: span.dataset.read  || ""
      });
    });
  });
}

// 메인 팝업 실제 렌더
async function openMainPopover(anchor, text){
  pop.hidden = false;
  showSentenceView();
  setGhost(false);

  // 팝업 폭: anchor 폭 기반
  const aw = anchor.getBoundingClientRect().width;
  const overlayW = overlay.clientWidth;
  pop.style.width = Math.min(
    Math.max(Math.round(aw*1.1), 420),
    Math.round(overlayW*0.92)
  )+"px";

  // 1차 표시: fallback 토큰 / 번역 placeholder
  renderFallbackTokens(rubyLine, text);
  transLine.textContent="…";

  scheduleReposition();

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

  // 번역 도착 후 팝업이 커지면 다시 배치(원문 가림 방지)
  scheduleReposition();
}

// ===== 토큰 뷰 채우기 =====
async function fillTokenView(tok){
  const surface = tok.surface || "";
  const reading = kataToHira(tok.reading || "");
  const lemma   = tok.lemma   || surface;

  // 헤더
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

  // 단어 번역 (lemma 기준)
  try{
    const r = await translateJaKo(lemma||surface);
    const txt = r?.text || r?.result || r?.translation || "";
    const mEl = document.getElementById("subMeaning");
    if(mEl) mEl.textContent = txt || "";
  }catch{
    /* ignore */
  }

  await DB_READY;

  const uniqKanji = uniq(Array.from(surface).filter(ch=>hasKanji(ch)));

  // 박스 min-width: 가장 긴 gloss 길이 기반
  let maxGlossLen=0;
  const preview=[];
  for(const ch of uniqKanji){
    const anki = ANKI[ch];
    const db   = KANJI[ch];

    let glossText="";
    if(anki && anki.mean){
      glossText = anki.mean;
    }else if(db){
      const yomi=(db["음"]||"").toString().trim();
      const hun =(db["훈"]||"").toString().trim();
      glossText=[yomi, hun].filter(Boolean).join(" · ");
    }
    maxGlossLen = Math.max(maxGlossLen, glossText.replace(/\n/g," ").length);
    preview.push({ch, anki, db, glossText});
  }

  const minW = Math.min(240, Math.max(84, maxGlossLen*8));

  for(const item of preview){
    const {ch, anki, glossText} = item;
    const box=document.createElement("div");
    box.className="kbox " + (anki ? "anki" : "learn");
    box.style.minWidth = minW+"px";
    box.innerHTML = `
      <div class="kbox-head">${escapeHtml(ch)}</div>
      <div class="kbox-body">${escapeHtml(glossText)}</div>
    `;

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
        openNaverJaLemma(ch);
      }
      scheduleReposition();
    });

    kwrapDiv.appendChild(box);
  }

  scheduleReposition();
}

// ===== 레이아웃 이벤트 =====
function onResize(){
  renderOverlay(true);
  scheduleReposition();
}

function onScroll(){
  // 스크롤에서는 overlay 재렌더 금지(선택 DOM이 깨져서 팝업이 구석으로 튐)
  scheduleReposition();
}

window.addEventListener("resize", onResize, {passive:true});
globalThis.visualViewport?.addEventListener("resize", onResize, {passive:true});
window.addEventListener("scroll", onScroll, {passive:true});

// 팝업 크기 변화(번역 지연/토큰뷰 토글)에 대응
if(window.ResizeObserver){
  new ResizeObserver(()=>scheduleReposition()).observe(pop);
}

// 바깥 탭: 토큰뷰/문장뷰는 그대로, 선택 모드에서만 토글 버튼으로 복귀
stage.addEventListener("click",e=>{
  // 메인 팝업 닫기는 우상단 ✕로만
},{capture:false});
