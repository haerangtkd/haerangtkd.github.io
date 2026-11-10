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
      var parts = [];
      if(pv) parts.push('<a href="' + esc(href(pv)) + '">이전 칼럼</a>');
      parts.push('<a href="../column.html">칼럼 목록</a>');
      if(nx) parts.push('<a href="' + esc(href(nx)) + '">다음 칼럼</a>');
      nav.innerHTML = parts.join('<i>|</i>');
    }
  }).catch(function(){});
})();
