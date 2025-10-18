// /public/src/place.js
// 상/하 자동 배치(안정판) + (옵션) 서브팝업 분리 배치

export function placeMainPopover(anchor, pop, gap = 8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth, height: innerHeight,
    offsetTop: scrollY, offsetLeft: scrollX
  });

  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  // 상/하 중 더 넓은 공간 우선
  const topSpace    = ar.top - vb.offsetTop;
  const bottomSpace = (vb.offsetTop + vb.height) - ar.bottom;
  const preferTop   = topSpace > bottomSpace;

  // 수평 중앙 정렬 + 클램프
  let x = ar.left + (ar.width - pr.width) / 2;
  x = Math.max(vb.offsetLeft + 8, Math.min(x, vb.offsetLeft + vb.width - pr.width - 8));

  // 수직: 상단 또는 하단, 부족하면 반대편
  let y;
  if (preferTop){
    y = ar.top - pr.height - gap;
    if (y < vb.offsetTop + 8) y = ar.bottom + gap;
  }else{
    y = ar.bottom + gap;
    if (y + pr.height > vb.offsetTop + vb.height - 8) y = ar.top - pr.height - gap;
  }

  Object.assign(pop.style, {
    left: `${x + window.scrollX}px`,
    top:  `${y + window.scrollY}px`
  });
}

// (이전 호환) 서브팝업: 메인 팝업 기준 우하(불가 시 우상) 쪽에 붙임
export function placeSubDetached(pop, tokenEl, sub, gap = 8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth, height: innerHeight,
    offsetTop: scrollY, offsetLeft: scrollX
  });

  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();

  // 기본: 메인 팝업 오른쪽/아래
  let x = pr.right + gap;
  let y = pr.bottom + gap;

  // 우측 공간 부족 시, 팝업 오른쪽 가장자리 안으로 수평 조정
  if (x + sr.width > vb.offsetLeft + vb.width - 8) {
    x = pr.right - sr.width;
  }
  // 하단 공간 부족 시, 팝업 위로 올림
  if (y + sr.height > vb.offsetTop + vb.height - 8) {
    y = pr.top - sr.height - gap;
  }

  // 최종 클램프
  x = Math.max(vb.offsetLeft + 8, Math.min(x, vb.offsetLeft + vb.width - sr.width - 8));
  y = Math.max(vb.offsetTop  + 8, Math.min(y, vb.offsetTop  + vb.height - sr.height - 8));

  Object.assign(sub.style, {
    left: `${x + window.scrollX}px`,
    top:  `${y + window.scrollY}px`
  });
}
