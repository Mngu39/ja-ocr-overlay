// 메인 팝업: 상/하 중 더 넓은 공간 우선 + fit/scroll
export function placeMainPopover(anchorEl, popEl, gap=8){
  const vw = globalThis.visualViewport?.width || window.innerWidth;
  const vh = globalThis.visualViewport?.height || window.innerHeight;
  const a  = anchorEl.getBoundingClientRect();

  // 측정용 복제
  const ghost = popEl.cloneNode(true);
  Object.assign(ghost.style,{position:'fixed', left:'-9999px', visibility:'hidden', maxWidth:'min(92vw,520px)'});
  document.body.appendChild(ghost);
  let { width:pw, height:ph } = ghost.getBoundingClientRect();
  ghost.remove();

  const topSpace = a.top - gap - 8;
  const botSpace = vh - a.bottom - gap - 8;
  const order = topSpace >= botSpace ? ['top','bottom'] : ['bottom','top'];

  function fits(side){
    const space = side==='top' ? topSpace : botSpace;
    return ph <= space && pw <= (vw - 16);
  }
  function fitSize(side){
    const space = side==='top' ? topSpace : botSpace;
    return { w: Math.min(pw, vw-16), h: Math.max(Math.min(ph, space), 160) };
  }

  let side = order[0], size = { w: pw, h: ph };
  if(!fits(order[0])){
    if(fits(order[1])) side = order[1];
    else { // fit
      const fitFirst  = fitSize(order[0]);
      const fitSecond = fitSize(order[1]);
      if (fitFirst.h >= 160) { side=order[0]; size=fitFirst; }
      else { side=order[1]; size=fitSecond; }
    }
  }

  let x = Math.min(Math.max(a.left + (a.width - size.w)/2, 8), vw - size.w - 8);
  let y = side==='top' ? (a.top - gap - size.h) : (a.bottom + gap);
  y = Math.min(Math.max(y, 8), vh - size.h - 8);

  Object.assign(popEl.style,{
    position:'fixed', left:`${Math.round(x)}px`, top:`${Math.round(y)}px`,
    width:`${Math.round(size.w)}px`, maxHeight:`${Math.round(size.h)}px`
  });
  popEl.dataset.side = side;

  // 화살표 위치 보정
  const arrow = popEl.querySelector('.pop-arrow');
  if (arrow) {
    const anchorCenter = a.left + a.width/2;
    const local = Math.min(Math.max(anchorCenter - x, 16), size.w - 16);
    arrow.style.left = `${Math.round(local - 8)}px`;
  }
}

// 서브팝업: 기본 bottom-detached, 부족하면 top, 극단적이면 dock
export function placeSubDetached(mainPop, tokenEl, subEl, gap=8){
  const vw = globalThis.visualViewport?.width || window.innerWidth;
  const vh = globalThis.visualViewport?.height || window.innerHeight;
  const mp = mainPop.getBoundingClientRect();

  const ghost = subEl.cloneNode(true);
  Object.assign(ghost.style,{position:'fixed', left:'-9999px', visibility:'hidden', maxWidth:'min(60ch,92vw)'});
  document.body.appendChild(ghost);
  let { width:sw, height:sh } = ghost.getBoundingClientRect();
  ghost.remove();

  const safeTop=8, safeBottom=8;
  const bottomSpace = vh - mp.bottom - gap - safeBottom;
  const topSpace    = mp.top - gap - safeTop;
  const minH = 160;
  const w = Math.min(sw, vw - 16);
  let side = 'bottom';
  let h = Math.min(sh, Math.max(bottomSpace, minH));

  if (bottomSpace < minH) {
    if (topSpace >= minH) { side='top'; h = Math.min(sh, topSpace); }
    else { side='dock'; }
  }

  if (side === 'dock') {
    Object.assign(subEl.style,{
      position:'fixed', left:'8px', right:'8px',
      bottom:`${safeBottom}px`, maxHeight:`${Math.max(minH, Math.min(vh*0.4, 280))}px`, overflow:'auto'
    });
    subEl.dataset.mode='dock';
    drawTail(tokenEl, null); // 꼬리 제거
    return;
  }

  // top/bottom 배치
  let x = Math.min(Math.max(mp.left + (mp.width - w)/2, 8), vw - w - 8);
  let y = side==='bottom'
    ? Math.min(mp.bottom + gap, vh - h - safeBottom)
    : Math.max(mp.top - gap - h, safeTop);

  Object.assign(subEl.style,{
    position:'fixed', left:`${Math.round(x)}px`, top:`${Math.round(y)}px`,
    width:`${Math.round(w)}px`, maxHeight:`${Math.round(h)}px`, overflow:'auto'
  });
  subEl.dataset.mode = `detached-${side}`;
  drawTail(tokenEl, subEl);
}

// 토큰→서브팝업 꼬리 (SVG 라인 1개)
export function drawTail(tokenEl, subEl){
  const svg = document.getElementById('sub-tail');
  if (!svg) return;
  if (!subEl) { svg.innerHTML = ""; return; }
  const tr = tokenEl.getBoundingClientRect();
  const sr = subEl.getBoundingClientRect();
  const x1 = tr.left + tr.width/2, y1 = tr.top + tr.height/2;
  const x2 = sr.left + sr.width/2, y2 = sr.top - 6;
  svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>`;
}

