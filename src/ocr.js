// /src/ocr.js — Safety-Net OCR: 전처리 + lines 우선, words 병합 fallback

/***** 튜닝 포인트 *****/
const MAX_W = 2200;        // 전처리시 최대 너비 (iPad 스샷 2048~2732면 충분)
const BASE_MIN_CONF = 75;  // 1차 라인 필터 신뢰도 임계값 (부족하면 자동 완화)
const NMS_IOU = 0.65;      // 박스 중복 제거 임계값
const KEEP_TOP_K = 40;     // 너무 많을 때 남길 최대 박스 개수(가중치 상위)

/***** 유틸 *****/
function median(a){ if(!a.length) return 0; const b=[...a].sort((x,y)=>x-y); const m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function hasJa(s){ return /[\u3040-\u30FF\u3000-\u303F\u4E00-\u9FFF]/.test(s||""); }
function iou(a,b){
  const ix0=Math.max(a[0],b[0]), iy0=Math.max(a[1],b[1]);
  const ix1=Math.min(a[2],b[2]), iy1=Math.min(a[3],b[3]);
  const iw=Math.max(0,ix1-ix0), ih=Math.max(0,iy1-iy0);
  const inter=iw*ih; if(!inter) return 0;
  const areaA=(a[2]-a[0])*(a[3]-a[1]); const areaB=(b[2]-b[0])*(b[3]-b[1]);
  return inter/(areaA+areaB-inter);
}

/***** 0) 전처리: 리사이즈 + 그레이 + 대비 *****/
async function loadAndPreprocess(imageUrl){
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=imageUrl; });

  const scale = img.width > MAX_W ? MAX_W / img.width : 1;
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);

  const cvs = document.createElement('canvas'); cvs.width=W; cvs.height=H;
  const ctx = cvs.getContext('2d');
  ctx.drawImage(img,0,0,W,H);

  // 간단 그레이 + 대비(1.2) + 밝기 보정(-8)
  const imgData = ctx.getImageData(0,0,W,H);
  const d = imgData.data;
  const contrast = 1.2, brightness = -8;
  for (let i=0;i<d.length;i+=4){
    const r=d[i], g=d[i+1], b=d[i+2];
    let y = (0.299*r + 0.587*g + 0.114*b);       // gray
    y = (y-128)*contrast + 128 + brightness;     // contrast/brightness
    y = y<0?0:y>255?255:y;
    d[i]=d[i+1]=d[i+2]=y|0;
  }
  ctx.putImageData(imgData,0,0);
  return { canvas: cvs, width: W, height: H };
}

/***** 1) lines 기반 후보 생성 *****/
function collectFromLines(data, minConf){
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) return [];

  const heights = lines.map(ln=>{
    const b=ln.bbox||ln; const y0=b.y0??b.y??ln.y0; const y1=b.y1??(b.y+b.h)??(ln.y1??(ln.y0+ln.height));
    return (y1!=null && y0!=null) ? (y1-y0) : null;
  }).filter(v=>v!=null);
  const Hm = Math.max(1, median(heights));

  const out = [];
  for (const ln of lines){
    const text=(ln.text||"").trim();
    if (!text || text.length<2) continue;
    if (!hasJa(text)) continue;

    const b=ln.bbox||ln;
    const x0=b.x0??b.x??ln.x0, y0=b.y0??b.y??ln.y0;
    const x1=b.x1??(b.x+b.w)??(ln.x1??(ln.x0+ln.width));
    const y1=b.y1??(b.y+b.h)??(ln.y1??(ln.y0+ln.height));
    if ([x0,y0,x1,y1].some(v=>v==null)) continue;

    const w=x1-x0, h=y1-y0;
    const conf = typeof ln.confidence==='number'
      ? ln.confidence
      : (Array.isArray(ln.words)&&ln.words.length
          ? Math.round(ln.words.reduce((s,w)=>s+(w.confidence??0),0)/ln.words.length)
          : 100);

    // 크기/비율 필터: 라인 높이가 중앙값 대비 너무 작거나 크면 제거
    if (h < Hm*0.55 || h > Hm*2.2) continue;
    if (w < Hm*1.2) continue;        // 너무 짧은 라인 제거
    if (conf < minConf) continue;

    out.push({ text, box:[x0,y0,x1,y1], conf, w, h });
  }
  return { cand: out, Hm };
}

/***** 2) words 병합 fallback *****/
function collectFromWords(data){
  const words = Array.isArray(data.words) ? data.words : (data.symbols||[]);
  if (!words.length) return [];

  // 좌표/텍스트 추출
  const ws = words.map(w=>{
    const b=w.bbox||w;
    const x0=b.x0??b.x??w.x0, y0=b.y0??b.y??w.y0;
    const x1=b.x1??(b.x+b.w)??(w.x0+w.width);
    const y1=b.y1??(b.y+b.h)??(w.y0+w.height);
    const text=(w.text||w.symbol||"").trim();
    const conf=typeof w.confidence==='number' ? w.confidence : 100;
    return (x0!=null&&y0!=null&&x1!=null&&y1!=null&&text) ? {x0,y0,x1,y1,text,conf} : null;
  }).filter(Boolean);
  if (!ws.length) return [];

  ws.sort((a,b)=> ((a.y0+a.y1)/2) - ((b.y0+b.y1)/2));
  const Hm = Math.max(1, median(ws.map(w=>w.y1-w.y0)));
  const vTol = Hm*0.55;

  // 행 묶기
  const rows=[];
  for(const w of ws){
    const cy=(w.y0+w.y1)/2;
    let r=rows.find(r=>Math.abs(r.cy-cy)<=vTol);
    if(!r){ r={cy,items:[]}; rows.push(r); }
    r.items.push(w); r.cy = (r.items.reduce((s,i)=>s+(i.y0+i.y1)/2,0)/r.items.length);
  }

  // 행 내 좌→우 정렬 후 큰 간격에서 분절
  const segs=[];
  for(const r of rows){
    r.items.sort((a,b)=>a.x0-b.x0);
    const gaps=[]; for(let i=1;i<r.items.length;i++) gaps.push(Math.max(0,r.items[i].x0 - r.items[i-1].x1));
    const medGap = Math.max(1, median(gaps));
    const gapThresh = Math.max(18, medGap*2.8, Hm*1.2);

    let cur=[r.items[0]];
    for(let i=1;i<r.items.length;i++){
      const prev=r.items[i-1], now=r.items[i];
      const gap = Math.max(0, now.x0 - prev.x1);
      if (gap > gapThresh) { segs.push(cur); cur=[now]; }
      else cur.push(now);
    }
    if(cur.length) segs.push(cur);
  }

  // 세그→박스
  const out=[];
  for(const seg of segs){
    const x0=Math.min(...seg.map(w=>w.x0)), y0=Math.min(...seg.map(w=>w.y0));
    const x1=Math.max(...seg.map(w=>w.x1)), y1=Math.max(...seg.map(w=>w.y1));
    const text=seg.map(w=>w.text).join('').replace(/\s+/g,'').trim();
    if (!text || !hasJa(text)) continue;
    const conf = Math.round(seg.reduce((s,w)=>s+(w.conf||70),0)/seg.length);
    out.push({ text, box:[x0,y0,x1,y1], conf, w:(x1-x0), h:(y1-y0) });
  }
  return { cand: out, Hm };
}

/***** 3) NMS + 우선순위 정렬 *****/
function nmsAndRank(cand, imgW){
  if (!cand.length) return [];

  // 넓게 가로로 긴 문장을 우선 (자막 성격)
  cand.forEach(c=>{
    const widthScore = Math.min(1, c.w / (imgW*0.8)); // 화면 폭의 비율
    c.score = c.conf*0.6 + widthScore*40;            // 가중치 합산
  });
  cand.sort((a,b)=> b.score - a.score);

  const kept=[];
  for(const c of cand){
    let overlapped=false;
    for(const k of kept){
      if (iou(c.box, k.box) > NMS_IOU){ overlapped=true; break; }
    }
    if(!overlapped) kept.push(c);
  }
  return kept.slice(0, KEEP_TOP_K);
}

/***** export: OCR 메인 *****/
export async function ocrJapanese(imageUrl){
  // 전처리 캔버스 생성
  const { canvas, width:W, height:H } = await loadAndPreprocess(imageUrl);

  // Tesseract 실행 (전처리 캔버스 입력)
  const { data } = await Tesseract.recognize(canvas, 'jpn', {
    // psm은 기본(AUTO) 그대로. 필요 시 6 시도 가능.
    // tessedit_pageseg_mode: 6
    logger: _=>{}
  });

  // 1) lines 기반 (점진 완화)
  let minConf = BASE_MIN_CONF;
  let col = collectFromLines(data, minConf);
  if (col.cand.length < 2){ minConf = 68; col = collectFromLines(data, minConf); }
  if (col.cand.length < 1){ minConf = 60; col = collectFromLines(data, minConf); }

  let cand = col.cand;

  // 2) 부족하면 words 병합 fallback
  if (cand.length < 1){
    const alt = collectFromWords(data);
    cand = alt.cand;
  }

  // 3) 정리(NMS+정렬)
  const kept = nmsAndRank(cand, W);
  // 마지막 안전망: 정말 하나도 없으면, lines/words 중 가장 긴 한 개라도 리턴
  const final = kept.length ? kept : (cand.length ? [cand.sort((a,b)=> (b.w*b.h) - (a.w*a.h))[0]] : []);

  return final.map(k=>({
    text: k.text,
    polygon: [[k.box[0],k.box[1]],[k.box[2],k.box[1]],[k.box[2],k.box[3]],[k.box[0],k.box[3]]]
  }));
}

/***** 표시 스케일 적용 *****/
export function drawBoxes(annos, overlayEl, sx=1, sy=1){
  overlayEl.innerHTML = "";
  for (const a of annos){
    const [p0,p1,p2,p3]=a.polygon;
    const l=Math.min(p0[0],p3[0])*sx, t=Math.min(p0[1],p1[1])*sy;
    const r=Math.max(p1[0],p2[0])*sx, b=Math.max(p2[1],p3[1])*sy;
    const box=document.createElement('div');
    box.className='box';
    Object.assign(box.style,{
      left:l+'px', top:t+'px', width:(r-l)+'px', height:(b-t)+'px'
    });
    box.dataset.text=a.text;
    overlayEl.appendChild(box);
  }
}
