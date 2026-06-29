// Learning-log client helpers.
// 기존 OCR/번역 흐름을 건드리지 않기 위해 저장 기능만 별도 모듈로 분리.

const DEFAULT_LOG_WORKER_BASE = "https://jp-learning-log.rlaalsrbr.workers.dev";
const LS_BASE  = "jpLogWorkerBase";
const LS_TOKEN = "jpLogAppToken";
const LS_LAST_SESSION = "jpLogLastSession";

export function getLogWorkerBase(){
  return (localStorage.getItem(LS_BASE) || DEFAULT_LOG_WORKER_BASE).replace(/\/$/, "");
}

export function setLogWorkerBase(base){
  if(base) localStorage.setItem(LS_BASE, String(base).replace(/\/$/, ""));
}

export function getAppToken(){
  return localStorage.getItem(LS_TOKEN) || "";
}

export function setAppToken(token){
  if(token) localStorage.setItem(LS_TOKEN, String(token));
}

export function getLastSession(){
  try{ return JSON.parse(localStorage.getItem(LS_LAST_SESSION) || "null"); }
  catch{ return null; }
}

export function setLastSession(session){
  if(session?.id) localStorage.setItem(LS_LAST_SESSION, JSON.stringify({
    id: session.id,
    title: session.title || session.session_key || session.raw_url || session.id,
    raw_url: session.raw_url || "",
    canonical_url: session.canonical_url || "",
    session_key: session.session_key || ""
  }));
}

export async function ensureLogConfig(){
  let token = getAppToken();
  if(!token){
    token = prompt("학습로그 APP_TOKEN을 입력하세요. 한 번 입력하면 이 브라우저에 저장됩니다.");
    if(!token) throw new Error("APP_TOKEN이 필요합니다.");
    setAppToken(token.trim());
  }
  return { base:getLogWorkerBase(), token:getAppToken() };
}

async function request(path, {method="GET", body=null}={}){
  const {base, token} = await ensureLogConfig();
  const headers = { "x-app-token": token };
  let payload = undefined;
  if(body != null){
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let json = null;
  try{ json = text ? JSON.parse(text) : null; }catch{ /* ignore */ }
  if(!r.ok){
    const msg = json?.error || text || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return json;
}

export function searchSessions(q){
  return request(`/api/sessions/search?q=${encodeURIComponent(q||"")}`);
}

export function recentSessions(){
  return request(`/api/sessions/recent`);
}

export function resolveSession(url){
  return request(`/api/sessions/resolve`, { method:"POST", body:{ url } });
}

export async function saveItem(payload){
  const out = await request(`/api/save`, { method:"POST", body:payload });
  if(out?.session) setLastSession(out.session);
  return out;
}

function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      resolve(s.includes(",") ? s.split(",",2)[1] : s);
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export async function downscaleImageElement(imgEl, {longEdge=1600, quality=0.78}={}){
  if(!imgEl?.naturalWidth || !imgEl?.naturalHeight) return null;
  const nw = imgEl.naturalWidth;
  const nh = imgEl.naturalHeight;
  const scale = Math.min(1, longEdge / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  try{
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha:false });
    ctx.drawImage(imgEl, 0, 0, w, h);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
    if(!blob) throw new Error("canvas.toBlob failed");
    const base64 = await blobToBase64(blob);
    return { base64, mime:"image/webp", width:w, height:h, size_bytes:blob.size, downscaled:true };
  }catch(e){
    // CORS 등으로 canvas가 taint되면 여기로 온다. 저장 자체는 실패시키지 않고 서버 fallback에 맡긴다.
    console.warn("downscale failed; fallback to server image copy", e);
    return null;
  }
}
