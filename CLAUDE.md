# 해랑경희 태권도장 저장소 정리본

이 저장소(`haerangtkd/haerangtkd.github.io`) 하나에 **홈페이지 + 앱 3개**가 들어 있다. 화면은 GitHub Pages, 서버는 Cloudflare Workers(무료)로 돌아간다.
다른 계정·다른 사람이 이어서 작업할 때 이 문서부터 읽는다. (2026-11-11 기준, 업무 앱 개편 반영)

> ⚠️ 공개 저장소다. 비밀번호·연결 키(SYNC_KEY) 값은 여기에 적지 않는다. 값은 Cloudflare 설정에만 있다.

---

## 1. 사용자와 일하는 방식

- 사용자는 도장 직원(비개발자). 관장님과 사범님 3~4명이 앱을 쓴다.
- **판단할 수 있는 일은 직접 하고, 꼭 필요한 결정이나 사용자가 직접 해야 하는 일만 묻는다.** (예: main에 합치기, 배포는 그냥 한다)
- 설명은 쉬운 한국어로 짧게. 코드·서버 용어는 줄인다.
- 브랜드색 `#A40F16`. 로고·목련 이미지는 `img/brand/` (목련은 흰색/검은색만, 로고는 웬만하면 배경 없이).
- **홈페이지 문구**에는 '~에요/~이에요' 말투를 쓰지 않는다 (예외: 오늘의 운동 휴관일 "오늘은 쉬는 날이에요"). 앱 화면 문구는 해요체를 쓴다.

---

## 2. 전체 구성

| 경로 | 무엇 | 누가 씀 | 서버(Worker) · DB(D1) |
|---|---|---|---|
| `/` (index.html 등) | 도장 홈페이지 | 누구나 | 없음 (`data.json` + `app.js`) |
| `/notice/` | **학부모 알림 앱** (학부모용) | 학부모 | `haerang-push` · `haerang` |
| `/notice/admin.html` | 학부모 알림 앱 관리 화면 | 관장님 | 〃 |
| `/notice/kiosk.html` | 출결 태블릿 (아이가 번호 4자리 누름) | 도장 입구 태블릿 | 〃 |
| `/attendance/` | **해랑 출석부** (남색 아이콘) | 사범님만 | `haerang-attendance` · `haerang-att` |
| `/team/` | **해랑 업무** 직원용 협업툴 (남색 #0D326F 아이콘, 플로우 느낌) | 직원 3~4명 | `haerang-team` · `haerang-team` |

- Cloudflare 계정: Worker 주소는 `https://<이름>.labkhu.workers.dev` (계정 ID `71ae15bc88fd598c3458fc253303a0f1`)
- 각 앱의 서버 주소는 그 폴더의 `config.js`에 있다.
- 서비스 워커 범위가 폴더별(`/notice/`, `/attendance/`, `/team/`)이라 같은 사이트 안에서도 서로 겹치지 않는다.

### Cloudflare 설정(바인딩)

| Worker | 바인딩 |
|---|---|
| `haerang-push` (학부모 알림) | D1 `DB`→`haerang`, Secret `ADMIN_PASSWORD`, Secret `SYNC_KEY`, Service `ATT`→`haerang-attendance` |
| `haerang-attendance` (출석부) | D1 `DB`→`haerang-att`, Secret `ADMIN_PASSWORD`, Secret `SYNC_KEY`, Service `NOTICE`→`haerang-push` |
| `haerang-team` (업무) | D1 `DB`→`haerang-team`, Secret `SYNC_KEY`, Service `ATT`→`haerang-attendance` |

`SYNC_KEY`는 세 서버가 같은 값. 서버끼리는 **서비스 바인딩**으로만 부른다(같은 계정 workers.dev끼리 fetch는 막힘). `/sync/...` 경로는 `X-Sync-Key` 헤더가 맞아야 동작한다.

### 앱끼리 연결

```
출결 태블릿 번호 누름 ─▶ haerang-push (등원 알림 → 학부모)
                         └─ ATT /sync/checkin ─▶ 출석부에 '출석' + 시간부 자동 (사범님이 '결석'으로 해 둔 아이는 바꾸지 않고 태블릿 시각만 기록)
알림 앱 관리 > 명단 > 출석부와 비교 ─ ATT /sync/roster ─▶ 출석부에만 있는 아이를 태블릿 명단(출결번호)에 등록
출석부 원생 달력 > 학부모님께 출석 보내기 ─ NOTICE /sync/notify ─▶ 그 아이 보호자에게 푸시 (사범님이 누를 때만)
업무 앱 등원표·행사표 ─ ATT /sync/roster ─▶ 원생 이름 고르기
업무 채팅 '#등원 ○○ 결석' ─ ATT /sync/absence ─▶ 출석부 결석 예정
```

원칙: **출석부 내용(출석률·사유·PDF)은 학부모에게 자동으로 가지 않는다.** 학부모는 태블릿 등원·하원 알림만 받는다.

---

## 3. 앱별 요약

### 3-1. 학부모 알림 앱 `notice/` (먼저 만든 앱, 건드릴 때 조심)
- 학부모 앱(키즈노트처럼): 공지·알림장·일정·앨범·회비·출석부(등·하원 시각). 가입 시 아이 이름·관계·휴대폰 뒷자리 → 관장님 승인.
- 관리 화면: 관장님 비밀번호(`ADMIN_PASSWORD`). 탭: 출결·소식·회비·명단(출석부와 비교 카드).
- 태블릿: 번호 4자리 → 등원/하원, 등원 후 30분 지나야 하원.
- 테이블: `parents, kids(name, codes), att(day,name,tin,tout), posts, photos, fees, reads, kiosks, fails, kv(vapid)`.
- 푸시는 무료 CPU 한도 때문에 6대씩 나눠 보냄(관리 화면이 이어서 부름).

### 3-2. 해랑 출석부 `attendance/` (예전 ChatGPT 출석부를 대체)
- 로그인: 사범님마다 이름 + PIN(숫자 4~6). 기기마다 한 번만, 쓰는 동안 계속 유지(6개월 미사용 시 다시). 5번 틀리면 1분 잠금.
- 맨 처음 설정만 `ADMIN_PASSWORD` 필요. 그 뒤 관리 메뉴(사범님 추가·PIN 초기화·백업 불러오기·초기화)는 로그인한 사범님이면 됨.
- 탭: **오늘 출석**(출석/결석/임시변경, 시간부 2·3·4·5·6·8·9, 여러 명 한꺼번에, 휴관, 보강, 안 오는 아이는 목록 안에 회색 X·보강, 태블릿 기록과 다름 표시) / **원생 관리** / **출결관리**(미리 연락 온 결석, 달력, 체험 수업) / **월별 기록**(출석률, 가로 PDF는 canvas로 그린 A4 가로 PDF를 직접 만들어 내려받음).
- 시간표: 2시~2:50, 3시, 4시, 5시, 6:40~7:30(6시부), 8시, 9시. 태블릿 도착 시각 → 시작 1시간 전 ~ 시작 25분 뒤면 그 시간부.
- 학년: 출생연도로 자동(3월 기준 학년, 유치부는 어린이집 이름 표시).
- 출석률 = 출석한 날 ÷ 오늘까지 수련 대상일 (휴관·휴원·안 오는 날 제외, 보강 포함), 80% 미만 빨강.
- 테이블: `teachers, sessions, students(id, data JSON), att(day, sid, r 'o'/'x'/'', p 시간부 '6/8', w 사유, mk 보강, who, at, tin 태블릿시각), absences, trials, history, closed, fails`.
- 백업 JSON은 예전 앱 형식과 같음(`students, att{day:{r,p,w}}, absences, trials, history, closed`) → 서로 불러오기 가능. 원생 90명·출결 1,923건을 옮겨서 예전 앱과 숫자가 같은 것 확인함.

### 3-3. 해랑 업무 `team/` (플로우·FamilyLog 대체)
- 2026-11-11 개편: 색 `#0D326F`(남색), 플로우 모바일 느낌. 아래 탭 5개 **홈 · 채팅 · 일정 · 행사표 · 알림**.
  - 홈: 남색 머리(참여자 동그라미) → 상단고정(채팅 공지 + 진행 중 신청표, D-day/진행률) → 할 일 → 등원·픽업 → 다가오는 일정(달력 아이콘 모양). 오른쪽 아래 + 버튼 = 새로 만들기(할 일·일정·행사·물품 신청·구매·채팅).
  - 채팅: 날짜 알약, 사람마다 색 동그라미, 이어 보낸 말은 묶음. 말풍선 길게 누르기 → 반응 6개(❤️👍✅😊😮😭)·답장·텍스트 복사·공지로 올리기·할 일/일정으로 만들기·삭제(전체). [+] → 카메라·사진·할 일·일정·공지 보기. 오른쪽 위 ≡ 서랍 → 사진·공지·링크·검색, 참여자, 알림·설정. 공지는 채팅 위에 띠로 고정.
  - 행사표: 예전 '해랑경희 행사 신청표' 모양 — 필터(전체·행사·물품·구매·완료) + [+ 만들기], 연도·월로 묶고 '날짜 없음' 따로, 카드(종류 뱃지·D-day·신청/결제/미결제 또는 주문/결제·지급·미결제·진행 막대, 다 되면 초록). 물품 신청표는 행사표와 같은 구조에 `kind:'goods'`. 상세에서 [완료로] → `closed`.
  - 알림 탭: 신청표 알림처럼 누가·무엇을 했는지 기록(이름 동그라미 + 종류 뱃지). 채팅은 빼고 기록. 읽은 위치는 기기마다(localStorage).
  - 큰 회사용(AI 미팅노트·메일·전자결재·조직도)은 넣지 않기로 함.
- 로그인: 사람마다 이름 + PIN (출석부와 따로). 맨 처음 들어온 사람이 첫 계정을 만듦(관리자 비밀번호 없음).
- 홈: 할 일(맨 위) → 등원·픽업표(요일별 기본 명단 + 날짜별, 누르면 데려옴 ✓, 길게 누르면 결석, 메모) → 다가오는 일정 → 행사·구매.
- 채팅: 사진, 해시태그 `#일정 #할일 #등원 #구매 #행사` (예: `#일정 11/20 3시 승급심사` 자동 등록). 날짜만 있는 말엔 [일정으로 등록] 버튼. 날짜 해석은 `parseWhen()`(11/20, 11월 20일, 20일, 내일, 다음주 화요일, 3시=오후 3시 등).
- 일정 달력, 행사 인원표(예전 '행사 신청표' 구조: 품목·금액 합산, 선택 항목, 체크 칸, 결제확인·지급·하원차, 대기자, 비회원), 물품 구매표, 모든 항목에 댓글.
- 알림: 채팅·댓글·체크·수정 전부 웹 푸시(본인 제외). 아이폰은 홈 화면에 추가한 앱에서 알림 켜기. 앱 아이콘 숫자 = 남은 할 일 + 새 채팅. (진짜 홈 화면 위젯은 웹앱이라 불가)
- 새 내용은 화면을 보고 있을 때만 받아옴(채팅 4초, 그 외 15초) → 무료 한도 절약.
- 테이블: `members, sessions, subs(푸시), msgs(+reply, rx 반응 JSON, upd), items(id, type todo/sched/event/buy, data JSON, upd, del), comments, pickup(day, data), photos, logs(알림 기록: mid, kind, text, ref, at · 90일), kv(vapid, pickupDefault, notice 채팅 공지), fails`. `/api/sync?since=`로 바뀐 것만 받음(반응·삭제된 메시지는 msgs.upd로). 새 칸은 서버가 처음 돌 때 ALTER로 자동 추가.
- API 추가: `/api/msg-react {id,e}`, `/api/notice {id|0}`, `/api/msg`에 `reply`.

### 3-4. 홈페이지
- 화면은 `app.js`가 `data.json`을 읽어 그림. 메뉴 페이지는 `python3 tools/build_pages.py`로 생성(네이버 검색용 본문 포함).
- `columns/`: '해랑경희 칼럼' — 웹툰처럼 위아래로 이어지게, 번호 없음, 원문 그대로. 강조 부분만 효과(글자를 지우고 바꾸는 효과는 싫어함 → 확대했다 돌아오기). 예전 네이버 블로그 글을 옮기는 중, 사진은 홈페이지 사진 우선·칼럼끼리 겹치지 않게.

---

## 4. 배포하는 법

- **화면(HTML)**: `main`에 push하면 GitHub Pages가 1~2분 뒤 반영.
- **서버(Worker)**: Cloudflare 대시보드 → Worker → Edit code에 `*/worker/worker.js` 붙여넣고 Deploy. 표는 처음 실행 때 자동 생성.
- 클라우드 작업 공간에서 GitHub에 바로 push가 막힐 때(새 계정): 크롬에서 저장소 zip을 받아 고친 뒤, GitHub 웹 '파일 올리기'(`/upload/main/<폴더>`)로 올려 커밋한다.
- Claude가 직접 배포할 때(이번에 쓴 방법): 사용자 크롬(Claude in Chrome 확장)에서 Cloudflare 대시보드에 로그인된 탭을 열고, 그 탭에서 JS로 대시보드 API를 부른다.
  - `PUT /api/v4/accounts/<계정ID>/workers/scripts/<이름>` (multipart: `metadata` + `worker.js`, `main_module:'worker.js'`)
  - 코드만 바꿀 땐 metadata에 **`keep_bindings: ['secret_text','d1','service']`** 를 꼭 넣는다 (안 넣으면 비밀번호·DB 연결이 지워짐).
  - D1 직접 조회: `POST /api/v4/accounts/<계정ID>/d1/database/<DB id>/query {sql}`
  - Claude 앱 안 브라우저는 Cloudflare 로그인 확인(사람 확인)에서 막힘 → 크롬 확장 사용.
- 학부모 앱 서버를 바꾸기 전엔 지금 돌아가는 코드가 저장소와 같은지 확인한다(`/workers/scripts/haerang-push/content/v2`).

## 5. 컴퓨터에서 테스트

```
node tools/local-test/server.mjs     # Node 22+
# http://localhost:8787/attendance/  /team/  /notice/admin.html
```
세 서버를 SQLite로 흉내 내서 함께 돌린다(서로 연결도 됨). 테스트 비밀값은 `kwanjang` / `sync123`.

## 6. 무료 한도

세 Worker가 계정의 무료 한도(요청 하루 10만 번, D1 쓰기 10만 줄)를 같이 쓴다. 자동 새로고침은 화면을 볼 때만, 간격을 짧게 하지 말 것. 푸시는 한 요청에 여러 대 보내면 CPU 10ms를 넘을 수 있음.

## 7. 남은 일 · 확인 못 한 것

- 업무 앱: 실제 서버에서 첫 설정·사람 추가·휴대폰 알림을 아직 사용자가 확인 중. FamilyLog와 며칠 같이 쓰며 불편한 점 받기로 함.
- 출석부: 예전 앱 최신 백업을 '합치기'로 넣고 예전 앱 중단, 다른 사범님 추가, 알림 앱 '출석부와 비교'로 태블릿 명단 등록 — 사용자가 진행.
- 관장님용 장부 앱은 별도(claude.ai 아티팩트, 이 저장소 아님).
