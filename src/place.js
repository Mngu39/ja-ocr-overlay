// 팝업 위치 계산 유틸

export function placeMainPopover(anchor, pop, gap=8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const r = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();

  const topSpace = r.top - vb.offsetTop;
  const bottomSpace = (vb.offsetTop + vb.height) - r.bottom;
  const preferTop = topSpace > bottomSpace;

  // 기본 x: 앵커 가운데에 맞추되 화면 밖 안 나가게
  let x = r.left + (r.width - p.width) / 2;
  x = Math.max(
    8,
    Math.min(x, vb.offsetLeft + vb.width - p.width - 8)
  );

  // 기본 y: 앵커 위/아래 중 더 여유 있는 곳
  let y;
  if (preferTop){
    y = r.top - p.height - gap;
    if (y < vb.offsetTop + 8){
      y = r.bottom + gap;
    }
  } else {
    y = r.bottom + gap;
    if (y + p.height > vb.offsetTop + vb.height - 8){
      y = r.top - p.height - gap;
    }
  }

  Object.assign(pop.style, {
    left: `${x + window.scrollX}px`,
    top:  `${y + window.scrollY}px`
  });
}

export function placeSubDetached(pop, tokenEl, sub, gap=8){
  // 서브팝업은 기본적으로 "메인팝업의 우하단 쪽에 딱 붙어" 있어야 함
  // 단, 화면을 넘치면 위로 올리거나 왼쪽으로 붙임
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();

  // 기본: 메인팝업의 오른쪽 아래 모서리 바로 아래쪽
  let x = pr.right - sr.width;
  if (x < vb.offsetLeft + 8){
    // 너무 왼쪽으로 튀면 그냥 팝업 왼쪽으로 붙여
    x = pr.left;
  }

  let y = pr.bottom + gap;

  // 만약 아래로 내리면 화면에서 바닥 뚫는다면 위로 올려
  if (y + sr.height > vb.offsetTop + vb.height - 8){
    y = pr.top - sr.height - gap;
  }

  // 위로 올렸는데도 너무 위로 가면 (거의 안 나올 상황이지만) 위쪽 최소치 보정
  if (y < vb.offsetTop + 8){
    y = vb.offsetTop + 8;
  }

  Object.assign(sub.style, {
    left: `${x + window.scrollX}px`,
    top:  `${y + window.scrollY}px`
  });
}
