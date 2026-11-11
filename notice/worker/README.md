# 해랑경희 알림 서버 만들기 (처음 한 번만)

앱 3개가 이 서버 하나를 같이 씁니다.
- 학부모용: https://haerangtkd.github.io/notice/
- 관리용: https://haerangtkd.github.io/notice/admin.html
- 출결 태블릿: https://haerangtkd.github.io/notice/kiosk.html

알림을 실제로 보내 주는 무료 서버를 Cloudflare에 만듭니다. 카드 등록 없이 무료입니다.

1. https://dash.cloudflare.com 에서 회원가입·로그인
2. 왼쪽 메뉴 **저장소 및 데이터베이스(Storage & Databases) → KV** → **만들기** → 이름 `haerang-push` → 만들기
3. 왼쪽 메뉴 **Compute(Workers) → Workers 및 Pages** → **만들기** → **Hello World 시작** → 이름 `haerang-push` → 배포
4. **코드 편집** → 안에 있는 코드를 모두 지우고 이 폴더의 `worker.js` 내용을 그대로 붙여넣기 → **배포**
5. Worker의 **설정(Settings)** 탭
   - **바인딩(Bindings) → 추가 → KV 네임스페이스**: 변수 이름 `DB`, 네임스페이스 `haerang-push`
   - **변수 및 비밀(Variables and Secrets) → 추가**: 유형 **비밀(Secret)**, 이름 `ADMIN_PASSWORD`, 값은 관장님이 쓸 비밀번호
6. 위쪽에 보이는 주소(`https://haerang-push.○○○.workers.dev`)를 복사해 `notice/config.js`에 넣기

확인: 주소 뒤에 `/vapid`를 붙여 열었을 때 `"ok":true`가 나오면 완료입니다.

## 무료 사용량
- 하루 10만 번 요청, KV 쓰기 하루 1,000번 — 도장 규모로는 넉넉합니다.
- 등원·하원 알림 1번 = 쓰기 0번, 전체 공지 1번 = 쓰기 1번, 학부모님 등록 1번 = 쓰기 1번
