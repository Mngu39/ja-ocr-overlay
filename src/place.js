// 팝업 배치 유틸: 메인 팝업은 상/하 중 넓은 쪽, 서브팝업은 메인 외측 하단 고정
export function placeMainPopover(anchor, pop, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });

  const r = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const topSpace = r.top - vb.offsetTop;
  const bottomSpace = (vb.offsetTop + vb.height) - (r.bottom);
  const preferTop = topSpace > bottomSpace;

  let x = r.left + (r.width - p.width)/2;
  x = Math.max(8, Math.min(x, vb.offsetLeft + vb.width - p.width - 8));

  let y;
  if (preferTop){
    y = r.top - p.height - gap;
    if (y < vb.offsetTop + 8) y = r.bottom + gap; // 상단 부족시 하단
  }else{
    y = r.bottom + gap;
    if (y + p.height > vb.offsetTop + vb.height - 8) y = r.top - p.height - gap; // 하단 부족시 상단
  }

  Object.assign(pop.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}

export function placeSubDetached(pop, tokenEl, sub, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();

  // 기본: 메인 팝업 외측 하단 오른쪽
  let x = pr.right + gap, y = pr.bottom + gap;

  // 화면 밖이면 보정
  if (x + sr.width > vb.offsetLeft + vb.width - 8) x = pr.right - sr.width; // 오른쪽 넘치면 팝업 폭 내로
  if (y + sr.height > vb.offsetTop + vb.height - 8) y = pr.top - sr.height - gap; // 아래 넘치면 위로

  Object.assign(sub.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}
