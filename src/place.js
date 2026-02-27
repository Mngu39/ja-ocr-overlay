// 메인 팝업을 anchor(첫 번째 선택 상자) 주변에 배치.
// 기존 기본 배치는 "anchor 위/아래 중 더 널널한 쪽"
export function placeMainPopover(anchor, pop, gap=8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  const topSpace    = ar.top - vb.offsetTop;
  const bottomSpace = (vb.offsetTop + vb.height) - ar.bottom;
  const preferTop   = topSpace > bottomSpace;

  // X 좌표: anchor 가운데 정렬 후 viewport 안쪽으로 클램프
  let x = ar.left + (ar.width - pr.width)/2;
  x = Math.max(
    vb.offsetLeft + 8,
    Math.min(x, vb.offsetLeft + vb.width - pr.width - 8)
  );

  let y;
  let dir;
  if(preferTop){
    y = ar.top - pr.height - gap;
    dir = "top";
    if(y < vb.offsetTop + 8){
      y = ar.bottom + gap;
      dir = "bottom";
    }
  }else{
    y = ar.bottom + gap;
    dir = "bottom";
    if(y + pr.height > vb.offsetTop + vb.height - 8){
      y = ar.top - pr.height - gap;
      dir = "top";
    }
  }

  // 마지막 안전 클램프(아이폰/아이패드 모두)
  y = Math.max(vb.offsetTop + 8, Math.min(y, vb.offsetTop + vb.height - pr.height - 8));

  Object.assign(pop.style,{
    left:(x + window.scrollX)+"px",
    top :(y + window.scrollY)+"px"
  });

  return dir;
}

// 서브 팝업을 메인 팝업 바깥 아래에 기본 배치.
// 아래 공간이 부족하면 위로 뒤집고, 좌우는 viewport 안으로 클램프.
export function placeSubDetached(mainPop, subPop, gap=8, minH=120){
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const mr = mainPop.getBoundingClientRect();
  const sr = subPop.getBoundingClientRect();

  const bottomSpace = (vb.offsetTop + vb.height) - mr.bottom;
  const topSpace    = mr.top - vb.offsetTop;

  let top;
  if(bottomSpace >= Math.max(minH, sr.height + gap)){
    top = mr.bottom + gap;
  }else if(topSpace >= Math.max(minH, sr.height + gap)){
    top = mr.top - sr.height - gap;
  }else{
    // 어쩔 수 없으면 아래쪽으로 두되 클램프
    top = Math.min(mr.bottom + gap, vb.offsetTop + vb.height - sr.height - 8);
  }

  // 기본은 메인팝업 왼쪽 정렬
  let left = mr.left;

  // 좌우 클램프
  left = Math.max(vb.offsetLeft + 8, Math.min(left, vb.offsetLeft + vb.width - sr.width - 8));
  top  = Math.max(vb.offsetTop  + 8, Math.min(top,  vb.offsetTop  + vb.height - sr.height - 8));

  Object.assign(subPop.style,{
    left:(left + window.scrollX)+"px",
    top :(top  + window.scrollY)+"px"
  });
}
