// place.js (patched)
// placeMainPopover(anchorEl, popEl, preferredDir?) -> returns chosen dir ("bottom"|"top")
export function placeMainPopover(anchorEl, popEl, preferredDir=null){
  if(!anchorEl || !popEl) return "bottom";
  const pad = 8;
  // Ensure measurable
  const prevHidden = popEl.hidden;
  if(prevHidden){ popEl.hidden = false; popEl.style.visibility = "hidden"; }
  const ar = anchorEl.getBoundingClientRect();
  const pr = popEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  const spaceBelow = vh - ar.bottom;
  const spaceAbove = ar.top;

  let dir = preferredDir;
  if(dir !== "top" && dir !== "bottom"){
    dir = (spaceBelow >= pr.height + pad) ? "bottom" : (spaceAbove >= pr.height + pad ? "top" : (spaceBelow >= spaceAbove ? "bottom" : "top"));
  }

  // compute left: try align to anchor left, clamp to viewport
  let left = ar.left;
  if(left + pr.width + pad > vw) left = vw - pr.width - pad;
  if(left < pad) left = pad;

  // compute top based on dir
  let top = (dir === "bottom") ? (ar.bottom + 6) : (ar.top - pr.height - 6);
  // if overflow, clamp within viewport
  if(top + pr.height + pad > vh) top = vh - pr.height - pad;
  if(top < pad) top = pad;

  popEl.style.left = `${left + window.scrollX}px`;
  popEl.style.top  = `${top + window.scrollY}px`;

  if(prevHidden){ popEl.style.visibility = ""; popEl.hidden = true; }
  else { popEl.style.visibility = ""; }

  return dir;
}
