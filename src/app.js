// /src/app.js  — 최종본
import { getImageById, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { ocrJapanese, drawBoxes } from "./ocr.js";   // ← drawBoxes는 (annos, overlay, sx, sy)
import { placeMainPopover, placeSubDetached } from "./place.js";

// DOM refs
const imgEl = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint = document.getElementById("hint");
const pop = document.getElementById("pop");
const sub = document.getElementById("sub");
const rubyLine  = document.getElementById("rubyLine");
const origLine  = document.getElementById("origLine");
const transLine = document.getElementById("transLine");

// 탭
const tabs = pop.querySelectorAll(".pop-tabs button");
const panels = pop.querySelectorAll("[data-tabpanel]");
tabs.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabs.forEach(b=>b.classList.toggle('active', b===btn));
    panels.forEach(p=>p.hidden = p.dataset.tabpanel !== btn.dataset.tab);
  });
});

// 팝업 내부 refs
const origSpan   = document.getElementById("origText");
const rubyDiv    = document.getElementById("rubyText");
const transDiv   = document.getElementById("transText");
const morphWrap  = document.getElementById("morphWrap");
const editBtn    = document.getElementById("editBtn");
const editArea   = document.getElementById("editArea");
const editInput  = document.getElementById("editInput");
const saveEdit   = document.getElementById("saveEdit");
const cancelEdit = document.getElementById("cancelEdit");

// 상태
let annosGlobal = [];        // OCR 결과(원본 해상도 좌표)
let currentSentence = "";
let currentTokenEl = null;

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
        // 1) OCR (원본 해상도 기준)
        const annos = await ocrJapanese(url);
        annosGlobal = annos;

        // 2) 표시 크기에 맞춰 렌더
        hint.textContent = "문장을 탭하세요";
        renderOverlay();
        wireClicks();
      } catch (e) {
        hint.textContent = "OCR 오류: " + e.message;
      }
    };

    imgEl.src = url;  // 이미지 로드 트리거
  }catch(err){
    hint.textContent = "에러: " + err.message;
  }
})();

// ---------- 렌더 & 이벤트 ----------
function renderOverlay(){
  const stage = document.getElementById('stage');

  // 화면에 “보이는 크기”
  const dw = imgEl.clientWidth;
  const dh = imgEl.clientHeight;

  // 원본 대비 스케일
  const sx = dw / imgEl.naturalWidth;
  const sy = dh / imgEl.naturalHeight;

  // 컨테이너 사이즈 동기화
  stage.style.width   = dw + 'px';
  overlay.style.width = dw + 'px';
  overlay.style.height= dh + 'px';

  // 박스 리렌더
  if (annosGlobal.length) {
    drawBoxes(annosGlobal, overlay, sx, sy);
  }
}

// 박스 클릭 핸들 연결
function wireClicks(){
  overlay.querySelectorAll('.box').forEach(box=>{
    box.addEventListener('click', ()=>{
      overlay.querySelectorAll('.box').forEach(b=>b.classList.remove('active'));
      box.classList.add('active');
      currentSentence = box.dataset.text || "";
      openMainPopoverFor(box, currentSentence);
    });
  });
}

// ---------- 메인 팝업 ----------
function openMainPopoverFor(anchorEl, text){
  pop.hidden = false;
  placeMainPopover(anchorEl, pop, 8);

  // 초기화
  rubyLine.innerHTML = '';
  origLine.innerHTML = '';
  transLine.textContent = '';
  currentSentence = text;

  // 1) 원문 렌더(클릭 가능한 토큰)
  // 우선 공백 기준으로 토큰화. 이후 furigana 응답이 오면 대체 가능.
  text.split(/(\s+)/).forEach(tok=>{
    if (!tok) return;
    if (/^\s+$/.test(tok)){ origLine.appendChild(document.createTextNode(tok)); return; }
    const span = document.createElement('span');
    span.className = 'tok';
    span.textContent = tok;
    span.addEventListener('click', ()=> openSubForToken(span, tok));
    origLine.appendChild(span);
  });

  // 2) 비동기: 후리가나 + 번역 병렬 로드
  (async ()=>{
    try{
      const [rubi, tr] = await Promise.all([
        getFurigana(currentSentence),
        translateJaKo(currentSentence)
      ]);

      // 후리가나: 위 라인에 작게
      rubyLine.innerHTML = (rubi.tokens || rubi.result || [])
        .map(t => t.reading
          ? `<ruby>${escapeHtml(t.surface)}<rt>${escapeHtml(t.reading)}</rt></ruby>`
          : escapeHtml(t.surface||'')
        ).join('');

      // 번역
      transLine.textContent = tr.text || tr.result || '';
    }catch(e){
      // 조용히 실패 허용
    }
  })();

  // 3) 편집(UI 동일)
  editBtn.onclick = ()=>{
    editInput.value = currentSentence;
    editArea.hidden = false; editInput.focus();
  };
  cancelEdit.onclick = ()=> editArea.hidden = true;
  saveEdit.onclick = ()=>{
    currentSentence = editInput.value.trim();
    // 원문/루비/번역 초기화 후 재요청
    openMainPopoverFor(anchorEl, currentSentence);
    editArea.hidden = true;
  };
}

// ---------- 서브 팝업 ----------
async function openSubForToken(tokenEl, token){
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
    <div style="margin-top:8px; line-height:1.6">
      <em>설명(샘플):</em> 선택된 형태소에 대한 뜻/품사/읽기/한자 메타를 여기에 렌더합니다.
    </div>
  `;
  sub.hidden = false;
  placeSubDetached(pop, tokenEl, sub, 8);

  const openLemma = document.getElementById('openLemma');
  const openHanja = document.getElementById('openHanja');
  if (openLemma) openLemma.onclick = ()=> openNaverJaLemma(token);
  if (openHanja) openHanja.onclick = ()=> openNaverHanja(token);
}

// ---------- 유틸 & 리스너 ----------
function escapeHtml(s){
  return (s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// 화면/뷰포트 변화 시 재렌더 + 팝업 재배치
const onViewportChange = ()=>{
  renderOverlay();
  const active = overlay.querySelector('.box.active');
  if (!pop.hidden && active) placeMainPopover(active, pop, 8);
  if (!sub.hidden && currentTokenEl) placeSubDetached(pop, currentTokenEl, sub, 8);
};
window.addEventListener('resize', onViewportChange, { passive:true });
globalThis.visualViewport?.addEventListener('resize', onViewportChange, { passive:true });
window.addEventListener('scroll', onViewportChange, { passive:true });
