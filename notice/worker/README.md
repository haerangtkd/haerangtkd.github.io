# 해랑경희 알림 서버 만들기 (처음 한 번만)

앱 3개가 이 서버 하나를 같이 씁니다.
- 학부모용: https://haerangtkd.github.io/notice/
- 관리용: https://haerangtkd.github.io/notice/admin.html
- 출결 태블릿: https://haerangtkd.github.io/notice/kiosk.html

Cloudflare 무료 요금제로 카드 등록 없이 만들 수 있습니다.

1. https://dash.cloudflare.com 에서 회원가입·로그인
2. 데이터베이스 만들기: 메뉴 **Storage & databases → D1 SQL database → Create** → 이름 `haerang` → Create
3. 서버 만들기: 메뉴 **Compute (Workers) → Workers & Pages → Create → Start with Hello World!** → 이름 `haerang-push` → Deploy
4. **Edit code** → 안의 코드를 모두 지우고 이 폴더의 `worker.js` 내용을 붙여넣기 → **Deploy**
5. Worker의 **Settings(설정)**
   - **Bindings → Add → D1 database**: 변수 이름 `DB`, 데이터베이스 `haerang`
   - **Variables and Secrets → Add**: 유형 **Secret**, 이름 `ADMIN_PASSWORD`, 값은 관장님 비밀번호(길게)
6. 위쪽 주소(`https://haerang-push.○○○.workers.dev`)를 `notice/config.js`에 넣기

확인: 주소 뒤에 `/vapid`를 붙여 열었을 때 `"ok":true`가 나오면 완료입니다. 표(테이블)는 처음 열 때 자동으로 만들어집니다.

## 무료 사용량 (D1)
- 하루 읽기 500만 번, 쓰기 10만 번, 저장 공간 5GB
- 사진은 1장에 약 0.3~0.5MB로 줄여 저장 → 1만 장 이상 저장 가능
