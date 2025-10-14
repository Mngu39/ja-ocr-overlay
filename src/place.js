export function placeMainPopover(anchor, pop, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const r = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();

  const topSpace = r.top - vb.offsetTop;
  const bottomSpace = (vb.offsetTop + vb.height) - r.bottom;
  const preferTop = topSpace > bottomSpace;

  let x = r.left + (r.width - p.width)/2;
  x = Math.max(8, Math.min(x, vb.offsetLeft + vb.width - p.width - 8));

  let y;
  if (preferTop){ y = r.top - p.height - gap; if (y < vb.offsetTop + 8) y = r.bottom + gap; }
  else { y = r.bottom + gap; if (y + p.height > vb.offsetTop + vb.height - 8) y = r.top - p.height - gap; }

  Object.assign(pop.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}

export function placeSubDetached(pop, tokenEl, sub, gap=8){
  const vb = (globalThis.visualViewport || { width:innerWidth, height:innerHeight, offsetTop:scrollY, offsetLeft:scrollX });
  const pr = pop.getBoundingClientRect();
  const sr = sub.getBoundingClientRect();
  let x = pr.right + gap, y = pr.bottom + gap;
  if (x + sr.width > vb.offsetLeft + vb.width - 8) x = pr.right - sr.width;
  if (y + sr.height > vb.offsetTop + vb.height - 8) y = pr.top - sr.height - gap;
  Object.assign(sub.style, { left:`${x + window.scrollX}px`, top:`${y + window.scrollY}px` });
}
