// /src/ocr.js — 안정판: Tesseract "lines" 단위 그대로 사용

// 이미지 → 일본어 OCR (라인 단위 결과)
export async function ocrJapanese(imageUrl){
  // psm은 기본 AUTO. 특별히 건드리지 않습니다.
  const { data } = await Tesseract.recognize(imageUrl, 'jpn', { logger: _=>{} });

  // Tesseract.js는 data.lines 배열에 한 줄씩 들어옵니다.
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const annos = [];

  for (const ln of lines){
    const text = (ln.text || "").trim();
    // 너무 짧거나 신뢰도 낮은 라인은 제외
    const conf = typeof ln.confidence === 'number' ? ln.confidence : 100;
    if (!text || text.length < 2 || conf < 55) continue;

    // bbox 정규화
    const b = ln.bbox || ln;
    const x0 = b.x0 ?? b.x ?? (ln.x0);
    const y0 = b.y0 ?? b.y ?? (ln.y0);
    const x1 = b.x1 ?? (b.x + b.w) ?? (ln.x1 ?? (ln.x0 + ln.width));
    const y1 = b.y1 ?? (b.y + b.h) ?? (ln.y1 ?? (ln.y0 + ln.height));
    if ([x0,y0,x1,y1].some(v => v == null)) continue;

    annos.push({
      text,
      // 사각형 꼭짓점 (원본 해상도 기준)
      polygon: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
    });
  }

  return annos;
}

// 표시 크기에 맞춰 상자 DOM 생성 (스케일 적용)
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
