export const WORKER_BASE = "https://icy-paper-e469.rlaalsrbr.workers.dev";

// [그대로] 이미지 URL
export async function getImageById(id){
  return `${WORKER_BASE}/image?id=${encodeURIComponent(id)}`;
}
// [그대로] Google OCR
export async function gcvOCR(id){
  const r = await fetch(`${WORKER_BASE}/gcv/ocr`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ id })
  });
  if(!r.ok) throw new Error(`GCV ${r.status}`);
  const j = await r.json(); return j.annos || [];
}

// [변경] 후리가나/번역은 Worker 프록시 호출
export async function getFurigana(text){
  const r = await fetch(`${WORKER_BASE}/run/furigana`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ text })
  });
  if(!r.ok) throw new Error("furigana failed");
  return await r.json(); // tokens/morphs 등은 app.js에서 호환 처리
}
export async function translateJaKo(text){
  const r = await fetch(`${WORKER_BASE}/run/translate`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ src:"ja", tgt:"ko", text })
  });
  if(!r.ok) throw new Error("translate failed");
  return await r.json(); // { text, result }
}
