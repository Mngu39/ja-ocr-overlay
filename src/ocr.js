// 일본어 OCR: Tesseract.js 래퍼 + 간단 문장 그룹화
export async function ocrJapanese(src){
  const worker = await Tesseract.createWorker('jpn'); // Web Worker 자동
  const { data } = await worker.recognize(src);
  await worker.terminate();

  // words → lines → 간단 문장(구두점 기준 병합)
  const lines = data.lines || [];
  const annos = [];
  for (const ln of lines) {
    const text = ln.text.trim();
    if (!text) continue;
    const b = ln.bbox; // {x0,y0,x1,y1}
    const polygon = [
      [b.x0, b.y0],[b.x1, b.y0],[b.x1, b.y1],[b.x0, b.y1]
    ];
    annos.push({
      id: crypto.randomUUID(),
      polygon,
      text,
      conf: ln.confidence ?? 0.9,
      writingMode: 'horizontal'
    });
  }
  return annos;
}

// 박스 DOM 생성 (표시 크기에 맞게 스케일)
export function drawBoxes(annos, overlayEl, sx = 1, sy = 1){
  overlayEl.innerHTML = "";
  for (const a of annos) {
    const [p0,p1,p2,p3] = a.polygon;
    const left   = Math.min(p0[0], p3[0]) * sx;
    const top    = Math.min(p0[1], p1[1]) * sy;
    const right  = Math.max(p1[0], p2[0]) * sx;
    const bottom = Math.max(p2[1], p3[1]) * sy;

    const box = document.createElement('div');
    box.className = 'box';
    Object.assign(box.style, {
      left:  left + 'px',
      top:   top + 'px',
      width: (right - left) + 'px',
      height:(bottom - top) + 'px'
    });
    box.dataset.text = a.text;
    overlayEl.appendChild(box);
  }
}

