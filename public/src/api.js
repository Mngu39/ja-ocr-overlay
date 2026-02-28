export const WORKER_BASE = "https://icy-paper-e469.rlaalsrbr.workers.dev";

// 이미지 URL (유지)
export async function getImageById(id){
  return `${WORKER_BASE}/image?id=${encodeURIComponent(id)}`;
}
// Google OCR (유지)
export async function gcvOCR(id){
  const r = await fetch(`${WORKER_BASE}/gcv/ocr`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ id })
  });
  if(!r.ok) throw new Error(`GCV ${r.status}`);
  const j = await r.json(); return j.annos || [];
}

// 후리가나/번역 → Worker 프록시
export async function getFurigana(text){
  const r = await fetch(`${WORKER_BASE}/run/furigana`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ text })
  });
  if(!r.ok) throw new Error("furigana failed");
  return await r.json();
}
export async function translateJaKo(text){
  const r = await fetch(`${WORKER_BASE}/run/translate`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ src:"ja", tgt:"ko", text })
  });
  if(!r.ok) throw new Error("translate failed");
  return await r.json(); // { text, result }
}

export function openNaverJaLemma(term){
  window.open(`https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(term)}`,"_blank");
}
export function openNaverHanja(ch){
  window.open(`https://hanja.dict.naver.com/hanja?q=${encodeURIComponent(ch)}`,"_blank");
}
