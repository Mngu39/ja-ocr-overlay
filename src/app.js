// app.js — overlay 부트스트랩 + 팝업/토큰/연결모드
import { getImageById, gcvOCR, furigana, translateJaKo } from "./api.js";
import { placeMainPopup, placeSubPopup } from "./place.js";

// ────────────────────────────────────────────────────────────
// 유틸
const esc = (s="") => s.replace(/[&<>"']/g, m=>({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
const kataToHira = (s="") => s.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const hasKanji = (s="") => /[\u4E00-\u9FFF]/.test(s);

// 토큰 → ru​by HTML (각 토큰을 .tok 래퍼로 감싸 클릭 대상 고정)
function buildRuby(tokens) {
  return tokens.map((t, i) => {
    const surf = t.surface || t.text || t.form || t.word || "";
    const read = kataToHira(t.reading || t.read || t.yomi || "");
    const body = (hasKanji(surf) && read)
      ? `<ruby>${esc(surf)}<rt>${esc(read)}</rt></ruby>`
      : esc(surf);
    return `<span class="tok" data-i="${i}">${body}</span>`;
  }).join("");
}

// 서브팝업 콘텐츠(간단형 – 필요 시 확장)
function buildSubPopupHTML(t) {
  const surf = t.surface || t.text || t.form || t.word || "";
  const read = kataToHira(t.reading || t.read || t.yomi || "");
  const base = t.base || t.lemma || t.dictionary_form || "";
  const pos  = t.pos || t.partOfSpeech || t.tag || "";
  const navLink = hasKanji(surf)
    ? `<a class="ext" href="https://hanja.dict.naver.com/search?query=${encodeURIComponent(surf)}" target="_blank" rel="noopener">네이버 사전</a>`
    : "";
  return `
    <div class="sub-wrap">
      <div class="sub-h"><span>형태소</span></div>
      <div class="sub-row"><b>표면</b> ${esc(surf)}</div>
      <div class="sub-row"><b>독음</b> ${esc(read)}</div>
      ${base ? `<div class="sub-row"><b>원형</b> ${esc(base)}</div>` : ""}
      ${pos  ? `<div class="sub-row"><b>품사</b> ${esc(pos)}</div>` : ""}
      <div class="sub-actions">${navLink}</div>
    </div>`;
}

// ────────────────────────────────────────────────────────────
// 전역 상태
const S = {
  imgEl: null,
  viewW: 0,
  viewH: 0,
  annos: [],
  // 연결 모드 누적
  agg: { ids: [], text: "" },
  popupEl: null,
  subEl: null,
  lastTokens: [],
  // 현재 기준 박스(bbox) — 팝업 위치 계산용
  anchorBox: null
};

// 문장상자 DOM 그리기 (bbox: polygon→rect 추정)
function drawBoxes(annos) {
  const layer = document.getElementById("boxes") || (() => {
    const d = document.createElement("div");
    d.id = "boxes";
    d.className = "boxes-layer";
    document.body.appendChild(d);
    return d;
  })();
  layer.innerHTML = "";
  annos.forEach((a, idx) => {
    const vs = a.polygon || [];
    const xs = vs.map(v => v[0]); const ys = vs.map(v => v[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(...xs) - x, h = Math.max(...ys) - y;

    const b = document.createElement("div");
    b.className = "box";
    b.style.left = `${x}px`; b.style.top = `${y}px`;
    b.style.width = `${w}px`; b.style.height = `${h}px`;
    b.dataset.idx = idx;

    // 박스 탭 → 연결모드 반영
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onBoxTap(a, { x, y, w, h });
    });

    layer.appendChild(b);
  });
}

// 팝업 생성 (닫기 버튼만으로 닫힘)
function createPopupEl() {
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
  document.body.appendChild(el);
  // 닫기
  el.querySelector('[data-act="close"]').onclick = () => closePopup();
  // 수정
  el.querySelector('[data-act="edit"]').onclick = () => openEdit();
  // 바깥 클릭으로 닫지 않음(no backdrop close)
  return el;
}

// 팝업 열기(새 세션 시작)
function openPopup(anchorBox) {
  if (S.popupEl) S.popupEl.remove();
  S.popupEl = createPopupEl();
  S.anchorBox = anchorBox;
  placeMainPopup(S.popupEl, anchorBox, { vw: S.viewW, vh: S.viewH }); // 상/하 배치
}

// 팝업 닫기(연결모드 리셋)
function closePopup() {
  S.agg = { ids: [], text: "" };
  S.lastTokens = [];
  if (S.subEl) { S.subEl.remove(); S.subEl = null; }
  if (S.popupEl) { S.popupEl.remove(); S.popupEl = null; }
  S.anchorBox = null;
}

// 수정 팝업(간단 인라인)
function openEdit() {
  if (!S.popupEl) return;
  const areaId = "mp-edit-area";
  const orig = S.popupEl.querySelector(".mp-orig");
  const now = S.agg.text;
  const dlg = document.createElement("div");
  dlg.className = "edit-dlg";
  dlg.innerHTML = `
    <textarea id="${areaId}" rows="4">${esc(now)}</textarea>
    <div class="edit-actions">
      <button class="btn sm" data-act="apply">적용</button>
      <button class="btn sm danger" data-act="cancel">취소</button>
    </div>
  `;
  // 임시로 원문영역 위에 띄움
  orig.before(dlg);
  dlg.querySelector('[data-act="apply"]').onclick = async () => {
    const nv = dlg.querySelector("textarea").value.trim();
    if (nv) {
      S.agg.text = nv;
      await refreshPopupContents(); // 후리가나/번역 재생성
    }
    dlg.remove();
  };
  dlg.querySelector('[data-act="cancel"]').onclick = () => dlg.remove();
}

// 원문(ru​by) 클릭 시 서브팝업 — 형태소는 ru​by에만 부착됨
function wireTokenClicks() {
  const container = S.popupEl?.querySelector(".mp-orig");
  if (!container) return;
  container.onclick = (e) => {
    const tEl = e.target.closest(".tok");
    if (!tEl) return;
    const i = +tEl.dataset.i;
    const tok = S.lastTokens[i] || {};
    showSubPopup(tok);
  };
}

// 서브팝업 표시(메인팝업 외측 하단 고정)
function showSubPopup(tok) {
  if (!S.popupEl) return;
  if (!S.subEl) {
    S.subEl = document.createElement("div");
    S.subEl.className = "sub-popup";
    document.body.appendChild(S.subEl);
  }
  S.subEl.innerHTML = buildSubPopupHTML(tok);
  placeSubPopup(S.subEl, S.popupEl); // detached-bottom 고정
}

// 현재 누적 텍스트로 후리가나/번역 갱신
async function refreshPopupContents() {
  if (!S.popupEl) return;
  const t = S.agg.text;

  // 후리가나
  let rubi;
  try {
    rubi = await furigana(t);
  } catch (e) {
    rubi = {};
  }
  const tokens = (
    rubi?.tokens || rubi?.result || rubi?.morphs || rubi?.morphemes ||
    rubi?.data?.tokens || rubi?.data?.morphs || []
  );
  S.lastTokens = tokens;
  S.popupEl.querySelector(".mp-orig").innerHTML = buildRuby(tokens);
  wireTokenClicks();

  // 번역
  let tr = "";
  try {
    const r = await translateJaKo(t);
    tr = r?.text || r?.result || r?.translation || "";
  } catch (e) {
    tr = "(번역 실패)";
  }
  S.popupEl.querySelector(".mp-trans").textContent = tr;
}

// 문장상자 탭 처리: 팝업이 열려있으면 연결, 아니면 새로 열기
async function onBoxTap(anno, rect) {
  const text = (anno.text || "").trim();
  if (!text) return;

  if (!S.popupEl) {
    // 새 세션
    S.agg = { ids: [rect], text };
    openPopup(rect);
  } else {
    // 연결 모드: 누적
    S.agg.ids.push(rect);
    S.agg.text += text; // 일본어는 공백 없이 자연 연결
  }
  await refreshPopupContents();
}

// 이미지/페이지 초기화
async function bootstrap() {
  // 뷰포트 기준 크기
  S.viewW = document.documentElement.clientWidth;
  S.viewH = document.documentElement.clientHeight;

  // URL의 id 파라미터로 이미지 로드
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    document.body.innerHTML = `<div class="hint">id가 없습니다.</div>`;
    return;
  }

  // 이미지 태그
  const img = new Image();
  img.id = "screenshot";
  img.alt = "screenshot";
  img.onload = async () => {
    S.imgEl = img;
    // OCR
    try {
      S.annos = await gcvOCR(id);
    } catch (e) {
      S.annos = [];
    }
    drawBoxes(S.annos);
  };
  img.src = await getImageById(id);
  document.body.appendChild(img);

  // 배경 클릭해도 닫지 않음(요청사항) — 아무 동작 X
}
bootstrap();
