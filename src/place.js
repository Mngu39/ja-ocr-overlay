// 메인 팝업: 상/하 우선 배치(기존 유지)
export function placeMainPopover(anchor, pop, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const r = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();

  const topSpace = r.top - vb.offsetTop;
  const bottomSpace = (vb.offsetTop + vb.height) - r.bottom;
  const preferTop = topSpace > bottomSpace;

  let x = r.left + (r.width - p.width)/2;
  x = Math.max(vb.offsetLeft + 8, Math.min(x, vb.offsetLeft + vb.width - p.width - 8));

  let y;
  if (preferTop){ y = r.top - p.height - gap; if (y < vb.offsetTop + 8) y = r.bottom + gap; }
  else { y = r.bottom + gap; if (y + p.height > vb.offsetTop + vb.height - 8) y = r.top - p.height - gap; }

  Object.assign(pop.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}

// 서브 팝업: 메인 팝업 "외측 하단" 기본, 토큰 x중심 정렬 → 부족 시 상단
export function placeSubDetached(pop, tokenEl, sub, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const pr = pop.getBoundingClientRect();
  const tr = tokenEl.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();

  // 토큰의 x중심을 팝 내부 좌표로 정규화
  const tokenCenterX = Math.min(Math.max(tr.left, pr.left), pr.right) + Math.min(tr.width, pr.width)/2;
  let x = tokenCenterX - sr.width/2;
  // 뷰포트 기준 좌우 클램프
  x = Math.max(vb.offsetLeft + 8, Math.min(x, vb.offsetLeft + vb.width - sr.width - 8));

  // 기본: 팝 하단 외측, 공간 부족 시 상단
  let y = pr.bottom + gap;
  if (y + sr.height > vb.offsetTop + vb.height - 8) y = pr.top - sr.height - gap;

  Object.assign(sub.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}
