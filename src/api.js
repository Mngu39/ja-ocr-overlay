// API 모듈 — Worker(GCV OCR) + 번역/후리가나 호출
export const WORKER_BASE = "https://icy-paper-e469.rlaalsrbr.workers.dev";

/** 업로드된 이미지를 id로 불러오는 퍼머링크 (브라우저 표시용) */
export async function getImageById(id){
  // 이미지 데이터는 Worker에서 직접 보내므로, 그냥 URL만 반환
  return `${WORKER_BASE}/image?id=${encodeURIComponent(id)}`;
}

/** Google Vision OCR (Cloudflare Worker 경유) */
export async function gcvOCR(id){
  const r = await fetch(`${WORKER_BASE}/gcv/ocr`, {
    method: "POST",
    headers: { "content-type":"application/json" },
    body: JSON.stringify({ id })
  });
  if(!r.ok) throw new Error(`GCV ${r.status}`);
  const j = await r.json();
  return j.annos || [];
}

/* ▼▼▼ 아래 두 함수는 기존 번역기(Cloud Run)와 동일한 엔드포인트를 사용하세요 ▼▼▼
   URL만 당신 환경에 맞게 채우면 됩니다. */
const RUN_BASE = "https://furigana-api-345684237835.asia-northeast3.run.app"; // ← 기존 번역기 URL로 교체

export async function getFurigana(text){
  // Sudachi 형태소 + reading 반환 형식에 맞게 조정
  const r = await fetch(`${RUN_BASE}/furigana`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ text })
  });
  if(!r.ok) throw new Error("furigana failed");
  return await r.json();
}

export async function translateJaKo(text){
  const r = await fetch(`${RUN_BASE}/translate`, {
    method:"POST", headers:{ "content-type":"application/json" },
    body: JSON.stringify({ src:"ja", tgt:"ko", text })
  });
  if(!r.ok) throw new Error("translate failed");
  return await r.json();
}

/** 외부 사전 링크 */
export function openNaverJaLemma(term){
  window.open(`https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(term)}`,"_blank");
}
export function openNaverHanja(ch){
  window.open(`https://hanja.dict.naver.com/hanja?q=${encodeURIComponent(ch)}`,"_blank");
}
