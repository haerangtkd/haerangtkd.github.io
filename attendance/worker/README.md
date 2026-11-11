# 해랑 출석부 서버 만들기 (처음 한 번만)

화면 주소: https://haerangtkd.github.io/attendance/

학부모 알림 앱과 **따로** 쓰는 서버와 데이터베이스입니다. 알림 앱에는 손대지 않습니다.
Cloudflare 무료 요금제로, 알림 서버를 만든 같은 계정에서 만들면 됩니다.

## 1. 출석부 서버 만들기

1. https://dash.cloudflare.com 로그인
2. 데이터베이스: **Storage & databases → D1 SQL database → Create** → 이름 `haerang-att` → Create
3. 서버: **Compute (Workers) → Workers & Pages → Create → Start with Hello World!** → 이름 `haerang-attendance` → Deploy
4. **Edit code** → 안의 코드를 모두 지우고 이 폴더의 `worker.js` 내용을 붙여넣기 → **Deploy**
5. 이 Worker의 **Settings(설정)**
   - **Bindings → Add → D1 database**: 변수 이름 `DB`, 데이터베이스 `haerang-att`
   - **Variables and Secrets → Add** (유형 **Secret**)
     - `ADMIN_PASSWORD` : 관장님 비밀번호 (알림 앱과 같아도 됨) — 사범님 추가, 백업 불러오기, 초기화에 씀
     - `SYNC_KEY` : 아무 긴 글자 (예: `haerang-연동-7f3k9q2m`) — 아래 3번에서 알림 서버에도 똑같이 넣음
6. 위쪽 주소(`https://haerang-attendance.○○○.workers.dev`)를 `attendance/config.js`에 넣기

확인: 주소를 그냥 열었을 때 `"app":"해랑 출석부"`가 나오면 완료입니다. 표(테이블)는 처음 열 때 자동으로 만들어집니다.

## 2. 처음 들어가기

1. https://haerangtkd.github.io/attendance/ 열기
2. 처음 한 번: 관장님 비밀번호(`ADMIN_PASSWORD`) + 내 이름 + 내 PIN(숫자 4~6자리)
3. **사범님 공간 → 사범님 추가 · PIN 초기화**에서 다른 사범님을 추가 (사범님마다 PIN 따로)
4. **사범님 공간 → 백업 파일 불러오기**에서 예전 출석부 백업 파일(.json)을 고르고 **합치기** → 원생과 지난 출결 기록이 모두 들어옵니다
5. 휴대폰에서는 공유 버튼 → **홈 화면에 추가**로 앱처럼 씁니다 (남색 클립보드 아이콘)

## 3. 학부모 알림 앱과 연결하기

알림 서버(`haerang-push`) Worker의 **Settings(설정)** 에서:

- **Bindings → Add → Service binding**: 변수 이름 `ATT`, 서비스 `haerang-attendance`
- **Variables and Secrets → Add** (Secret): 이름 `SYNC_KEY`, 값은 1번에서 정한 것과 **똑같이**
- **Edit code** → `notice/worker/worker.js`의 새 내용으로 바꾸고 **Deploy**

연결되면:
- 아이가 출결 태블릿에서 번호를 누르면 출석부에 **출석 + 시간부**가 자동으로 찍힙니다 (도착 시각으로 시간부를 정함: 수업 시작 1시간 전 ~ 시작 25분 뒤)
- 알림 앱 **관리 → 명단 → 출석부와 비교**에서 출석부에만 있는 아이를 한 번에 등록할 수 있습니다

연결하지 않아도 두 앱은 각자 그대로 동작합니다.

## 무료로 쓸 수 있는 양
- 서버 요청은 알림 서버와 합쳐서 하루 10만 번. 출석부는 사범님 4명이 하루 종일 써도 수천 번 정도입니다.
- 화면은 보고 있을 때만 1분마다 새 기록을 받아 옵니다 (다른 사범님이 누른 출석이 보임).
