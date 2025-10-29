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
  if(preferTop){
    y = ar.top - pr.height - gap;
    if(y < vb.offsetTop + 8){
      y = ar.bottom + gap;
    }
  }else{
    y = ar.bottom + gap;
    if(y + pr.height > vb.offsetTop + vb.height - 8){
      y = ar.top - pr.height - gap;
    }
  }

  Object.assign(pop.style,{
    left:(x + window.scrollX)+"px",
    top :(y + window.scrollY)+"px"
  });
}
