import { getImageById, getFurigana, translateJaKo, openNaverJaLemma, openNaverHanja } from "./api.js";
import { ocrJapanese, drawBoxes } from "./ocr.js";
import { placeMainPopover, placeSubDetached } from "./place.js";

const qs = new URLSearchParams(location.search);
const imgId = qs.get("id");

const imgEl = document.getElementById("img");
const overlay = document.getElementById("overlay");
const hint = document.getElementById("hint");
const pop = document.getElementById("pop");
const sub = document.getElementById("sub");

// 탭 스위치
const tabs = pop.querySelectorAll(".pop-tabs button");
const panels = pop.querySelectorAll("[data-tabpanel]");
tabs.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabs.forEach(b=>b.classList.toggle('active', b===btn));
    panels.forEach(p=>p.hidden = p.dataset.tabpanel !== btn.dataset.tab);
  });
});

const origSpan = document.getElementById("origText");
const rubyDiv  = document.getElementById("rubyText");
const transDiv = document.getElementById("transText");
const morphWrap= document.getElementById("morphWrap");
const editBtn  = document.getElementById("editBtn");
const editArea = document.getElementById("editArea");
const editInput= document.getElementById("editInput");
const saveEdit = document.getElementById("saveEdit");
const cancelEdit = document.getElementById("cancelEdit");

let currentSentence = "";
let currentTokenEl = null;

// 이미지 로드
(async function bootstrap(){
  try{
    if(!imgId) throw new Error("URL에 id 파라미터가 없습니다 (?id=...)");
    const url = await getImageById(imgId);
    imgEl.onload = async () => {
      // 스케일 1:1로 오버레이 정렬
      document.getElementById('stage').style.width = imgEl.naturalWidth + "px";
      document.getElementById('stage').style.margin = "0 auto";
      overlay.style.width = imgEl.naturalWidth + "px";
      overlay.style.height= imgEl.naturalHeight + "px";
      hint.textContent = "OCR 중...";
      const annos = await ocrJapanese(url);
      hint.textContent = "문장을 탭하세요";
      drawBoxes(annos, overlay);

      // 클릭 핸들
      overlay.querySelectorAll('.box').forEach(box=>{
        box.addEventListener('click', (e)=>{
          currentSentence = box.dataset.text || "";
          openMainPopoverFor(box, currentSentence);
        });
      });
    };
    imgEl.src = url;
  }catch(err){
    hint.textContent = "에러: " + err.message;
  }
})();

function openMainPopoverFor(anchorEl, text){
  pop.hidden = false;
  origSpan.textContent = text;
  rubyDiv.textContent = '';
  transDiv.textContent = '';
  morphWrap.innerHTML = '';

  placeMainPopover(anchorEl, pop, 8);

  // 탭 초기화
  tabs.forEach(b=>b.classList.remove('active'));
  tabs[0].classList.add('active');
  panels.forEach(p=>p.hidden = (p.dataset.tabpanel!=='orig'));

  // 형태소 토큰(간단: 공백 기준) 클릭 → 서브팝업
  morphWrap.innerHTML = "";
  text.split(/\s+/).forEach(tok=>{
    if(!tok) return;
    const span = document.createElement('span');
    span.className = 'morph';
    span.textContent = tok;
    span.addEventListener('click', ()=> openSubForToken(span, tok));
    morphWrap.appendChild(span);
  });

  // 후리가나/번역은 탭 열릴 때 지연 호출
  pop.querySelector('button[data-tab="ruby"]').onclick = async ()=>{
    if (!rubyDiv.textContent) {
      const r = await getFurigana(currentSentence);
      // API 응답 포맷에 맞춰 간단 렌더
      rubyDiv.innerHTML = (r.tokens || r.result || [])
        .map(t => t.reading ? `<ruby>${escapeHtml(t.surface)}<rt>${escapeHtml(t.reading)}</rt></ruby>` : escapeHtml(t.surface||''))
        .join('');
    }
  };
  pop.querySelector('button[data-tab="trans"]').onclick = async ()=>{
    if (!transDiv.textContent) {
      const r = await translateJaKo(currentSentence);
      transDiv.textContent = r.text || r.result || '';
    }
  };

  // 편집
  editBtn.onclick = ()=>{
    editInput.value = currentSentence;
    editArea.hidden = false;
    editInput.focus();
  };
  cancelEdit.onclick = ()=> editArea.hidden = true;
  saveEdit.onclick = ()=>{
    currentSentence = editInput.value.trim();
    origSpan.textContent = currentSentence;
    rubyDiv.textContent = '';
    transDiv.textContent = '';
    editArea.hidden = true;
  };
}

async function openSubForToken(tokenEl, token){
  currentTokenEl = tokenEl;
  // 내용(예: 내 한자 라이브러리 연결 전까지 임시 뷰)
  const isHanja = token.length===1;
  sub.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <strong style="font-size:16px">${escapeHtml(token)}</strong>
      <div style="display:flex;gap:8px">
        ${isHanja ? `<a class="ext" href="javascript:void(0)" id="openHanja">네이버 한자</a>` : `<a class="ext" href="javascript:void(0)" id="openLemma">네이버 사전</a>`}
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

// 유틸
function escapeHtml(s){
  return (s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// 뷰포트 변화 시 재배치(팝업 열려있을 때)
globalThis.visualViewport?.addEventListener('resize', ()=>{
  if (!pop.hidden && document.querySelector('.box.active')) placeMainPopover(document.querySelector('.box.active'), pop, 8);
  if (!sub.hidden && currentTokenEl) placeSubDetached(pop, currentTokenEl, sub, 8);
}, { passive:true });
window.addEventListener('scroll', ()=>{
  if (!pop.hidden && document.querySelector('.box.active')) placeMainPopover(document.querySelector('.box.active'), pop, 8);
  if (!sub.hidden && currentTokenEl) placeSubDetached(pop, currentTokenEl, sub, 8);
}, { passive:true });

// 클릭된 박스에 active 표시 유지
overlay.addEventListener('click', e=>{
  overlay.querySelectorAll('.box').forEach(b=>b.classList.remove('active'));
  const t = e.target.closest('.box');
  if (t) t.classList.add('active');
});
