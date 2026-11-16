// 2026-11-16: 홈 화면 앱(특히 아이폰)이 예전 화면을 붙잡고 있을 때, 새 화면이 올라와 있으면 바로 새로 불러옴.
// 이 페이지의 글 안 스크립트가 (스타일은 다른 파일이 화면에서 덧붙이기도 해서 안 봄) 지금 서버 파일에 그대로 있는지만 봄 (같으면 아무것도 안 함).
(() => {
  const mine = [...document.querySelectorAll('script:not([src])')].map(e => e.textContent).filter(t => t.length > 200);
  if (!mine.length) return;
  let busy = false, lastAt = 0;
  async function check() {
    if (busy || document.hidden || Date.now() - lastAt < 20000) return; busy = true; lastAt = Date.now();
    try {
      const r = await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const t = (await r.text()).replace(/\r\n/g, '\n');
      if (mine.every(s => t.includes(s))) return;
      const k = 'haerang-fresh:' + location.pathname, last = +sessionStorage.getItem(k) || 0;
      if (Date.now() - last < 60000) return; // 1분 안에 두 번은 안 함
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { lastAt = 0; return; } // 적는 중이면 다음에
      sessionStorage.setItem(k, Date.now());
      try { await fetch(location.pathname, { cache: 'reload' }); } catch (_) {}
      location.reload();
    } catch (_) {} finally { busy = false; }
  }
  setTimeout(check, 1500);
  document.addEventListener('visibilitychange', check);
  addEventListener('pageshow', e => { if (e.persisted) check(); });
})();
