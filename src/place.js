export function placeMainPopover(anchor, pop, gap=8){
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
  const preferTop = topSpace > bottomSpace;

  // 기본 x: anchor 가운데 정렬, 화면에서 안 튀어나가게 clamp
  let x = ar.left + (ar.width - pr.width)/2;
  x = Math.max(
    vb.offsetLeft + 8,
    Math.min(x, vb.offsetLeft + vb.width - pr.width - 8)
  );

  // 위/아래 중 더 널널한 쪽 놓고, 안되면 반대
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

/*
fallback(지금은 거의 안 쓰지만 남겨둠):
메인 팝업 기준으로 sub를 배치하는 기본 로직.
*/
export function placeSubDetached(pop, tokenEl, sub, gap=8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();

  let left = pr.right + gap;
  let top  = pr.bottom + gap;

  if(left + sr.width > vb.offsetLeft + vb.width - 8){
    left = pr.right - sr.width;
  }
  if(top + sr.height > vb.offsetTop + vb.height - 8){
    top = pr.top - sr.height - gap;
  }

  Object.assign(sub.style,{
    left:(left + window.scrollX)+"px",
    top :(top  + window.scrollY)+"px"
  });
}
