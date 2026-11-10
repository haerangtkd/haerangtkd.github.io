// 해랑경희 칼럼 공용 스크립트
// - [data-mph]: 모핑 (앞 단어가 녹아들 듯 뒤 단어로 바뀜, 앞 단어가 비어 있으면 녹아들 듯 나타남)
// - [data-fx]:  강조 효과 (깜빡임·자라남·밑줄 등, 화면에 다 들어오면 class "on")
// - video[data-auto]: 화면에 보일 때만 소리 없이 반복 재생
// - 웹툰 보기처럼: 위 회차 제목(.vtop), 아래 ◀ 목록 ▶ 바(.vbar), 칼럼 끝 "이전 칼럼 | 칼럼 목록 | 다음 칼럼"(#cnav)
//   회차 순서는 data.json columns를 오래된 것부터 1화, 2화…
(function(){
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var OPT = {threshold:[0, .9], rootMargin:'0px 0px -18% 0px'};

  if(hasIO && !still){
    document.documentElement.classList.add('js');

    // 모핑
    // 바뀌는 시간, 바뀌기 전 기다리는 시간(ms) — 빈자리에서 나타나는 건 빠르게, 단어가 바뀌는 건 조금 천천히
    var T = function(el){ return el.children[0].textContent ? {dur:1400, wait:450} : {dur:850, wait:150}; };
    var blur = function(v){ return 'blur(' + Math.min(v, 100).toFixed(2) + 'px)'; };
    var set = function(el, t){
      var a = el.children[0], b = el.children[1];
      var u = Math.max(t, 0.0001), w = Math.max(1 - t, 0.0001);
      b.style.filter = blur(8 / u - 8); b.style.opacity = Math.pow(t, 0.4);
      a.style.filter = blur(8 / w - 8); a.style.opacity = Math.pow(1 - t, 0.4);
    };
    var reset = function(el){
      el.classList.remove('run'); el._done = false; clearTimeout(el._tm); cancelAnimationFrame(el._raf);
      var a = el.children[0], b = el.children[1];
      a.style.filter = b.style.filter = ''; a.style.opacity = 1; b.style.opacity = 0;
    };
    var play = function(el){
      if(el._done) return; el._done = true;
      var tm = T(el);
      el._tm = setTimeout(function(){
        var t0 = performance.now(); el.classList.add('run');
        (function step(now){
          var p = Math.min((now - t0) / tm.dur, 1), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          set(el, e);
          if(p < 1) el._raf = requestAnimationFrame(step);
          else { el.classList.remove('run'); el.children[0].style.filter = ''; el.children[1].style.filter = ''; }
        })(t0);
      }, tm.wait);
    };
    var mio = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.intersectionRatio >= .9) play(e.target);
        else if(!e.isIntersecting) reset(e.target);
      });
    }, OPT);
    [].forEach.call(document.querySelectorAll('[data-mph]'), function(el){ reset(el); mio.observe(el); });

    // 강조 효과
    var fio = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.intersectionRatio >= .9) e.target.classList.add('on');
        else if(!e.isIntersecting) e.target.classList.remove('on');
      });
    }, OPT);
    [].forEach.call(document.querySelectorAll('[data-fx]'), function(el){ fio.observe(el); });
  }

  // 영상: 보일 때만 재생
  var vids = document.querySelectorAll('video[data-auto]');
  if(vids.length && hasIO){
    var vio = new IntersectionObserver(function(es){
      es.forEach(function(e){
        var v = e.target;
        if(e.isIntersecting){ if(v.preload === 'none') v.preload = 'auto'; var p = v.play(); if(p && p.catch) p.catch(function(){}); }
        else v.pause();
      });
    }, {threshold:.35});
    [].forEach.call(vids, function(v){ v.muted = true; vio.observe(v); });
  }
  // 영상 위 소리 켜기/끄기 (기본은 소리 꺼짐, 하나를 켜면 다른 영상 소리는 꺼짐)
  var SND = {
    off:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    on:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
  };
  var sndBtns = [];
  [].forEach.call(document.querySelectorAll('video'), function(v){
    var box = v.parentNode, b = document.createElement('button');
    b.type = 'button'; b.className = 'snd'; b.innerHTML = SND.off; b.setAttribute('aria-label', '소리 켜기');
    var paint = function(){ b.innerHTML = v.muted ? SND.off : SND.on; b.setAttribute('aria-label', v.muted ? '소리 켜기' : '소리 끄기'); };
    b.onclick = function(){
      var turnOn = v.muted;
      sndBtns.forEach(function(o){ o.v.muted = true; o.paint(); });
      v.muted = !turnOn;
      if(turnOn){ var p = v.play(); if(p && p.catch) p.catch(function(){}); }
      paint();
    };
    sndBtns.push({v:v, paint:paint});
    box.appendChild(b);
  });

  // 웹툰 보기 화면
  var IC = {
    prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5v14L5 12z"/></svg>',
    next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>'
  };
  var me = 'columns/' + location.pathname.split('/').pop();
  var esc = function(t){ return String(t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
  document.body.classList.add('viewer');
  var bar = document.createElement('nav'); bar.className = 'vbar'; bar.setAttribute('aria-label', '칼럼 넘기기');
  bar.innerHTML = '<span class="lab"></span><a class="pv off" aria-label="이전 칼럼">' + IC.prev + '</a><button type="button" class="ls" aria-label="회차 목록">' + IC.list + '</button><a class="nx off" aria-label="다음 칼럼">' + IC.next + '</a>';
  var pop = document.createElement('div'); pop.className = 'vlist';
  document.body.appendChild(pop); document.body.appendChild(bar);
  bar.querySelector('.ls').onclick = function(e){ e.stopPropagation(); pop.classList.toggle('open'); };
  document.addEventListener('click', function(e){ if(!pop.contains(e.target)) pop.classList.remove('open'); });

  // 아래로 읽는 중엔 위·아래 바 숨기고, 위로 올리거나 끝에 닿으면 다시 보이기
  var lastY = scrollY;
  addEventListener('scroll', function(){
    var y = scrollY, end = y + innerHeight > document.documentElement.scrollHeight - 80;
    if(end || y < 60 || y < lastY - 6) document.documentElement.classList.remove('vhide');
    else if(y > lastY + 6 && !pop.classList.contains('open')) document.documentElement.classList.add('vhide');
    lastY = y;
  }, {passive:true});

  var nav0 = document.getElementById('cnav');
  if(nav0){
    var A = {
      share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
      insta:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>',
      tel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
      list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
    };
    nav0.innerHTML = '<div class="acts">'
      + '<button type="button" class="sh" aria-label="공유">' + A.share + '</button>'
      + '<a href="https://www.instagram.com/haerang_tkd" target="_blank" rel="noopener" aria-label="인스타그램">' + A.insta + '</a>'
      + '<a href="tel:01099179954" aria-label="전화">' + A.tel + '</a>'
      + '<a href="../column.html" aria-label="칼럼 목록">' + A.list + '</a></div>';
    nav0.querySelector('.sh').onclick = function(){
      var url = location.href.split('#')[0], title = document.title;
      if(navigator.share) navigator.share({title:title, url:url}).catch(function(){});
      else if(navigator.clipboard) navigator.clipboard.writeText(url).then(function(){ alertLite('링크를 복사했습니다'); });
    };
  }
  function alertLite(t){ var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function(){ d.remove(); }, 1800); }

  if(window.fetch) fetch('../data.json?t=' + Date.now()).then(function(r){ return r.json(); }).then(function(d){
    var eps = (d.columns || []).filter(function(c){ return c && c.title && c.url && !/^https?:/.test(c.url); }).reverse();   // 오래된 것부터
    var i = -1;
    eps.forEach(function(c, k){ if(c.url.split('?')[0] === me) i = k; });
    if(i < 0) return;
    var href = function(c){ return '../' + c.url; };
    var no = function(k){ return (k + 1) + '화'; };
    var pv = eps[i - 1], nx = eps[i + 1];
    var t = document.getElementById('vTitle');
    if(t) t.innerHTML = no(i) + '<small>' + esc(eps[i].title) + '</small>';
    bar.querySelector('.lab').textContent = no(i);
    if(pv){ var a = bar.querySelector('.pv'); a.href = href(pv); a.classList.remove('off'); }
    if(nx){ var b = bar.querySelector('.nx'); b.href = href(nx); b.classList.remove('off'); }
    pop.innerHTML = eps.map(function(c, k){ return '<a href="' + esc(href(c)) + '"' + (k === i ? ' class="me"' : '') + '><b>' + no(k) + '</b><span>' + esc(c.title) + '</span></a>'; }).reverse().join('');
    var nav = document.getElementById('cnav');
    if(nav){
      var go = nx || null;
      var card = go
        ? '<a class="nextep" href="' + esc(href(go)) + '">' + (go.image ? '<img src="../' + esc(go.image) + '" alt="">' : '') + '<span><b>다음화 보기</b><small>' + no(i + 1) + ' · ' + esc(go.title) + '</small></span><i>›</i></a>'
        : '<a class="nextep wait" href="../column.html"><span><b>다음화 보기</b><small>' + no(i + 1) + ' 준비 중입니다</small></span><i>›</i></a>';
      nav.insertAdjacentHTML('beforeend', card);
      var old = nav.querySelector('.cl'); if(old) old.remove();
    }
  }).catch(function(){});
})();
