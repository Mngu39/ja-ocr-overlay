// 메인 팝업 기본 배치:
// anchor(문장박스) 주변 위/아래 중 더 여유 있는 쪽에 붙이고
// 가로는 anchor 중앙 맞추되 화면 밖으로는 최소화
export function placeMainPopover(anchor, pop, gap = 8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  const topSpace    = ar.top    - vb.offsetTop;
  const bottomSpace = (vb.offsetTop + vb.height) - ar.bottom;
  const preferTop   = topSpace > bottomSpace;

  let x = ar.left + (ar.width - pr.width)/2;
  x = Math.max(
    vb.offsetLeft + 8,
    Math.min(x, vb.offsetLeft + vb.width - pr.width - 8)
  );

  let y;
  if (preferTop){
    y = ar.top - pr.height - gap;
    if (y < vb.offsetTop + 8){
      // fallback bottom
      y = ar.bottom + gap;
    }
  }else{
    y = ar.bottom + gap;
    if (y + pr.height > vb.offsetTop + vb.height - 8){
      // fallback top
      y = ar.top - pr.height - gap;
    }
  }

  Object.assign(pop.style, {
    left: `${x + window.scrollX}px`,
    top:  `${y + window.scrollY}px`
  });
}

// 서브팝업은 메인팝업 외측 하단(또는 상단) 근처에 “붙여서” 띄우되
// 화면 밖으로 너무 튀어나가면 살짝 뒤집거나 붙여서 조정
export function placeSubDetached(pop, tokenEl, sub, gap = 8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();

  // 기본: 메인팝업의 바깥 우하단
  let x = pr.right + gap;
  let y = pr.bottom + gap;

  // 오른쪽이 잘리면 팝업의 오른쪽 경계에 맞추되 안쪽으로
  if (x + sr.width > vb.offsetLeft + vb.width - 8){
    x = pr.right - sr.width;
  }

  // 아래로 잘리면 메인팝업 위쪽으로 올림
  if (y + sr.height > vb.offsetTop + vb.height - 8){
    y = pr.top - sr.height - gap;
  }

  Object.assign(sub.style, {
    left: `${x + window.scrollX}px`,
    top:  `${y + window.scrollY}px`
  });
}
