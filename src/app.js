// /src/app.js — 최종본 (번역 표시 보강, 루비=히라가나/한자만, '수정'은 시트로)
import { getImageById, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { ocrJapanese, drawBoxes } from "./ocr.js";   // drawBoxes(annos, overlay, sx, sy)
import { placeMainPopover, placeSubDetached } from "./place.js";

// DOM refs
const imgEl    = document.getElementById("img");
const overlay  = document.getElementById("overlay");
const hint     = document.getElementById("hint");
const pop      = document.getElementById("pop");
const sub      = document.getElementById("sub");

const rubyLine  = document.getElementById("rubyLine");
const origLine  = document.getElementById("origLine");
const transLine = document.getElementById("transLine");

// 편집 시트는 JS에서 동적 생성/제거
let editSheet = null;

// 상태
let annosGlobal = [];        // OCR 결과(원본 좌표)
let currentSentence = "";
let currentTokenEl = null;

// ---------- 유틸 ----------
function escapeHtml(s){ return (s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function hasKanji(s){ return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s); }
// 카타카나 → 히라가나
function kataToHira(str){
  return (str||"").replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
// 안전 번역 호출(빈 응답/오류 대비)
async function safeTranslateJaKo(text){
  try{
    const res = await translateJaKo(text.trim());
    const out = res?.text ?? res?.result ?? "";
    return out && out.trim() ? out.trim() : "(번역 없음)";
  }catch(e){ return "(번역 실패)"; }
}
// 안전 루비(히라가나 변환 + 한자에만)
async function safeFurigana(text){
  try{
    const r = await getFurigana(text);
    const tokens = r?.tokens ?? r?.result ?? [];
    return tokens.map(t=>{
      const s = t.surface || "";
      const reading = kataToHira(t.reading || "");
      if (hasKanji(s) && reading) {
        return `<ruby>${escapeHtml(s)}<rt>${escapeHtml(reading)}</rt></ruby>`;
      }
      return escapeHtml(s);
    }).join('');
  }catch(e){ return ""; }
}

// ---------- 부트스트랩 ----------
(async function bootstrap(){
  try{
    const qs = new URLSearchParams(location.search);
    const imgId = qs.get("id");
    if(!imgId) throw new Error("URL에 id 파라미터가 없습니다 (?id=...)");

    const url = await getImageById(imgId);

    imgEl.onload = async () => {
      try {
        hint.textContent = "OCR 중...";
        const annos = await ocrJapanese(url); // 원본 기준
        annosGlobal = annos;
        hint.textContent = "문장을 탭하세요";
        renderOverlay();                 // 1차
        requestAnimationFrame(renderOverlay); // 레이아웃 확정 후 2차
      } catch (e) {
        hint.textContent = "OCR 오류: " + e.message;
      }
    };

    imgEl.src = url;
  }catch(err){
    hint.textContent = "에러: " + err.message;
  }
})();

// ---------- 렌더 & 리스너 ----------
function attachBoxListeners(){
  overlay.querySelectorAll('.box').forEach(box=>{
    box.addEventListener('click', ()=>{
      overlay.querySelectorAll('.box').forEach(b=>b.classList.remove('active'));
      box.classList.add('active');
      currentSentence = box.dataset.text || "";
      openMainPopoverFor(box, currentSentence);
    });
  });
}

function renderOverlay(){
  // 화면에 실제로 보이는 이미지 크기
  const rect = imgEl.getBoundingClientRect();
  const dw = Math.max(1, Math.round(rect.width));
  const dh = Math.max(1, Math.round(rect.height));

  // ❗ stage.style.width 는 건드리지 않습니다
  overlay.style.width  = dw + 'px';
  overlay.style.height = dh + 'px';

  if (annosGlobal.length) {
    const sx = dw / imgEl.naturalWidth;
    const sy = dh / imgEl.naturalHeight;
    drawBoxes(annosGlobal, overlay, sx, sy);
    attachBoxListeners();
  }
}

// 뷰포트 변화 시 재그리기 + 팝업 재배치
const onViewportChange = ()=>{
  renderOverlay();
  const active = overlay.querySelector('.box.active');
  if (!pop.hidden && active) placeMainPopover(active, pop, 8);
  if (!sub.hidden && currentTokenEl) placeSubDetached(pop, currentTokenEl, sub, 8);
};
window.addEventListener('resize', onViewportChange, { passive:true });
globalThis.visualViewport?.addEventListener('resize', onViewportChange, { passive:true });
window.addEventListener('scroll', onViewportChange, { passive:true });

// ---------- 메인 팝업 ----------
function openMainPopoverFor(anchorEl, text){
  pop.hidden = false;

  // 팝업 폭을 문장 상자 기준으로 적절히
  const overlayW = overlay.clientWidth;
  const aw = anchorEl.getBoundingClientRect().width;
  const desired = Math.min(Math.max(Math.round(aw*1.1), 420), Math.round(overlayW*0.92));
  pop.style.width = desired + 'px';

  placeMainPopover(anchorEl, pop, 8); // 일단 배치

  // 초기화
  rubyLine.innerHTML = '';
  origLine.innerHTML = '';
  transLine.textContent = '…';
  currentSentence = text;

  // 원문(토큰 클릭 가능) — 공백 유지
  text.split(/(\s+)/).forEach(tok=>{
    if(tok==='') return;
    if(/^\s+$/.test(tok)){ origLine.appendChild(document.createTextNode(tok)); return; }
    const span = document.createElement('span');
    span.className = 'tok';
    span.textContent = tok;
    span.addEventListener('click', ()=> openSubForToken(span, tok));
    origLine.appendChild(span);
  });

  // 루비/번역 병렬 로드 (안전 버전)
  (async ()=>{
    const [rubyHtml, translated] = await Promise.all([
      safeFurigana(currentSentence),
      safeTranslateJaKo(currentSentence)
    ]);
    rubyLine.innerHTML = rubyHtml;
    transLine.textContent = translated;
    // 내용 반영 후 위치 한 번 더 보정
    requestAnimationFrame(()=> placeMainPopover(anchorEl, pop, 8));
  })();

  // 편집 버튼 → 시트 열기
  ensureEditSheet();
  editSheet.querySelector('textarea').value = currentSentence;
  editSheet.classList.add('hidden'); // 기본은 닫힘
  const openBtn = ensureTopEditButton();
  openBtn.onclick = ()=> {
    editSheet.querySelector('textarea').value = currentSentence;
    editSheet.classList.remove('hidden');
  };
}

// 메인 팝업 내 상단/우측에 작게 노출되는 '수정' 버튼 만들기
function ensureTopEditButton(){
  let btn = pop.querySelector('[data-role="open-edit"]');
  if (!btn){
    btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.position='absolute';
    btn.style.top='8px'; btn.style.right='8px';
    btn.textContent = '수정';
    btn.setAttribute('data-role','open-edit');
    pop.appendChild(btn);
  }
  return btn;
}

// 수정 시트(팝업 안에서 떠 있는 시트) 생성
function ensureEditSheet(){
  if (editSheet) return editSheet;
  editSheet = document.createElement('div');
  editSheet.className = 'edit-sheet hidden';
  editSheet.innerHTML = `
    <div class="sheet-title">원문 편집</div>
    <textarea id="editInput"></textarea>
    <div class="actions">
      <button class="btn" data-act="cancel">취소</button>
      <button class="btn primary" data-act="save">저장</button>
    </div>
  `;
  pop.appendChild(editSheet);

  // 이벤트 바인딩
  editSheet.querySelector('[data-act="cancel"]').onclick = ()=> editSheet.classList.add('hidden');
  editSheet.querySelector('[data-act="save"]').onclick = async ()=>{
    const val = editSheet.querySelector('#editInput').value.trim();
    currentSentence = val || "";
    editSheet.classList.add('hidden');

    // 원문/루비/번역 전부 갱신
    origLine.innerHTML = ''; rubyLine.innerHTML=''; transLine.textContent='…';
    if (!currentSentence){
      transLine.textContent = '(선택 없음)';
      return;
    }
    // 토큰 다시 렌더
    currentSentence.split(/(\s+)/).forEach(tok=>{
      if(tok==='') return;
      if(/^\s+$/.test(tok)){ origLine.appendChild(document.createTextNode(tok)); return; }
      const span=document.createElement('span');
      span.className='tok'; span.textContent=tok;
      span.addEventListener('click', ()=> openSubForToken(span, tok));
      origLine.appendChild(span);
    });
    // 루비/번역 다시 호출
    const [rubyHtml, translated] = await Promise.all([
      safeFurigana(currentSentence),
      safeTranslateJaKo(currentSentence)
    ]);
    rubyLine.innerHTML = rubyHtml;
    transLine.textContent = translated;
  };
  return editSheet;
}

// ---------- 서브 팝업 ----------
function openSubForToken(tokenEl, token){
  currentTokenEl = tokenEl;
  sub.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <strong style="font-size:16px">${escapeHtml(token)}</strong>
      <div style="display:flex;gap:8px">
        ${token.length===1
          ? `<a class="ext" href="javascript:void(0)" id="openHanja">네이버 한자</a>`
          : `<a class="ext" href="javascript:void(0)" id="openLemma">네이버 사전</a>`}
      </div>
    </div>
  `;
  sub.hidden = false;
  placeSubDetached(pop, tokenEl, sub, 8);

  const openLemma = document.getElementById('openLemma');
  const openHanja = document.getElementById('openHanja');
  if (openLemma) openLemma.onclick = ()=> openNaverJaLemma(token);
  if (openHanja) openHanja.onclick = ()=> openNaverHanja(token);
}
