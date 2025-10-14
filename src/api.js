// 고정 엔드포인트(요청대로 그대로 사용)
const FURIGANA_URL = "https://furigana-api-345684237835.asia-northeast3.run.app/furigana";
const DEEPL_URL    = "https://solitary-mud-8caf.rlaalsrbr.workers.dev/translate";
// 이미지 임시저장 워커 (업로드는 단축어가 담당; 여긴 조회만)
const WORKER_BASE  = "https://icy-paper-e469.rlaalsrbr.workers.dev";

export async function getImageById(id){
  const url = `${WORKER_BASE}/ocr/file/${encodeURIComponent(id)}`;
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error("이미지를 불러오지 못했습니다.");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function getFurigana(text){
  const res = await fetch(FURIGANA_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text })
  });
  if(!res.ok) throw new Error("Furigana API 오류");
  return res.json();
}

export async function translateJaKo(text){
  const res = await fetch(DEEPL_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text, source: "ja", target: "ko" })
  });
  if(!res.ok) throw new Error("번역 API 오류");
  return res.json();
}

// 네이버 사전 열기
export function openNaverJaLemma(lemma){
  const url = `${WORKER_BASE}/naver-ja?lemma=${encodeURIComponent(lemma)}`;
  window.open(url, "_blank", "noopener");
}
export function openNaverHanja(char){
  const url = `https://hanja.dict.naver.com/#/search?query=${encodeURIComponent(char)}`;
  window.open(url, "_blank", "noopener");
}

