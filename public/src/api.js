export const WORKER_BASE = "https://icy-paper-e469.rlaalsrbr.workers.dev";
export const TEXT_TRANSLATE_URL = "https://solitary-mud-8caf.rlaalsrbr.workers.dev/translate";

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
  // 번역은 텍스트번역기와 동일한 solitary-mud-8caf 워커(/translate)로 보냅니다.
  // OCR/이미지/후리가나는 기존 WORKER_BASE(icy-paper-e469)를 그대로 사용합니다.
  const r = await fetch(`${TEXT_TRANSLATE_URL}`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ text, target: "KO" })
  });
  if(!r.ok) throw new Error("translate failed");
  const j = await r.json();
  const out = j.translation || "";
  return { text: out, result: out };
}

export function openNaverJaLemma(term){
  window.open(`https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(term)}`,"_blank");
}
export function openNaverHanja(ch){
  window.open(`https://hanja.dict.naver.com/hanja?q=${encodeURIComponent(ch)}`,"_blank");
}
