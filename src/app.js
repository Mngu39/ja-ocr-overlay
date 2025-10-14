// /src/app.js — 최종본
import { getImageById, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { ocrJapanese, drawBoxes } from "./ocr.js"; // drawBoxes(annos, overlay, sx, sy)
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

const editBtn    = document.getElementById("editBtn");
const editArea   = document.getElementById("editArea");
const editInput  = document.getElementById("editInput");
const saveEdit   = document.getElementById("saveEdit");
const cancelEdit = document.getElementById("cancelEdit");

// 상태
let annosGlobal = [];        // OCR 결과(원본 좌표)
let currentSentence = "";
let currentTokenEl = null;

// ---------- 유틸 ----------
function escapeHtml(s){ return (s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function hasKanji(s){ return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s); }

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
        renderOverlay(); // 표시 크기에 맞게 박스
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
  const stage = document.getElementById('stage');

  // 화면 보이는 크기
  const dw = imgEl.clientWidth;
  const dh = imgEl.clientHeight;

  // 스케일
  const sx = dw / imgEl.naturalWidth;
  const sy = dh / imgEl.naturalHeight;

  stage.style.width   = dw + 'px';
  overlay.style.width = dw + 'px';
  overlay.style.height= dh + 'px';

  if (annosGlobal.length) {
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

  // 루비/번역 병렬 로드
  (async ()=>{
    try{
      const [rubi, tr] = await Promise.all([
        getFurigana(currentSentence),
        translateJaKo(currentSentence)
      ]);

      // 한자 포함 토큰에만 루비
      const tokens = (rubi?.tokens || rubi?.result || []);
      rubyLine.innerHTML = tokens.map(t=>{
        const s = t.surface || '';
        const r = t.reading || '';
        if (hasKanji(s) && r) return `<ruby>${escapeHtml(s)}<rt>${escapeHtml(r)}</rt></ruby>`;
        return escapeHtml(s);
      }).join('');

      const translated = (tr && (tr.text || tr.result)) ? (tr.text || tr.result) : '(번역 없음)';
      transLine.textContent = translated;

      // 내용 반영 후 위치 한 번 더 보정
      requestAnimationFrame(()=> placeMainPopover(anchorEl, pop, 8));
    }catch(e){
      transLine.textContent = '(번역 실패)';
    }
  })();

  // 편집
  editBtn.onclick = ()=>{
    editInput.value = currentSentence;
    editArea.hidden = false; editInput.focus();
  };
  cancelEdit.onclick = ()=> editArea.hidden = true;
  saveEdit.onclick = ()=>{
    currentSentence = editInput.value.trim();
    openMainPopoverFor(anchorEl, currentSentence); // 갱신
    editArea.hidden = true;
  };
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
