// 제자 QR 읽기 (2026-11-15): 출결 태블릿(전면 카메라) · 업무 앱 마일리지(후면 카메라)가 같이 씀
// 쓰는 법: const stop = await HQR.start(videoEl, { facing: 'user' | 'environment', onCode: txt => {...} })
// 카메라가 QR을 직접 읽는 BarcodeDetector(안드로이드 크롬 등)를 먼저 쓰고, 없으면(아이폰·아이패드) jsQR을 불러와 읽음
(function () {
  let jsqrP = null;
  const loadJsQR = () => jsqrP || (jsqrP = new Promise((ok, no) => {
    if (window.jsQR) return ok(window.jsQR);
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    s.onload = () => ok(window.jsQR); s.onerror = () => { jsqrP = null; no(new Error('QR 읽기 도구를 불러오지 못했어요. 인터넷을 확인해 주세요')); }; document.head.appendChild(s);
  }));
  async function start(video, o) {
    o = o || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('이 기기에서는 카메라를 쓸 수 없어요');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: o.facing || 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
    catch (e) { throw new Error('카메라를 켤 수 없어요. 카메라 권한을 허용해 주세요'); }
    video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = stream; try { await video.play(); } catch (_) {}
    let det = null; try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) det = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) {}
    const jsQR = det ? null : await loadJsQR();
    const cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
    let live = true, last = '', lastAt = 0, t = null;
    const hit = txt => { const now = Date.now(); if (!txt || (txt === last && now - lastAt < 4000)) return; last = txt; lastAt = now; try { o.onCode && o.onCode(txt); } catch (_) {} };
    const tick = async () => {
      if (!live) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          if (det) { const r = await det.detect(video); if (r && r[0]) hit(r[0].rawValue); }
          else { const W = 480, H = Math.round(W * video.videoHeight / video.videoWidth); cv.width = W; cv.height = H; g.drawImage(video, 0, 0, W, H); const im = g.getImageData(0, 0, W, H), r = jsQR(im.data, W, H, { inversionAttempts: 'dontInvert' }); if (r && r.data) hit(r.data); }
        }
      } catch (_) {}
      t = setTimeout(tick, 220);
    };
    tick();
    return () => { live = false; clearTimeout(t); try { stream.getTracks().forEach(x => x.stop()); } catch (_) {} video.srcObject = null; };
  }
  window.HQR = { start, isKidQr: s => /^HRK1-[A-Z0-9]{6,20}$/.test(String(s || '').trim()) };
})();
