// /src/ocr.js — 문장 박스 정확도 개선(라인 + 가로 간격 기준으로 분절)
function median(arr){ const a=[...arr].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length? (a.length%2?a[m]:(a[m-1]+a[m])/2):0; }

// Tesseract 호출 → words 추출 → 문장(세그먼트)로 병합
export async function ocrJapanese(imageUrl){
  const { data } = await Tesseract.recognize(imageUrl, 'jpn', { logger: _=>{} });
  // words(또는 symbols) 정규화
  const words = (data.words && data.words.length ? data.words : data.symbols || [])
    .map(w=>{
      const x0 = w.bbox ? w.bbox.x0 : w.x0 || w.bbox?.x;
      const y0 = w.bbox ? w.bbox.y0 : w.y0 || w.bbox?.y;
      const x1 = w.bbox ? w.bbox.x1 : (w.x0 + w.width) || (w.bbox?.x + w.bbox?.w);
      const y1 = w.bbox ? w.bbox.y1 : (w.y0 + w.height) || (w.bbox?.y + w.bbox?.h);
      const text = (w.text || w.symbol || w.word || "").trim();
      return x0!=null && y0!=null && x1!=null && y1!=null && text ? { x0, y0, x1, y1, text } : null;
    })
    .filter(Boolean);

  if (!words.length) return [];

  // 기본 통계
  const heights = words.map(w=> w.y1 - w.y0);
  const medH = Math.max(1, median(heights));
  const imgW = data.image && data.image.cols ? data.image.cols : Math.max(...words.map(w=>w.x1));

  // 1) 수평 라인으로 묶기 (y 중심이 비슷하면 같은 라인)
  const rows = [];
  words.sort((a,b)=> ((a.y0+a.y1)/2) - ((b.y0+b.y1)/2));
  const vThresh = medH * 0.60; // 라인 합치기 허용치
  for (const w of words){
    const cy = (w.y0 + w.y1)/2;
    let row = rows.find(r => Math.abs(r.cy - cy) <= vThresh);
    if (!row){
      row = { cy, items: [] };
      rows.push(row);
    }
    row.items.push(w);
    // 행 중심 재계산
    const all = row.items;
    row.cy = all.reduce((s,it)=> s + (it.y0+it.y1)/2, 0)/all.length;
  }

  // 2) 각 라인에서 좌→우 정렬 후 “큰 가로 간격”으로 분절
  const segs = [];
  const GAP_PX_MIN = 24;                 // 최소 간격 기준
  const GAP_W_RATIO = 0.08;              // 화면 너비 대비 간격 비율
  const GAP_H_RATIO = 1.8;               // 문자 높이 대비 간격 비율
  const gapThresh = (w)=> Math.max(GAP_PX_MIN, GAP_W_RATIO*imgW, GAP_H_RATIO*medH);

  for (const r of rows){
    r.items.sort((a,b)=> a.x0 - b.x0);
    let cur = [ r.items[0] ];
    for (let i=1;i<r.items.length;i++){
      const prev = r.items[i-1];
      const now  = r.items[i];
      const gap = now.x0 - prev.x1;
      if (gap > gapThresh(prev)){ // 충분히 멀면 새 문장
        segs.push(cur);
        cur = [now];
      }else{
        cur.push(now);
      }
    }
    if (cur.length) segs.push(cur);
  }

  // 3) 세그먼트별 bbox + 텍스트
  const annos = segs.map(seg=>{
    const x0 = Math.min(...seg.map(w=>w.x0));
    const y0 = Math.min(...seg.map(w=>w.y0));
    const x1 = Math.max(...seg.map(w=>w.x1));
    const y1 = Math.max(...seg.map(w=>w.y1));
    const text = seg.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim();
    return { text, polygon: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] };
  });

  return annos;
}

// 표시 크기에 맞게 박스 DOM 생성(스케일 적용)
export function drawBoxes(annos, overlayEl, sx=1, sy=1){
  overlayEl.innerHTML = "";
  for (const a of annos){
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
