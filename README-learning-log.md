# JA OCR Overlay + Learning Log patch

이 패치는 기존 OCR/번역 동작은 최대한 건드리지 않고, 저장 기능만 추가한다.

## 추가된 것

- 문장박스 저장 버튼: 💾 최근 세션 저장, ＋ 세션 선택/생성 후 저장
- 한자박스 저장 버튼: 💾 최근 세션 저장, ＋ 세션 선택/생성 후 저장
- 세션 링크 입력/검색 다이얼로그
- 클라이언트 측 전체 스크린샷 다운스케일 WebP 생성 시도
- 다운스케일 실패 시 Worker가 원본 이미지 URL을 임시 저장하는 fallback
- Cloudflare Worker 프로젝트: `learning-log-worker/`
- 관리 페이지: `public/logs.html`

## Cloudflare 값

- R2 bucket: `jp-learning-log-media`
- D1 database: `jp_learning_log_db`
- D1 database ID: `3c5d5b95-105a-4523-a3b1-baae00e2a607`

## 배포 순서

PowerShell에서:

```powershell
cd $env:USERPROFILE\Desktop\jp-learning-log-worker
```

이 zip 안의 `learning-log-worker` 폴더 내용을 위 폴더로 복사한 뒤:

```powershell
npm install
wrangler d1 migrations apply jp_learning_log_db --remote
wrangler secret put APP_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler deploy
```

`APP_TOKEN`은 직접 정한 긴 비밀번호 문자열이면 된다. 예: 30자 이상 랜덤 문자열.
`GEMINI_API_KEY`는 Google AI Studio에서 만든 키를 입력한다.

배포 후 Worker URL은 기본적으로 다음 형태가 될 가능성이 높다.

```text
https://jp-learning-log.rlaalsrbr.workers.dev
```

다르면 번역 결과 페이지에서 브라우저 콘솔에 아래를 한 번 실행하면 된다.

```js
localStorage.setItem("jpLogWorkerBase", "실제 Worker URL")
```

저장 버튼을 처음 누르면 APP_TOKEN 입력창이 뜬다. 한 번 입력하면 브라우저 localStorage에 저장된다.

## 관리 페이지

```text
https://mngu39.github.io/ja-ocr-overlay/logs.html
```

관리 페이지에서 Worker URL, APP_TOKEN을 설정한 뒤 세션 확인/삭제/export를 할 수 있다.

## PC 영구 저장 / Anki import

서버는 임시 inbox이고, PC에 영구 저장할 때는 동봉한 helper를 쓴다.

```powershell
node tools/export_to_pc.mjs https://jp-learning-log.rlaalsrbr.workers.dev YOUR_APP_TOKEN .\jp-log-export
```

생성물:

```text
jp-log-export/
  manifest.json
  anki.tsv
  <media_id>.webp
  ...
```

Anki에서 `anki.tsv`를 import한다. import할 때 이미지 파일들이 `anki.tsv`와 같은 폴더에 있어야 한다.

## 주의

- 기존 OCR, 후리가나, 번역 API 경로는 유지했다.
- 기존 이미지 로딩 라인은 건드리지 않았다.
- Anki TSV export는 `?ai=1`일 때 Gemini로 카드 뒷면용 번역/설명을 생성하고, 결과를 `translation_cache`에 저장한다.
