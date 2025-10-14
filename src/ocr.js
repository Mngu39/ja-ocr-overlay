// /src/ocr.js — 안정 + 노이즈 필터 + 중복제거(NMS)

// 튜닝 포인트
const MIN_CONF = 70;            // 이 값보다 신뢰도 낮으면 버림
const HEIGHT_LOW = 0.55;        // (라인높이 / 중앙값) 하한
const HEIGHT_HIGH = 2.0;        // (라인높이 / 중앙값) 상한
const MIN_WIDTH_FACTOR = 1.2;   // 최소 라인 너비 = 중앙 높이 * 이 값
const REQUIRE_JAPANESE = true;  // 일본어 문자가 1개 이상 포함 요구
const NMS_IOU = 0.6;            // 박스 겹침 제거 임계치 (0~1, 클수록 엄격)

function hasJa(s){
  return /[\u3040-\u30FF\u3000-\u303F\u4E00-\u9FFF]/.test(s || "");
}
function median(a){ if(!a.length) return 0; const b=[...a].sort((x,y)=>x-y); const m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function iou(a,b){ // [x0,y0,x1,y1]
  const ix0 = Math.max(a[0], b[0]), iy0 = Math.max(a[1], b[1]);
  const ix1 = Math.min(a[2], b[2]), iy1 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const areaA = (a[2]-a[0])*(a[3]-a[1]);
  const areaB = (b[2]-b[0])*(b[3]-b[1]);
  return inter === 0 ? 0 : inter / (areaA + areaB - inter);
}

export async function ocrJapanese(imageUrl){
  const { data } = await Tesseract.recognize(imageUrl, 'jpn', { logger:_=>{} });

  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) return [];

  // 라인 높이 중앙값
  const heights = lines
    .map(ln => {
      const b = ln.bbox || ln;
      const y0 = b.y0 ?? b.y ?? ln.y0;
      const y1 = b.y1 ?? (b.y + b.h) ?? (ln.y1 ?? (ln.y0 + ln.height));
      return (y1 != null && y0 != null) ? (y1 - y0) : null;
    })
    .filter(v => v != null);
  const Hm = Math.max(1, median(heights));

  // 1) 라인 필터링
  const cand = [];
  for (const ln of lines){
    const text = (ln.text || "").trim();
    const b = ln.bbox || ln;
    const x0 = b.x0 ?? b.x ?? ln.x0;
    const y0 = b.y0 ?? b.y ?? ln.y0;
    const x1 = b.x1 ?? (b.x + b.w) ?? (ln.x1 ?? (ln.x0 + ln.width));
    const y1 = b.y1 ?? (b.y + b.h) ?? (ln.y1 ?? (ln.y0 + ln.height));
    if ([x0,y0,x1,y1].some(v => v == null)) continue;

    const w = x1 - x0, h = y1 - y0;
    const conf = typeof ln.confidence === 'number'
      ? ln.confidence
      : (Array.isArray(ln.words) && ln.words.length
          ? Math.round(ln.words.reduce((s,w)=> s + (w.confidence ?? 0), 0) / ln.words.length)
          : 100);

    if (!text || text.length < 2) continue;
    if (conf < MIN_CONF) continue;
    if (h < Hm * HEIGHT_LOW || h > Hm * HEIGHT_HIGH) continue;        // 너무 얇거나 두꺼운 라인 제거
    if (w < Hm * MIN_WIDTH_FACTOR) continue;                           // 너무 짧은 라인 제거
    if (REQUIRE_JAPANESE && !hasJa(text)) continue;                    // 일본어 미포함 제거

    cand.push({ box:[x0,y0,x1,y1], text, conf });
  }
  if (!cand.length) return [];

  // 2) 중복 제거(NMS) — 많이 겹치는 박스는 신뢰도 높은 것만 남김
  cand.sort((a,b)=> b.conf - a.conf);
  const kept = [];
  for (const c of cand){
    let overlapped = false;
    for (const k of kept){
      if (iou(c.box, k.box) > NMS_IOU) { overlapped = true; break; }
    }
    if (!overlapped) kept.push(c);
  }

  // 3) Anno 변환
  return kept.map(k => ({
    text: k.text,
    polygon: [[k.box[0],k.box[1]],[k.box[2],k.box[1]],[k.box[2],k.box[3]],[k.box[0],k.box[3]]]
  }));
}

// 표시 크기 스케일 적용
export function drawBoxes(annos, overlayEl, sx=1, sy=1){
  overlayEl.innerHTML = "";
  for (const a of annos){
    const [p0,p1,p2,p3] = a.polygon;
    const l = Math.min(p0[0], p3[0]) * sx;
    const t = Math.min(p0[1], p1[1]) * sy;
    const r = Math.max(p1[0], p2[0]) * sx;
    const b = Math.max(p2[1], p3[1]) * sy;

    const box = document.createElement('div');
    box.className = 'box';
    Object.assign(box.style, {
      left:   l + 'px',
      top:    t + 'px',
      width:  (r - l) + 'px',
      height: (b - t) + 'px'
    });
    box.dataset.text = a.text;
    overlayEl.appendChild(box);
  }
}
