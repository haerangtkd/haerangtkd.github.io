// 해랑경희 칼럼 공용 스크립트
// - [data-mph]: 모핑 (앞 단어가 녹아들 듯 뒤 단어로 바뀜, 앞 단어가 비어 있으면 녹아들 듯 나타남)
// - [data-fx]:  강조 효과 (깜빡임·자라남·밑줄 등, 화면에 다 들어오면 class "on")
// - video[data-auto]: 화면에 보일 때만 소리 없이 반복 재생
// - #cnav: 칼럼 끝 "다음 칼럼 | 칼럼 목록" (다음 칼럼이 없으면 칼럼 목록만)
(function(){
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var OPT = {threshold:[0, .9], rootMargin:'0px 0px -18% 0px'};

  if(hasIO && !still){
    document.documentElement.classList.add('js');

    // 모핑
    var DUR = 2000, WAIT = 900;   // 바뀌는 시간, 바뀌기 전 기다리는 시간(ms)
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
      el._tm = setTimeout(function(){
        var t0 = performance.now(); el.classList.add('run');
        (function step(now){
          var p = Math.min((now - t0) / DUR, 1), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          set(el, e);
          if(p < 1) el._raf = requestAnimationFrame(step);
          else { el.classList.remove('run'); el.children[0].style.filter = ''; el.children[1].style.filter = ''; }
        })(t0);
      }, WAIT);
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

  // 칼럼 끝: 다음 칼럼 | 칼럼 목록
  var nav = document.getElementById('cnav');
  if(nav && window.fetch){
    var me = 'columns/' + location.pathname.split('/').pop();
    fetch('../data.json?t=' + Date.now()).then(function(r){ return r.json(); }).then(function(d){
      var cs = (d.columns || []).filter(function(c){ return c && c.title; });
      var i = -1;
      cs.forEach(function(c, k){ if((c.url || '').split('?')[0] === me) i = k; });
      var nx = i >= 0 ? cs[i + 1] : null;
      if(!nx || !nx.url) return;
      var ext = /^https?:/.test(nx.url);
      var a = document.createElement('a'); a.href = ext ? nx.url : '../' + nx.url; a.className = 'next';
      if(ext){ a.target = '_blank'; a.rel = 'noopener'; }
      a.textContent = '다음 칼럼'; a.title = nx.title;
      var sep = document.createElement('i'); sep.textContent = '|';
      nav.insertBefore(sep, nav.firstChild); nav.insertBefore(a, nav.firstChild);
    }).catch(function(){});
  }
})();
