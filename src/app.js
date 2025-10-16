// ✅ 기존 import 유지
import { getImageById, gcvOCR, furigana, translateJaKo } from "./api.js";
import { placeMainPopup, placeSubPopup } from "./place.js";

/* -------------------- 최소 유틸 (추가) -------------------- */
const esc = (s="") => s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
const kataToHira = (s="") => s.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const hasKanji = (s="") => /[\u4E00-\u9FFF]/.test(s);

/** 토큰 → ruby HTML (형태소 클릭 가능하도록 .tok 래퍼) */
function buildRuby(tokens){
  return tokens.map((t,i)=>{
    const surf = t.surface || t.text || t.form || t.word || "";
    const read = kataToHira(t.reading || t.read || t.yomi || "");
    const body = (hasKanji(surf) && read)
      ? `<ruby>${esc(surf)}<rt>${esc(read)}</rt></ruby>`
      : esc(surf);
    return `<span class="tok" data-i="${i}">${body}</span>`;
  }).join("");
}

/* -------------------- 전역 상태 (추가) -------------------- */
const S = {
  annos: [],
  imgEl: null,
  vw: 0, vh: 0,
  // 연결 모드 누적
  aggText: "",
  // 팝업/서브팝업
  popupEl: null,
  subEl: null,
  // 마지막 토큰(서브팝업 데이터)
  tokens: [],
  // 팝업 기준 박스(상/하 배치용)
  anchorBox: null,
};

/* -------------------- 박스 그리기 (기존 함수에 이벤트만 연결) -------------------- */
function drawBoxes(annos){
  let layer = document.getElementById("boxes");
  if(!layer){
    layer = document.createElement("div");
    layer.id = "boxes";
    layer.className = "boxes-layer";
    document.body.appendChild(layer);
  }
  layer.innerHTML = "";

  annos.forEach((a, idx)=>{
    const vs = a.polygon || [];
    const xs = vs.map(v=>v[0]); const ys = vs.map(v=>v[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(...xs) - x, h = Math.max(...ys) - y;

    const el = document.createElement("div");
    el.className = "box";
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.width = `${w}px`; el.style.height = `${h}px`;
    el.dataset.idx = idx;

    // ✅ 최소 변경: 박스 클릭 시 연결 모드 동작
    el.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      onBoxTap(a, {x,y,w,h});
    });

    layer.appendChild(el);
  });
}

/* -------------------- 팝업 최소 구현 (중복 제거) -------------------- */
function ensurePopup(anchorBox){
  if (!S.popupEl){
    const el = document.createElement("div");
    el.className = "main-popup";
    el.innerHTML = `
      <div class="mp-head">
        <div class="mp-title">원문</div>
        <div class="mp-actions">
          <button class="btn sm" data-act="edit">수정</button>
          <button class="btn sm danger" data-act="close">닫기</button>
        </div>
      </div>
      <div class="mp-orig"></div>
      <div class="mp-sec">
        <div class="mp-st">번역</div>
        <div class="mp-trans"></div>
      </div>
    `;
    // 닫기 버튼으로만 닫힘 (배경 탭 닫기 없음)
    el.querySelector('[data-act="close"]').onclick = closePopup;
    el.querySelector('[data-act="edit"]').onclick = openEdit;
    document.body.appendChild(el);
    S.popupEl = el;

    // ✅ 루비(원문)에서만 형태소 서브팝업
    el.querySelector(".mp-orig").addEventListener("click", (e)=>{
      const tokEl = e.target.closest(".tok");
      if(!tokEl) return;
      const i = +tokEl.dataset.i;
      const tok = S.tokens[i] || {};
      showSubPopup(tok);
    });
  }
  S.anchorBox = anchorBox;
  // 상/하 배치 (기존 place.js 로직 사용)
  placeMainPopup(S.popupEl, anchorBox, { vw:S.vw, vh:S.vh });
}

function closePopup(){
  if (S.subEl){ S.subEl.remove(); S.subEl=null; }
  if (S.popupEl){ S.popupEl.remove(); S.popupEl=null; }
  S.aggText = "";
  S.tokens = [];
  S.anchorBox = null;
}

function openEdit(){
  if(!S.popupEl) return;
  const wrap = document.createElement("div");
  wrap.className = "edit-dlg";
  wrap.innerHTML = `
    <textarea rows="4">${esc(S.aggText)}</textarea>
    <div class="edit-actions">
      <button class="btn sm" data-act="apply">적용</button>
      <button class="btn sm danger" data-act="cancel">취소</button>
    </div>
  `;
  const orig = S.popupEl.querySelector(".mp-orig");
  orig.before(wrap);
  wrap.querySelector('[data-act="apply"]').onclick = async ()=>{
    const v = wrap.querySelector("textarea").value.trim();
    if (v){
      S.aggText = v;
      await refreshPopupContents();
    }
    wrap.remove();
  };
  wrap.querySelector('[data-act="cancel"]').onclick = ()=> wrap.remove();
}

/* -------------------- 서브팝업 (루비 토큰 전용) -------------------- */
function showSubPopup(t){
  if(!S.popupEl) return;
  if(!S.subEl){
    S.subEl = document.createElement("div");
    S.subEl.className = "sub-popup";
    document.body.appendChild(S.subEl);
  }
  const surf = t.surface || t.text || t.form || t.word || "";
  const read = kataToHira(t.reading || t.read || t.yomi || "");
  const base = t.base || t.lemma || t.dictionary_form || "";
  const pos  = t.pos  || t.partOfSpeech || t.tag || "";

  S.subEl.innerHTML = `
    <div class="sub-wrap">
      <div class="sub-h"><span>형태소</span></div>
      <div class="sub-row"><b>표면</b> ${esc(surf)}</div>
      <div class="sub-row"><b>독음</b> ${esc(read)}</div>
      ${base? `<div class="sub-row"><b>원형</b> ${esc(base)}</div>`:""}
      ${pos ? `<div class="sub-row"><b>품사</b> ${esc(pos)}</div>`:""}
      ${ hasKanji(surf)
        ? `<div class="sub-actions"><a class="ext" target="_blank" rel="noopener" href="https://hanja.dict.naver.com/search?query=${encodeURIComponent(surf)}">네이버 사전</a></div>`
        : "" }
    </div>`;
  placeSubPopup(S.subEl, S.popupEl); // detached-bottom
}

/* -------------------- 후리가나/번역 갱신 (중복 제거 핵심) -------------------- */
async function refreshPopupContents(){
  if(!S.popupEl) return;
  const t = S.aggText;

  // 후리가나(= 루비 한 번만 렌더)
  let rubi = {};
  try { rubi = await furigana(t); } catch {}
  const tokens = (
    rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes ||
    rubi?.data?.tokens || rubi?.data?.morphs || []
  );
  S.tokens = tokens;
  S.popupEl.querySelector(".mp-orig").innerHTML = buildRuby(tokens);

  // 번역
  let ko = "(번역 실패)";
  try {
    const r = await translateJaKo(t);
    ko = r?.text || r?.result || r?.translation || ko;
  } catch {}
  S.popupEl.querySelector(".mp-trans").textContent = ko;
}

/* -------------------- 연결 모드: 박스 탭 처리 -------------------- */
async function onBoxTap(anno, rect){
  const text = (anno.text || "").trim();
  if(!text) return;

  if (!S.popupEl){
    // 새 세션 시작
    S.aggText = text;
    ensurePopup(rect);
  } else {
    // 팝업 열려있으면 연결
    S.aggText += text; // 일본어 특성상 공백 없이 접합
  }
  await refreshPopupContents();
}

/* -------------------- 부트스트랩 -------------------- */
async function bootstrap(){
  S.vw = document.documentElement.clientWidth;
  S.vh = document.documentElement.clientHeight;

  const id = new URLSearchParams(location.search).get("id");
  if(!id){
    document.body.innerHTML = `<div class="hint">id가 없습니다.</div>`;
    return;
  }

  // ✅ 이미지 로딩: 예전 방식 그대로 유지 (구조 변경 없음)
  const img = new Image();
  img.id = "screenshot";
  img.alt = "screenshot";
  img.onload = async ()=>{
    S.imgEl = img;
    // OCR 호출 → 박스 렌더 (예전 흐름 그대로)
    try { S.annos = await gcvOCR(id); } catch { S.annos = []; }
    drawBoxes(S.annos);
  };
  img.onerror = ()=>{ /* 필요시 간단 경고만 */
    alert("이미지를 불러오지 못했습니다.");
  };
  img.src = await getImageById(id);   // ← 기존 그대로
  document.body.appendChild(img);

  // 배경 탭으로 닫기 없음(요청사항) → 아무 이벤트도 안 둠
}
bootstrap();
