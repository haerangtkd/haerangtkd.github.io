const ICONS = {
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  news:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h6M7 12h10M7 16h10"/>',
  blog:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  insta:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>',
  youtube:'<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3Z" fill="currentColor"/>',
  phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  map:'<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  heart:'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  award:'<circle cx="12" cy="9" r="5"/><path d="m8.5 13-1.5 8 5-3 5 3-1.5-8"/>',
  grad:'<path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
  shield:'<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z"/>',
  bldg:'<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.3 4.5 2.3 4.5 5.4"/>',
  medal:'<circle cx="12" cy="15" r="5"/><path d="M8.5 11 6 3h4l2 5 2-5h4l-2.5 8"/>',
  share:'<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.3 10.8 7.4-4.4M8.3 13.2l7.4 4.4"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
  chat:'<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9.5h8M8 12.5h5"/>',
  kakao:'<path d="M12 4C7 4 3 7.1 3 11c0 2.5 1.7 4.7 4.2 6L6.5 20l3.6-2.3c.6.1 1.2.1 1.9.1 5 0 9-3.1 9-7s-4-6.8-9-6.8Z"/>',
  photo:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>',
  bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.2h5.2c0-.9.4-1.7 1-2.2A6 6 0 0 0 12 3Z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z"/><path d="M4 21V5"/><path d="M8 7h8"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2.2-2.5 4"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  run:'<circle cx="14" cy="4.5" r="2"/><path d="m6 20 3.5-5 3 2 1.5-6"/><path d="M9 9.5 12 8l3 3 3.5 1"/><path d="m14 11-2 5"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  up:'<path d="m6 15 6-6 6 6"/>', left:'<path d="m15 6-6 6 6 6"/>', right:'<path d="m9 6 6 6-6 6"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>', car:'<path d="M5 17h14v-4l-2-5H7l-2 5Z"/><path d="M5 13h14"/><circle cx="8" cy="17" r="1.8"/><circle cx="16" cy="17" r="1.8"/>', copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', plus:'<path d="M12 5v14M5 12h14"/>', pause:'<path d="M9 6v12M15 6v12"/>', play:'<path d="m8 5 11 7-11 7Z"/>', megaphone:'<path d="M3 10v4h3l8 5V5L6 10Z"/><path d="M18 9a4 4 0 0 1 0 6"/>', close:'<path d="M6 6l12 12M18 6 6 18"/>',
  gift:'<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8S10.5 3.5 8 4.2 7.6 8 12 8Zm0 0s1.5-4.5 4-3.8.4 3.8-4 3.8Z"/>',
  won:'<path d="M4 7l3.5 11L12 8l4.5 10L20 7"/><path d="M3 11.5h18M3 14.5h18"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
};
const EV_COLORS = { '수련':'#3C8D5A', '기네스':'#B8860B', '심사':'#A40F16', '대회':'#1F3B63', '행사':'#D9822B', '휴관':'#8A837E', '기타':'#2E9C9A' };
const DAYS = ['월','화','수','목','금'];
const WEEK = ['일','월','화','수','목','금','토'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg = (name, sw=2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.link}</svg>`;
// 카카오톡·인스타·블로그·유튜브는 실제 로고 그림으로
const LOGOS = { kakao:'img/sns/kakao.png', insta:'img/sns/insta.png', blog:'img/sns/blog.png?v=3', youtube:'img/sns/youtube.png', calendar:'img/sns/naver-booking.png?v=1' };
const ico = name => LOGOS[name] ? `<img class="logo-ic lg-${name}" src="${LOGOS[name]}" alt="">` : svg(name);
const arrow = '<svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const list = a => (a || []).filter(Boolean);

// 날짜 (한국 시간 기준 오늘)
const pad = n => String(n).padStart(2, '0');
const ymd = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
const parseD = s => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y, m-1, d); };
const TODAY = (() => { const n = new Date(); const k = new Date(n.getTime() + (n.getTimezoneOffset() + 540) * 60000); return new Date(k.getFullYear(), k.getMonth(), k.getDate()); })();
const dayDiff = (a, b) => Math.round((a - b) / 86400000);
const krDate = dt => `${dt.getMonth()+1}월 ${dt.getDate()}일 ${WEEK[dt.getDay()]}요일`;

let D, EVENTS = [], S = {}, GROUPS = [];

// ---------- 페이지 나누기 (검색엔진용 실제 주소) ----------
// 메뉴 그룹마다 별도 HTML 파일이 있고, 같은 화면을 그 그룹부터 보여줌
const PAGE_FILES = {
  'about.html':    ['philosophy','curriculum','staff','location'],
  'culture.html':  ['character','leaders','belts','guinness','growth'],
  'training.html': ['program','timetable','today','fee','faq'],
  'news.html':     ['schedule','notice','gallery','press'],
  'contact.html':  ['contact']
};
const START = window.START_PAGE || '';          // 하위 페이지에서 처음 보여줄 메뉴
const HERE = location.pathname.split('/').pop() || 'index.html';
const HOME = START ? './' : '#/';
function go(id){
  const f = Object.keys(PAGE_FILES).find(k => PAGE_FILES[k].includes(id));
  if(!f) return '#/' + id;
  return (f === HERE ? '' : f) + '#/' + id;
}
const sec = (id, title, inner) => `<section class="sec" id="sec-${id}" data-id="${id}" hidden>${title ? `<h3 class="st">${esc(title)}</h3>` : ''}${inner}</section>`;

function render(d){
  D = d; S = {};
  EVENTS = list(d.schedule).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).map(e => {
    const s = parseD(e.date); let en = e.end && /^\d{4}-\d{2}-\d{2}$/.test(e.end) ? parseD(e.end) : s;
    if(en < s) en = s;
    return {...e, s, en};
  });
  EVENTS = EVENTS.concat(guinnessEvents(d, EVENTS)).sort((a, b) => a.s - b.s);

  const brand = esc(d.footerSub || '해랑경희 태권도장');
  const tel0 = ((d.contact || {}).phone || '').replace(/[^0-9+]/g, '');
  const intro = list(d.intro).map(p => `<p>${esc(p).split(brand).join(`<strong>${brand}</strong>`)}</p>`).join('');

  const ph = d.philosophy || {};
  if(list(ph.questions).length || list(ph.message).length) S.philosophy = {label:'교육 철학', icon:'bulb', html: sec('philosophy', ph.title || '교육 철학', `
      ${list(ph.questions).map((q,i) => (i ? '<div class="plus">+</div>' : '') + `<div class="q ${i % 2 ? 'q2' : 'q1'}">${esc(q)}</div>`).join('')}
      ${list(ph.message).length ? `<div class="card letter">${list(ph.message).map(p => `<p>${esc(p)}</p>`).join('')}<p class="sign">감사합니다.</p></div>` : ''}`)};


  const st = d.staff || {};
  if(list(st.members).length) S.staff = {label:'지도진 소개', short:'지도진', icon:'user', html: sec('staff', st.title || '지도진 소개', `
      ${st.lead ? `<p class="lead">${esc(st.lead)}</p>` : ''}
      <div class="staff">${list(st.members).map((m,i) => `
        <div class="card member${i === 0 ? ' lead-member' : ''}">
          ${m.photo ? `<img class="photo" src="${esc(m.photo)}" alt="${esc(m.name)} ${esc(m.role)}" loading="lazy">` : ''}
          <div class="body">
            <div class="who"><span class="role">${esc(m.role)}</span><span class="name">${esc(m.name)}</span></div>
            <ul>${list(m.career).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          </div>
        </div>`).join('')}
      </div>
      ${st.note ? `<p class="note">${esc(st.note)}</p>` : ''}`)};

  const cu = d.curriculum || {};
  if(list(cu.areas).length || list(cu.goals).length) S.curriculum = {label:'교육 내용', icon:'book', html: sec('curriculum', cu.title || '교육 내용', `
      ${list(cu.purposes).length ? `<p class="cu-line">${list(cu.purposes).map(x => `<span>${esc(x)}</span>`).join('<i>|</i>')}</p>` : ''}
      ${(() => {
        const norm = t => String(t || '').replace(/\s/g, '');
        const areas = list(cu.areas).map(a => ({...a, gs: []}));
        const rest = [];
        list(cu.goals).forEach(g => {
          const words = (norm(g.title) + ',' + norm(g.desc)).split(/[,·와과]/).filter(w => w.length > 1);
          const a = areas.find(a => list(a.items).some(it => words.some(w => norm(it).includes(w) || w.includes(norm(it)))));
          (a ? a.gs : rest).push(g);
        });
        return `<div class="cu-areas">${areas.map((a, i) => `<div class="cu-area"><span class="n">${pad2(i + 1)}</span><h4>${esc(a.name)}</h4>
          <p class="learn">${list(a.items).map(esc).join(' · ')}</p>
          ${a.gs.length ? `<p class="grow1">${a.gs.map(g => `<b>${esc(g.title)}</b>`).join('<i>·</i>')}</p>` : ''}</div>`).join('')}</div>
          ${rest.length ? `<ul class="grow">${rest.map(g => `<li><b>${esc(g.title)}</b><span>${esc(g.desc || '')}</span></li>`).join('')}</ul>` : ''}`;
      })()}
      ${cu.closing ? `<p class="cu-close">${esc(cu.closing).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>` : ''}`)};

  // ---------- 인성 · 성장 ----------
  const L = d.leaders || {};
  if(list(L.groups).length) S.leaders = {label: '선범단', icon:'star', html: sec('leaders', '', `
      <div class="ld"><h4>${esc(L.title || '선범단')}</h4>${L.lead ? `<p class="ld-lead">${esc(L.lead)}</p>` : ''}${list(L.groups).map(g => `<div class="cu-row"><b>${esc(g.t)}</b><ul>${list(g.items).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}${L.closing ? `<p class="cu-close">${esc(L.closing)}</p>` : ''}</div>`)};
  const ch = d.character || {};
  if(ch.title || list(ch.blocks).length) S.character = {label:'인성 교육', icon:'heart', html: sec('character', ch.title || '인성 교육', `
      ${ch.lead ? `<p class="lead">${esc(ch.lead)}</p>` : ''}
      ${list(ch.blocks).map(b => `<div class="cu-row"><b>${esc(b.t)}</b><span>${esc(b.d)}</span></div>`).join('')}`)};
  const bt = d.belts || {};
  if(list(bt.kup && bt.kup.belts).length || list(bt.dan).length) S.belts = {label:'띠 제도', icon:'award', html: sec('belts', bt.title || '띠 제도', beltsPage(bt))};
  const gu = d.guinness || {}, gp = d.guinnessPage || {};
  if(gu.items || gp.lead) S.guinness = {label:'해랑 기네스', icon:'award', html: sec('guinness', gp.title || '해랑 기네스', `
      ${gp.lead ? `<p class="lead">${esc(gp.lead)}</p>` : ''}
      ${list(gp.facts).length ? `<div class="cu-sec">${list(gp.facts).map(f => `<div class="cu-row"><b>${esc(f.t)}</b><span>${esc(f.d)}</span></div>`).join('')}</div>` : ''}
      ${gu.items ? `<div class="cu-sec"><h4>분기별 종목</h4>${[['1~3월','1'],['4~6월','2'],['7~9월','3'],['10~12월','4']].filter(([, k]) => gu.items[k]).map(([m, k]) => `<div class="cu-row"><b>${m}</b><span>${esc(gu.items[k])}</span></div>`).join('')}</div>` : ''}
      ${gp.closing ? `<p class="gu-foot">${esc(gp.closing)}</p>` : ''}`)};
  const gr = d.growth || {};
  if(gr.title || list(gr.factors).length) S.growth = {label:'분기별 성장 측정', short:'성장 측정', icon:'chart', html: sec('growth', gr.title || '분기별 성장 측정지', `
      ${gr.lead ? `<p class="lead">${esc(gr.lead)}</p>` : ''}
      ${list(gr.factors).length ? `<div class="cu-sec"><h4>${esc(gr.factorsTitle || '함께 살펴보는 성장 요소')}</h4>
        <div class="gf">${list(gr.factors).map((x, i) => typeof x === 'string' ? `<div class="gf-i"><b>${esc(x)}</b></div>` : `<div class="gf-i"><div class="gf-t"><span class="n">${pad2(i + 1)}</span><b>${esc(x.t)}</b>${x.how ? `<em class="how">${esc(x.how)}</em>` : ''}</div>${x.d ? `<p>${esc(x.d)}</p>` : ''}</div>`).join('')}</div>
        ${list(gr.scale).length ? `<p class="gscale"><span>사범님 관찰</span>${list(gr.scale).map((t, i) => `<i class="lv${i + 1}">${esc(t)}</i>`).join('<b>›</b>')}</p>` : ''}</div>` : ''}
      ${list(gr.contents).length ? `<div class="cu-sec"><h4>${esc(gr.contentsTitle || '측정지에 담기는 내용')}</h4><ul class="bt-list">${list(gr.contents).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${gr.closing ? `<p class="cu-close">${esc(gr.closing)}</p>` : ''}`)};

  const pr = d.program || {};
  if(list(pr.divisions).length || list(pr.timetable).length) S.program = {label:'수업 · 시간표', short:'수업·시간표', icon:'clock', html: sec('program', '', `
      ${fittBlock(pr)}
      ${list(pr.timetable).length ? `<div class="card tt"><h4>전체 시간표 · 월 ~ 금</h4><table>${list(pr.timetable).map(r => `<tr><td>${esc(r.time)}</td><td>${esc(r.who)}</td></tr>`).join('')}</table></div>` : ''}
      ${list(pr.divisions).length ? `<h3 class="st" style="margin:30px 2px 12px">부서별 요일 수업</h3><div class="divwrap"><div class="vtabs" role="tablist">${list(pr.divisions).map((v,i) => `<button type="button" role="tab" data-div="${i}" class="${i ? '' : 'on'}">${esc(v.name)}</button>`).join('')}</div>
      <div id="divBox"></div></div>` : ''}`)};

  const fe = d.fee || {};
  if(list(fe.plans).length || fe.shuttle) S.fee = {label:'회비 · 차량 안내', short:'회비·차량', icon:'won', html: sec('fee', fe.title || '회비 · 차량 안내', `
      ${list(fe.plans).length ? `<div class="card fee"><h4>월 회비</h4>${list(fe.plans).map(p => `
        <div class="plan"><div><b>${esc(p.name)}</b>${p.who ? `<span>${esc(p.who)}</span>` : ''}</div><strong>${esc(p.price)}</strong></div>`).join('')}
        ${list(fe.notes).length ? `<ul class="fnotes">${list(fe.notes).map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      ${list(fe.referral).length ? `<div class="card park gift">${svg('gift')}<div><b>${esc(fe.referralTitle || '지인 소개 혜택')}</b><div class="rf">${list(fe.referral).map(t => { const [a, ...b] = String(t).split('|'); return `<div class="rr"><span>${esc(a.trim())}</span><em>${esc(b.join('|').trim())}</em></div>`; }).join('')}</div><button class="sharebtn" type="button" data-share>${svg('share',2.2)}지인에게 해랑경희 공유하기</button></div></div>` : ''}
      ${fe.shuttle ? `<div class="shuttle"><b>${esc(fe.shuttle)}</b>${fe.shuttleNote ? `<p>${esc(fe.shuttleNote)}</p>` : ''}</div>` : ''}
      ${tel0 ? `<a class="btn-call" href="tel:${esc(tel0)}">${svg('phone')}회비·차량 전화로 문의하기</a>` : ''}`)};

  if(list(d.faq).length){
    const fq = list(d.faq);
    const cats = [...new Set(fq.map(f => f.cat || '기타'))];
    S.faq = {label:'자주 묻는 질문', short:'FAQ', icon:'help', html: sec('faq', '자주 묻는 질문', `
      <div class="faqtool">
        <label class="fsearch">${svg('search',2.4)}<input id="faqQ" type="search" placeholder="궁금한 내용 검색 (예: 회비, 주차)" autocomplete="off"></label>
        ${cats.length > 1 ? `<div class="fcats" id="faqCats"><button type="button" class="on" data-c="">전체</button>${cats.map(c => `<button type="button" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="faq" id="faqList">${fq.map((f,i) => `
        <details data-c="${esc(f.cat || '기타')}" data-t="${esc([f.q, ...list(f.a), ...list(f.points).map(p => p.t + ' ' + (p.d || '')), f.closing || '', ...list(f.after), f.cat || ''].join(' ').toLowerCase())}"${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><div class="ans">
          ${list(f.a).map(t => `<p class="fa">${esc(t)}</p>`).join('')}
          ${list(f.points).map(p => `<div class="pt"><span class="ck">${svg('check',3)}</span><div><b>${esc(p.t)}</b>${p.d ? `<span>${esc(p.d)}</span>` : ''}</div></div>`).join('')}
          ${f.closing ? `<p class="closing">${esc(f.closing)}</p>` : ''}
          ${list(f.after).map(x => `<p class="fa fa-after">${esc(x)}</p>`).join('')}
        </div></details>`).join('')}</div>
      <p class="fempty" id="faqEmpty" hidden>찾는 질문이 없어요. 아래 상담 문의로 편하게 물어봐 주세요.</p>`)};
  }

  S.today = {label:'오늘의 운동', icon:'run', html: sec('today', '', `${workoutCard(d, false)}${focusTable(d)}`)};
  S.schedule = {label:'도장 일정', short:'일정', icon:'calendar', html: sec('schedule', '해랑경희 일정', `
      <div class="card cal" id="cal"></div>
      <div class="legend">${Object.entries(EV_COLORS).filter(([k]) => EVENTS.some(e => (EV_COLORS[e.type] ? e.type : '기타') === k)).map(([k,c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')}</div>
      <div class="evlist" id="evlist"></div>`)};
  S.notice = {label:'알림판·공지', short:'알림판', icon:'megaphone', html: sec('notice', '', noticePage(d))};
  S.press = {label:'보도자료', icon:'news', html: sec('press', '보도자료', pressPage(d))};
  if(list(d.gallery).length) S.gallery = {label:'사진', icon:'photo', html: sec('gallery', d.galleryTitle || '사진으로 보는 해랑경희', gallery(d))};

  const ct = d.contact || {};
  const tel = (ct.phone || '').replace(/[^0-9+]/g, '');
  S.contact = {label:'상담 문의', icon:'phone', html: sec('contact', ct.title || '상담 및 문의하기', `
      ${tel ? `<a class="callbig" href="tel:${esc(tel)}">${svg('phone')}<span>${esc(ct.phone)}<small>눌러서 바로 전화 상담</small></span></a>` : ''}
      <nav class="links">${list(d.links).map(l => `
        <a class="link${l.main ? ' main' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">
          <span class="ic${LOGOS[l.icon] ? ' has-logo' : ''}">${ico(l.icon)}</span>
          <span class="text"><span class="name">${esc(l.name)}</span>${l.desc ? `<span class="desc">${esc(l.desc)}</span>` : ''}</span>
          ${arrow}
        </a>`).join('')}</nav>`)};

  const lo = d.location || {};
  if(lo.address){
    const q = encodeURIComponent((lo.address || '').replace(/\s*\d+층.*$/, '') + ' ' + (lo.name || ''));
    const hrs = lo.hours || {};
    const order = ['월','화','수','목','금','토','일'];
    const todayW = WEEK[TODAY.getDay()];
    // 지금 운영 중인지 (한국 시간 기준)
    const nowK = (() => { const n = new Date(); return new Date(n.getTime() + (n.getTimezoneOffset() + 540) * 60000); })();
    const tm = /(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/.exec(hrs[todayW] || '');
    const mins = nowK.getHours() * 60 + nowK.getMinutes();
    const offToday = eventsOn(TODAY).some(e => e.type === '휴관');
    const openNow = !offToday && tm && mins >= (+tm[1]) * 60 + (+tm[2]) && mins < (+tm[3]) * 60 + (+tm[4]);
    S.location = {label: lo.title || '오시는 길', short:'오시는 길', icon:'map', html: sec('location', lo.title || '오시는 길', `
      <div class="card mapbox">
        ${lo.mapImage ? `${lo.naver ? `<a href="${esc(lo.naver)}" target="_blank" rel="noopener">` : ''}<img class="mapimg" src="${esc(lo.mapImage)}" alt="${esc(lo.name || brand)} 오시는 길 약도: ${esc(lo.landmark || lo.address || '')}" loading="lazy">${lo.naver ? '</a>' : ''}` : `<iframe title="${esc(lo.name || brand)} 지도" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${q}&hl=ko&z=17&output=embed"></iframe>`}
        <div class="info"><b>${esc(lo.name || brand)}</b><p>${esc(lo.address)}</p>${lo.landmark ? `<p class="lm">${svg('map')}${esc(lo.landmark)}</p>` : ''}${lo.parking ? `<p class="pk">${svg('car')}${esc(lo.parking).replace(/\s*\n\s*/g, ' ')}</p>` : ''}${lo.note ? `<p class="note">${esc(lo.note)}</p>` : ''}
          <div class="mapbtns">
            ${lo.naver ? `<a class="nv" href="${esc(lo.naver)}" target="_blank" rel="noopener">${svg('map')}네이버지도</a>` : ''}
            ${lo.kakao ? `<a class="kk" href="${esc(lo.kakao)}" target="_blank" rel="noopener">${svg('map')}카카오맵</a>` : ''}
            <button type="button" id="copyAddr">${svg('copy')}주소 복사</button>
            ${tel ? `<a href="tel:${esc(tel)}">${svg('phone')}전화하기</a>` : ''}
          </div>
        </div>
      </div>
      ${Object.keys(hrs).length ? `<div class="card tt hours" style="margin-top:14px"><h4>운영 시간 ${tm || offToday ? `<span class="open ${openNow ? 'on' : ''}">${openNow ? '지금 운영 중' : (offToday ? '오늘 휴관' : '운영 시간 아님')}</span>` : `<span class="open">오늘 휴무</span>`}</h4><table>
        ${order.filter(w => hrs[w]).map(w => `<tr class="${w === todayW ? 'today' : ''}${/휴/.test(hrs[w]) ? ' off' : ''}"><td>${w}</td><td>${esc(hrs[w])}</td></tr>`).join('')}</table></div>` : ''}
`)};
  }

  // 큰 메뉴 → 작은 메뉴(탭)
  GROUPS = [
    {name:'도장 소개', items:['philosophy','curriculum','staff','location']},
    {name:'해랑경희 문화', items:['character','leaders','belts','guinness','growth']},
    {name:'수련 안내', items:['program','today','fee','faq']},
    {name:'도장 소식', items:['schedule','notice','gallery','press']},
    {name:'상담 문의', items:['contact']}
  ].map(g => ({...g, items: g.items.filter(id => S[id])})).filter(g => g.items.length);

  const tileIds = ['philosophy','staff','faq','fee','program','location'].filter(id => S[id]);
  const lionW = '<img class="wm" src="img/lion-white.png" alt="" aria-hidden="true">';

  document.getElementById('app').innerHTML = `
    <header class="top"><div class="in">
      <a class="logo" href="${HOME}" aria-label="처음 화면으로"><img class="logo-full" src="img/logo-header.png" alt="${brand}"><img class="lion-h" src="img/lion-white.png" alt="${brand}"></a>
      ${tel ? `<a class="tel" href="tel:${esc(tel)}" aria-label="전화 상담">${svg('phone')}</a>` : ''}
      <button class="allmenu" id="menuBtn" type="button" aria-expanded="false">${svg('menu',2.4)}전체메뉴</button>
    </div></header>

    <div class="drawer" id="drawer" aria-hidden="true">
      <div class="dim" data-close></div>
      <div class="panel" role="dialog" aria-label="전체메뉴">
        <div class="phead"><b>${svg('menu',2.4)}전체메뉴</b><button class="x" type="button" data-close aria-label="닫기">${svg('close')}</button></div>
        <div class="pbody">
          <div class="g"><h3>홈</h3><div><a href="${HOME}" data-close>처음 화면</a></div></div>
          ${GROUPS.map(g => `<div class="g"><h3>${esc(g.name)}</h3><div>${g.items.map(id => `<a href="${go(id)}" data-close>${esc(S[id].label)}</a>`).join('')}</div></div>`).join('')}
        </div>
        ${tel ? `<div class="pfoot"><a class="callbig" href="tel:${esc(tel)}">${svg('phone')}<span>${esc(ct.phone)}<small>전화 상담</small></span></a></div>` : ''}
      </div>
    </div>

    <div id="homePage">
      ${d.heroVideo && d.heroVideo.src ? heroVideo(d, brand) : `<div class="hero">${lionW}
        <h1 class="ht"><img class="ht-title" src="img/title-white.png" alt="${brand}"><img class="ht-slogan" src="img/slogan-white.png" alt="${esc(d.slogan || '')}"></h1>
        ${(() => { const hp = list(d.heroPhotos).filter(x => x && x.image); if(!hp.length) return ''; return `<div class="hphoto" id="hphoto">${hp.map((x,i) => `<img class="${i ? '' : 'on'}" src="${esc(x.image)}" alt="${esc(x.alt || '')}"${i ? ' loading="lazy"' : ''}>`).join('')}${hp.length > 1 ? `<div class="dots">${hp.map((_,i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>`; })()}
      </div>`}
      <main class="wrap">
        <section class="intro">${d.heroVideo && d.heroVideo.src ? '' : awardPill(d)}${intro}</section>
        <div class="shortcuts${tileIds.length % 3 === 0 ? ' three' : ''}">
          ${tileIds.map(id => `<a class="sc" href="${go(id)}"><span class="ic">${svg(S[id].icon)}</span>${esc(S[id].short || S[id].label)}</a>`).join('')}
        </div>
        ${classesBlock(d)}
        ${trustBlock(d)}
        <div class="seg seg2"><h2>해랑경희 소식</h2><p>다니는 친구들을 위한 일정과 공지</p></div>
        ${(() => { const w = workoutCard(d, true); return w.includes(' rest"') ? '' : `<div class="home">${w}</div>`; })()}
        <div class="home">
          ${newsCard(d)}
        </div>
        <div class="twin">
          ${photoPanel(d)}
          ${eventPanel()}
          ${activePosters(d).length ? boardPanel(d, true) : ''}
        </div>
        <a class="endcta" href="${go('contact')}">${svg('phone')}상담 문의하기</a>
      </main>
    </div>

    <div id="subPage" hidden>
      <div class="pagehero"><div class="in">${lionW}
        <div class="crumb"><a href="${HOME}">홈</a> › <span id="crumbG"></span></div>
        <h2 id="pageTitle"></h2>
      </div></div>
      <div class="subtabs"><div class="in" id="subtabs"></div></div>
      <main class="wrap">${Object.values(S).map(x => x.html || '').join('')}</main>
    </div>

    <footer class="foot"><div class="in">
      <img src="img/lion.png" alt="">
      <div><b>${brand}</b><br>
      ${ct.ceo ? `대표자 : ${esc(ct.ceo)}<br>` : ''}
      ${lo.address ? `주소 : ${esc(lo.address)}<br>` : ''}
      ${ct.phone ? `<a href="tel:${esc(tel)}">${esc(ct.phone)}</a><br>` : ''}
      © ${esc(d.since || '2023')} ${brand}</div>
    </div></footer>
    ${(() => {
      const fl = list(d.links).filter(l => l.float && l.url);
      const ph = tel && ct.floatPhone !== false;
      if(!fl.length && !ph) return '';
      const row = (cls, href, name, desc, icon, ext) => `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}><span class="qi ${cls}">${icon}</span><span><b>${esc(name)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</span></a>`;
      return `<div class="qp" id="qp"><button class="qtab" id="qtab" type="button" aria-expanded="false" aria-controls="qbox"><span class="v" aria-label="빠른상담"><i>빠</i><i>른</i><i>상</i><i>담</i></span><span class="ar">${svg('left',2.8)}</span></button>
        <nav class="qbox" id="qbox" aria-label="빠른 상담"><h4>빠른 상담</h4>${fl.map(l => { const lg = LOGOS[l.icon] && l.icon !== 'insta'; return row(`f-${esc(l.icon)}${lg ? ' f-logo' : ''}`, l.url, l.name, l.desc, lg ? `<img src="${LOGOS[l.icon]}" alt="">` : svg(l.icon, 2.2), true); }).join('')}${ph ? row('f-phone', 'tel:' + tel, '전화 상담', ct.phone, svg('phone', 2.2), false) : ''}<a href="#" data-share><span class="qi f-share">${svg('share', 2.2)}</span><span><b>공유하기</b><small>카톡·문자로 사이트 보내기</small></span></a></nav></div>`;
    })()}
    <button class="totop" id="totop" type="button" aria-label="맨 위로">${svg('up',2.6)}</button>`;

  document.getElementById('app').classList.add('ready');
  setupMenu(); setupQuick(); setupVideos(); setupHero(); setupTabs(); setupCalendar(); setupGallery(); setupStack(); setupSliders(); setupTop(); setupFaq();
  const cb = document.getElementById('copyAddr');
  if(cb) cb.onclick = async () => {
    const txt = lo.address;
    try{ await navigator.clipboard.writeText(txt); }
    catch(e){ const t = document.createElement('textarea'); t.value = txt; document.body.append(t); t.select(); try{ document.execCommand('copy'); }catch(_){} t.remove(); }
    cb.lastChild.textContent = '복사됐어요'; setTimeout(() => { cb.lastChild.textContent = '주소 복사'; }, 1800);
  };
  window.addEventListener('hashchange', route); route();
}

// ---------- 영상 첫 화면 · 부서별 수업 ----------
function heroVideo(d, brand){
  const v = d.heroVideo;
  // 넓은 가로 화면(컴퓨터·태블릿 가로)에서는 가로 영상
  const wide = v.wide && matchMedia('(min-width:768px) and (orientation:landscape)').matches;
  const src = wide ? v.wide : v.src, poster = wide ? (v.widePoster || '') : (v.poster || '');
  const book = list(d.links).find(l => l.icon === 'calendar');
  return `<section class="vhero">${awardPill(d)}
    <video src="${esc(src)}" poster="${esc(poster)}" autoplay muted loop playsinline preload="auto" aria-hidden="true"></video>
    <div class="in">
      <div class="kick">HAERANG TAEKWONDO</div>
      <h1><img src="img/title-white.png" alt="${brand}"></h1>
      <p class="vs"><img src="img/slogan-white.png" alt="${esc(d.slogan || '')}"></p>
      <div class="btns">${book ? `<a class="b1" href="${esc(book.url)}" target="_blank" rel="noopener">상담 예약</a>` : `<a class="b1" href="${go('contact')}">상담 문의</a>`}<a class="b2" href="${go('program')}">수련 안내</a></div>
    </div>
  </section>`;
}
function classesBlock(d){
  const cs = list(d.classes).filter(c => c.name);
  if(!cs.length) return '';
  return `<div class="classes">${cs.map((c, i) => `
      <a class="cls rv" href="${esc(c.link || '#/program')}">
        <div class="media">${c.video ? `<video data-src="${esc(c.video)}" poster="${esc(c.poster || '')}" muted loop playsinline preload="none" aria-hidden="true"></video>` : (c.poster ? `<img src="${esc(c.poster)}" alt="" loading="lazy">` : '')}<span class="no">${pad2(i + 1)}</span></div>
        <div class="body"><div class="row"><h3>${esc(c.name)}</h3>${c.time ? `<span class="tm">${esc(c.time)}</span>` : ''}</div>
          <ul>${list(c.points).map(p => `<li>${esc(p)}</li>`).join('')}</ul><span class="go">자세히 보기 ›</span></div>
      </a>`).join('')}</div>`;
}
// 화면에 보일 때만 영상 재생 (데이터 절약), 스크롤하면 나타남
function setupVideos(){
  const vids = [...document.querySelectorAll('video[data-src]')];
  const rvs = [...document.querySelectorAll('.rv')];
  if(!('IntersectionObserver' in window)){ vids.forEach(v => { v.src = v.dataset.src; v.play().catch(()=>{}); }); rvs.forEach(x => x.classList.add('in')); return; }
  const vo = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if(e.isIntersecting){ if(!v.src) v.src = v.dataset.src; v.play().catch(()=>{}); } else v.pause();
  }), {threshold:.25});
  vids.forEach(v => vo.observe(v));
  const ro = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('in'); ro.unobserve(e.target); } }), {threshold:.12});
  rvs.forEach(x => ro.observe(x));
}

// ---------- 첫 화면 사진 ----------
function setupHero(){
  const box = document.getElementById('hphoto'); if(!box) return;
  const imgs = box.querySelectorAll('img'), dots = box.querySelectorAll('.dots i');
  if(imgs.length < 2) return;
  let i = 0;
  const show = n => { i = (n + imgs.length) % imgs.length; imgs.forEach((im, k) => im.classList.toggle('on', k === i)); dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
  let tm = setInterval(() => show(i + 1), 4000);
  let x0 = null;
  box.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, {passive:true});
  box.addEventListener('touchend', e => { if(x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if(Math.abs(dx) > 40){ show(i + (dx < 0 ? 1 : -1)); clearInterval(tm); tm = setInterval(() => show(i + 1), 4000); } });
}

// ---------- 빠른 상담 ----------
function setupQuick(){
  const qp = document.getElementById('qp'), tab = document.getElementById('qtab');
  if(!qp) return;
  const set = on => { qp.classList.toggle('open', on); tab.setAttribute('aria-expanded', on); };
  tab.onclick = e => { e.stopPropagation(); set(!qp.classList.contains('open')); };
  // 첫 화면 영상(상담 예약 버튼이 있는 곳)이 보이는 동안은 빠른상담 탭을 숨김
  const hero = document.querySelector('.vhero, .hero');
  const chk = () => document.body.classList.toggle('past-hero', !hero || hero.getBoundingClientRect().bottom < 80);
  window.addEventListener('scroll', chk, {passive:true}); chk();
  document.addEventListener('click', e => { if(!qp.contains(e.target)) set(false); });
  qp.querySelectorAll('.qbox a').forEach(a => a.addEventListener('click', () => set(false)));
}

// ---------- 자주 묻는 질문 검색·분류 ----------
function setupFaq(){
  const q = document.getElementById('faqQ'); if(!q) return;
  const cats = document.getElementById('faqCats');
  const items = [...document.querySelectorAll('#faqList details')];
  let cat = '';
  const run = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    items.forEach(el => {
      const ok = (!cat || el.dataset.c === cat) && words.every(w => el.dataset.t.includes(w));
      el.hidden = !ok; if(ok) n++;
      if(words.length) el.open = ok;
    });
    document.getElementById('faqEmpty').hidden = n > 0;
  };
  q.addEventListener('input', run);
  if(cats) cats.addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    cat = b.dataset.c;
    cats.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    run();
  });
}

// ---------- 화면 전환 ----------
function route(){
  let id = location.hash.replace(/^#\/?/, '');
  if(!id && START) id = START;
  if(id === 'timetable'){ id = 'program'; history.replaceState(null, '', '#/program'); }
  const g = GROUPS.find(x => x.items.includes(id));
  const home = !g;
  document.getElementById('homePage').hidden = !home;
  document.getElementById('subPage').hidden = home;
  document.body.classList.toggle('is-home', home);
  document.querySelectorAll('.gnb a').forEach(a => a.classList.toggle('on', home ? a.dataset.g === 'home' : a.dataset.g === g.name));
  const on = document.querySelector('.gnb a.on'); if(on) on.scrollIntoView({block:'nearest', inline:'center'});
  if(!home){
    document.getElementById('crumbG').textContent = g.name + (g.items.length > 1 ? ' › ' + S[id].label : '');
    document.getElementById('pageTitle').textContent = g.items.length > 1 ? S[id].label : g.name;
    const tabs = document.getElementById('subtabs');
    tabs.parentElement.hidden = g.items.length < 2;
    tabs.innerHTML = g.items.map(x => `<a href="${go(x)}" class="${x === id ? 'on' : ''}">${esc(S[x].short || S[x].label)}</a>`).join('');
    document.querySelectorAll('#subPage .sec').forEach(s => s.hidden = s.dataset.id !== id);
    const t = tabs.querySelector('.on'); if(t) t.scrollIntoView({block:'nearest', inline:'center'});
  }
  window.scrollTo(0, 0);
}

// ---------- 오늘의 운동 ----------
function monthPlan(d){
  const ms = list((d.monthly || {}).months).filter(m => m.month).sort((a, b) => a.month.localeCompare(b.month));
  const cur = ymd(TODAY).slice(0, 7);
  return { exact: ms.find(m => m.month === cur), plan: ms.find(m => m.month === cur) || ms.filter(m => m.month < cur).pop() || ms[ms.length - 1] };
}
// 요일별 운동테마는 매달 같음 (예전 형식처럼 달마다 들어 있으면 그것도 읽음)
function weekdayThemes(d){
  const w = (d.monthly || {}).weekday;
  if(w && Object.values(w).some(v => list(v).length)) return w;
  const { plan } = monthPlan(d);
  return (plan && plan.weekday) || {};
}
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
function focusList(d){
  return list((d.monthly || {}).focus).filter(f => isDate(f.date) && f.title).map(f => {
    const s = parseD(f.date); let en = isDate(f.end) ? parseD(f.end) : s; if(en < s) en = s;
    return {...f, s, en};
  }).sort((a, b) => a.s - b.s);
}
function workoutCard(d, onHome){
  const mo = d.monthly || {};
  const dow = TODAY.getDay(), weekend = dow === 0 || dow === 6;
  const evs = eventsOn(TODAY);
  const off = evs.filter(e => e.type === '휴관');
  let fs = focusList(d).filter(f => f.s <= TODAY && TODAY <= f.en);
  // 같은 이름의 일정(예: 해랑경희 기네스 · 스피드 발차기)이 있으면 그 이름으로 한 번만 보여줌
  const dup = e => fs.some(f => (e.title || '').includes(f.title) || f.title.includes(e.title || '-'));
  fs = fs.map(f => { const e = evs.find(x => x.type !== '휴관' && ((x.title || '').includes(f.title) || f.title.includes(x.title || '-'))); return e ? {...f, title: e.title.length > f.title.length ? e.title : f.title} : f; });
  const items = list(weekdayThemes(d)[WEEK[dow]]);
  const evRows = evs.filter(e => e.type !== '휴관' && !dup(e)).map(e => {
    const c = EV_COLORS[e.type] || EV_COLORS['기타'];
    return `<div class="focus"><span class="tag" style="background:${c}">${esc(e.type || '일정')}</span><b>${esc(e.title)}</b>${e.note ? `<span>${esc(e.note)}</span>` : ''}</div>`;
  }).join('');
  let body, rest = false;
  if(off.length) body = `<div class="theme">오늘은 쉬는 날이에요</div><p class="sub">${off.map(e => esc(e.title)).join(', ')}</p>`;
  else if(weekend && !fs.length && !evRows && !items.length){ rest = true; body = `<div class="theme">${esc(mo.weekendText || '즐거운 주말 보내세요.\n월요일에 만나요!')}</div>`; }
  else body = `
      ${fs.length ? `<div class="flabel">${fs.some(f => +f.s !== +f.en) ? '이번 주 수련' : '오늘의 수련'}</div><div class="theme">${fs.map(f => esc(f.title)).join(' · ')}</div><p class="sub">${fs.map(rangeText).join(', ')}</p>` : ''}
      ${evRows ? `<div class="focusbox">${evRows}</div>` : ''}
      ${items.length ? `<div class="flabel" style="margin-top:6px">${WEEK[dow]}요일 수업</div><ol>${items.map(i => `<li><b>${esc(i)}</b></li>`).join('')}</ol>` : ''}
      ${!fs.length && !evRows && !items.length ? `<div class="theme">오늘은 정해진 운동이 없어요</div>` : ''}`;
  if(off.length) rest = true;
  return `<div class="card hc wo${rest ? ' rest' : ''}">
    <div class="hc-head"><span class="ic">${svg('run')}</span><h2>${esc(mo.title || '오늘의 운동')}<small>${krDate(TODAY)}</small></h2>${onHome ? `<a class="more" href="${go('today')}">이달 수련 계획 ›</a>` : ''}</div>
    ${body}<div class="pad"></div>
  </div>`;
}
// 몇째 주 (그 주 월요일 기준)
function weekLabel(dt){
  const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - ((dt.getDay() + 6) % 7));
  const base = mon.getMonth() === dt.getMonth() ? mon : dt;
  const n = Math.ceil(base.getDate() / 7);
  return `${dt.getMonth() + 1}월 ${['첫째','둘째','셋째','넷째','다섯째'][n - 1] || n + '번째'} 주`;
}
function focusTable(d){
  const y = TODAY.getFullYear(), m = TODAY.getMonth();
  const ms = new Date(y, m, 1), me = new Date(y, m + 1, 0);
  const rows = focusList(d).filter(f => f.s <= me && f.en >= ms);
  if(!rows.length) return '';
  return `<div class="card tt fo" style="margin-top:14px"><h4>${m + 1}월 수련 계획</h4><table>
    ${rows.map(f => `<tr class="${f.s <= TODAY && TODAY <= f.en ? 'now' : (f.en < TODAY ? 'past' : '')}"><td>${+f.s === +f.en ? rangeText(f) : `${weekLabel(f.s)}<small class="wd">${rangeText(f)}</small>`}</td><td>${esc(f.title)}</td></tr>`).join('')}</table></div>`;
}
function weekTable(d){
  const wd = weekdayThemes(d);
  const rows = ['월','화','수','목','금','토'].map(w => [w, list(wd[w])]).filter(([, v]) => v.length);
  if(!rows.length) return '';
  const today = WEEK[TODAY.getDay()];
  return `<div class="card tt wk" style="margin-top:14px"><h4>요일별 운동테마</h4><table>
    ${rows.map(([w, v]) => `<tr class="${w === today ? 'today' : ''}"><td>${w}</td><td>${v.map(esc).join(' · ')}</td></tr>`).join('')}</table></div>`;
}
function monthNotices(d){
  const { exact } = monthPlan(d);
  return exact ? { m: +exact.month.slice(5), list: list(exact.notices) } : { m: TODAY.getMonth() + 1, list: [] };
}
function activePosters(d){
  return list(d.board).filter(p => p.image || p.title).filter(p => (!isDate(p.start) || parseD(p.start) <= TODAY) && (!isDate(p.end) || TODAY <= parseD(p.end)));
}
const pad2 = n => String(n).padStart(2, '0');
// 작은 칸: 사진 아래에  ‹  01 · 06  ‖  ›
function ctrlRow(n){
  return n > 1 ? `<div class="ctrl"><button type="button" data-prev aria-label="이전">${svg('left',2.4)}</button><span class="cnt"><b data-cur>01</b> · ${pad2(n)}</span><button type="button" data-pp aria-label="멈춤">${svg('pause',2.6)}</button><button type="button" data-next aria-label="다음">${svg('right',2.4)}</button></div>` : '';
}
function sliderHead(title, n, more, mini){
  // 작은 칸 제목은 마지막 단어를 다음 줄로 (예: 사진으로 보는 / 해랑경희)
  const t = mini && /\s/.test(title.trim()) ? esc(title.trim()).replace(/\s+(\S+)$/, '<br>$1') : esc(title);
  return `<div class="ph"><h3>${t}</h3>
    ${n > 1 && !mini ? `<span class="cnt"><b data-cur>01</b> · ${pad2(n)}</span>
      <button type="button" data-prev aria-label="이전">${svg('left',2.4)}</button>
      <button type="button" data-pp aria-label="멈춤">${svg('pause',2.6)}</button>
      <button type="button" data-next aria-label="다음">${svg('right',2.4)}</button>` : ''}
    <a class="plus" href="${more}" aria-label="더 보기">${svg('plus',2.2)}</a></div>`;
}
function photoPanel(d){
  const pics = list(d.gallery);
  if(!pics.length) return '';
  return `<div class="card panel slider mini">${sliderHead(d.galleryTitle || '사진으로 보는 해랑경희', pics.length, '#/gallery', true)}
    <div class="slides">${pics.map((p, i) => `<div class="sl${i ? '' : ' on'}"><img src="${esc(p)}" alt="수업 사진" data-zoom ${i > 1 ? 'loading="lazy"' : ''}></div>`).join('')}</div>${ctrlRow(pics.length)}</div>`;
}
// 행사 사진: 일정에 사진을 붙이면 여기 나옴 (다가오는 행사 먼저, 그다음 지난 행사 최근 순)
function eventPanel(){
  const withImg = EVENTS.filter(e => e.image);
  const up = withImg.filter(e => e.en >= TODAY).sort((a, b) => a.s - b.s);
  // 지난 행사는 끝난 지 1개월까지만
  const cutoff = new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, TODAY.getDate());
  const past = withImg.filter(e => e.en < TODAY && e.en >= cutoff).sort((a, b) => b.s - a.s);
  const evs = up.concat(past);
  const slides = evs.map((e, i) => {
    const n = dayDiff(e.s, TODAY);
    const dd = e.en < TODAY ? '<span class="dd past">지난 행사</span>' : `<span class="dd">${n > 0 ? 'D-' + n : (n === 0 ? '오늘' : '진행 중')}</span>`;
    return `<div class="sl poster${i ? '' : ' on'}" data-cap="${esc(e.title)}" data-sub="${rangeText(e)}"><img src="${esc(e.image)}" alt="${esc(e.title)}" data-zoom ${i > 1 ? 'loading="lazy"' : ''}>${dd}</div>`;
  });
  if(!slides.length) slides.push(`<div class="sl text on"><p class="emptybox">행사 사진이 올라오면 여기에 보여요.</p></div>`);
  return `<div class="card panel slider mini">${sliderHead('행사', evs.length, '#/schedule', true)}<div class="slides">${slides.join('')}</div>${evs.length ? `<p class="capline"></p>` : ''}${ctrlRow(evs.length)}</div>`;
}
function posterSlide(p, i){
  const inner = `${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title || '알림')}" ${p.url ? '' : 'data-zoom'}>` : ''}${p.title ? `<span class="cap">${esc(p.title)}</span>` : ''}`;
  return p.url ? `<a class="sl poster${i ? '' : ' on'}" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="sl poster${i ? '' : ' on'}">${inner}</div>`;
}
function boardPanel(d, postersOnly){
  const ps = activePosters(d), nt = monthNotices(d);
  const slides = ps.map(posterSlide);
  if(nt.list.length && !postersOnly) slides.push(`<div class="sl text${slides.length ? '' : ' on'}"><h4>${nt.m}월 공지사항</h4><ul>${nt.list.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`);
  if(!slides.length) slides.push(`<div class="sl text on"><p class="emptybox">새 소식이 올라오면 여기에 보여요.</p></div>`);
  return `<div class="card panel slider wide">${sliderHead('알림판', slides.length, '#/notice')}<div class="slides">${slides.join('')}</div></div>`;
}
function noticePage(d){
  const ps = activePosters(d), nt = monthNotices(d);
  return `${ps.length ? `<h3 class="st">행사 · 알림</h3><div class="posters">${ps.map(p => {
      const inner = `${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title || '알림')}" ${p.url ? '' : 'data-zoom'} loading="lazy">` : ''}<div>${esc(p.title || '')}${isDate(p.end) ? `<span>~ ${+p.end.slice(5,7)}.${+p.end.slice(8)}까지</span>` : ''}</div>`;
      return p.url ? `<a class="card pst" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="card pst">${inner}</div>`;
    }).join('')}</div>` : ''}
    <h3 class="st" style="${ps.length ? 'margin-top:28px' : ''}">${nt.m}월 공지사항</h3>
    ${nt.list.length ? `<div class="card hc nt"><ul style="padding-top:6px">${nt.list.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : `<div class="card emptybox">이번 달 공지사항이 아직 없어요.</div>`}`;
}
function pressPage(d){
  const ps = list(d.press).filter(p => p.title && p.url).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if(!ps.length) return `<div class="card emptybox">아직 등록된 보도자료가 없어요.</div>`;
  return `<div class="press">${ps.map(p => `
    <a class="card pr" href="${esc(p.url)}" target="_blank" rel="noopener">
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}
      <div class="b"><div class="src">${esc(p.source || '언론 보도')}${isDate(p.date) ? ` <span>· ${p.date.replace(/-/g, '.')}</span>` : ''}</div>
      <h4>${esc(p.title)}</h4>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}<span class="go">기사 보기 ›</span></div>
    </a>`).join('')}</div>`;
}

// ---------- 해랑 기네스: 매달 첫째 주 금요일 자동 ----------
// 분기별 종목: 1~3월(1) · 4~6월(2) · 7~9월(3) · 10~12월(4)
function guinnessEvents(d, manual){
  const g = d.guinness || {};
  if(!g.on) return [];
  const [sy, sm] = /^\d{4}-\d{2}$/.test(g.start || '') ? g.start.split('-').map(Number) : [TODAY.getFullYear(), TODAY.getMonth() + 1];
  const out = [];
  for(let k = -12; k <= 12; k++){
    const first = new Date(TODAY.getFullYear(), TODAY.getMonth() + k, 1);
    const y = first.getFullYear(), m = first.getMonth() + 1;
    if(y * 12 + m < sy * 12 + sm) continue;
    const fri = new Date(y, m - 1, 1 + ((5 - first.getDay() + 7) % 7));
    if(manual.some(e => e.s <= fri && fri <= e.en && (e.type === '기네스' || (e.title || '').includes('기네스')))) continue;   // 직접 넣은 기네스 일정이 있으면 그걸 사용
    if(manual.some(e => e.type === '휴관' && e.s <= fri && fri <= e.en)) continue;                     // 휴관일이면 건너뜀
    const item = (g.items || {})[String(Math.floor((m - 1) / 3) + 1)];
    out.push({ title: item || g.title || '해랑경희 기네스', type: '기네스', note: g.note || '', image: '', s: fri, en: fri, auto: true });
  }
  return out;
}

// ---------- 일정 ----------
function upcomingCard(){
  const next = EVENTS.filter(e => e.en >= TODAY).slice(0, 3);
  return `<div class="card hc up">
    <div class="hc-head"><span class="ic">${svg('calendar')}</span><h2>다가오는 일정<small>해랑경희 소식</small></h2><a class="more" href="${go('schedule')}">전체 보기 ›</a></div>
    ${next.length ? `<ul>${next.map(e => {
      const n = dayDiff(e.s, TODAY);
      const label = n > 0 ? 'D-' + n : (n === 0 ? '오늘' : '진행 중');
      return `<li><span class="dday${n <= 0 ? ' now' : ''}">${label}</span><div class="t"><b><span class="tag" style="background:${EV_COLORS[e.type] || EV_COLORS['기타']}">${esc(e.type || '기타')}</span>${esc(e.title)}</b><span>${rangeText(e)}${e.note ? ' · ' + esc(e.note) : ''}</span></div></li>`;
    }).join('')}</ul>` : `<p class="empty">예정된 일정이 없어요.</p>`}
  </div>`;
}
// 신뢰 영역: 기사 · 블로그 · 인스타 (관장님이 꼭 보여주고 싶은 3가지)
function latestPress(d){
  return list(d.press).filter(p => p.title && p.url).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
}
function awardPill(d){
  const p = latestPress(d); if(!p) return '';
  const t = p.title.replace(/^[^,]*,\s*/, '');
  return `<a class="award" href="${esc(p.url)}" target="_blank" rel="noopener">${svg('star',2.2)}<span>${esc(t)}<small>${esc(p.source || '언론 보도')} 보도 ›</small></span></a>`;
}
function trustBlock(d){
  const p = latestPress(d);
  const ln = list(d.links);
  const blog = ln.find(l => l.icon === 'blog'), insta = ln.find(l => l.icon === 'insta');
  if(!p && !blog && !insta) return '';
  const sns = (l, sub) => l ? `<a class="tr-sns" href="${esc(l.url)}" target="_blank" rel="noopener"><img src="${LOGOS[l.icon]}" alt=""><span><b>${esc(l.name)}</b><small>${esc(sub || l.desc || '')}</small></span><i>${svg('right',2.4)}</i></a>` : '';
  return `<div class="seg seg2"><h2>더 알아보기</h2></div>
    <div class="trust">
      ${p ? `<a class="tr-press" href="${esc(p.url)}" target="_blank" rel="noopener">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}
        <div class="b"><span class="src">${esc(p.source || '언론 보도')}${isDate(p.date) ? ' · ' + p.date.slice(0,7).replace('-', '.') : ''}</span><h4>${esc(p.title)}</h4><span class="go">기사 읽기 ›</span></div></a>` : ''}
      <div class="tr-row">${sns(blog, '도장 소개 요약')}${sns(insta, '수업 일상과 제자들 모습')}</div>
    </div>`;
}
// 수업 · 시간표 맨 위: 해랑경희 FITT
function fittBlock(pr){
  const f = list(pr.fitt);
  if(!f.length) return '';
  return `<div class="fitt"><h4>${esc(pr.fittTitle || '해랑경희 태권도장의 FITT')}</h4>${pr.fittLead ? `<p class="bt-desc">${esc(pr.fittLead)}</p>` : ''}
    <div class="fitt-g">${f.map(x => `<div><span class="ic">${svg(x.icon || 'clock')}</span><b>${esc(x.k)}</b><small>${esc(x.e || '')}</small><p>${esc(x.v)}</p></div>`).join('')}</div></div>`;
}
// 띠 제도 페이지
function beltChip(b){
  const bg = b.s ? `linear-gradient(180deg,${b.c} 0 36%,${b.s} 36% 64%,${b.c} 64%)` : (b.c2 ? `linear-gradient(180deg,${b.c} 0 50%,${b.c2} 50%)` : b.c);
  return `<li class="${b.kid ? 'kid' : ''}"><i style="background:${bg}"></i><span>${esc(b.n)}</span></li>`;
}
function beltsPage(bt){
  const k = bt.kup || {}, c = bt.cert || {};
  const tbl = (head, rows) => `<table class="bt-tbl"><tr><th>${esc(head[0])}</th>${rows.map(r => `<th>${esc(r[0])}</th>`).join('')}</tr><tr><td>${esc(head[1])}</td>${rows.map(r => `<td>${esc(r[1])}</td>`).join('')}</tr></table>`;
  const certHtml = c.title ? `<h3 class="st" style="margin:34px 2px 12px">${esc(c.title)}</h3>
      ${c.what ? `<div class="bt-stage"><div class="bt-h"><b>단증 · 품증이란?</b></div><p class="bt-desc">${esc(c.what)}</p>${list(c.naming).length ? `<ul class="bt-list">${list(c.naming).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      ${list(c.minPeriod).length ? `<div class="bt-stage"><div class="bt-h"><b>품/단 취득 최소 수련 기간</b></div>${tbl(['응시 품/단', '승단 수련 기간'], c.minPeriod)}${list(c.examples).length ? `<ul class="bt-list">${list(c.examples).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      ${list(c.danAge).length ? `<div class="bt-stage"><div class="bt-h"><b>단증부터 취득할 경우</b></div>${tbl(['응시 단', '응시 자격 연령'], c.danAge)}</div>` : ''}
      ${list(c.convert).length ? `<div class="bt-stage"><div class="bt-h"><b>품증에서 단증으로 변경</b></div><ul class="bt-list">${list(c.convert).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${list(c.benefitGroups).length ? `<div class="bn-wrap"><div class="bn-head"><span class="bn-num">${list(c.benefitGroups).reduce((n, g) => n + list(g.items).length, 0)}</span><div><b>단증이 열어주는 길</b><small>단증 하나로 넓어지는 진학과 진로</small></div></div>
        <div class="bn-grid">${list(c.benefitGroups).map(g => `<div class="bn-g"><div class="bn-t"><span class="ic">${svg(g.icon || 'star')}</span><b>${esc(g.t)}</b><em>${list(g.items).length}</em></div><ul>${list(g.items).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div></div>` : ''}
      ${c.closing ? `<p class="cu-close">${esc(c.closing)}</p>` : ''}` : '';
  return `${bt.lead ? `<p class="lead">${esc(bt.lead)}</p>` : ''}
    <div class="bt-stage">
      <div class="bt-h"><b>${esc(k.title || '유급자 과정')}</b>${k.period ? `<span>${esc(k.period)}</span>` : ''}</div>
      ${k.motto ? `<p class="bt-motto">“${esc(k.motto)}”</p>` : ''}
      ${k.desc ? `<p class="bt-desc">${esc(k.desc)}</p>` : ''}
      <ol class="belts">${list(k.belts).map(beltChip).join('')}</ol>
      ${k.note ? `<p class="bt-note"><i class="kd"></i>${esc(k.note)}</p>` : ''}
    </div>
    ${list(bt.dan).map(s => `<div class="bt-stage dan">
      <div class="bt-h"><b>${esc(s.t)}</b>${s.period ? `<span>${esc(s.period)}</span>` : ''}</div>
      ${s.motto ? `<p class="bt-motto">“${esc(s.motto)}”</p>` : ''}
      ${s.desc ? `<p class="bt-desc">${esc(s.desc)}</p>` : ''}
      ${s.belt ? `<p class="bt-belt"><i style="background:${s.c ? `linear-gradient(180deg,${s.c} 0 50%,#1C1A19 50%)` : '#1C1A19'}"></i>${s.patch ? `<em style="background:${s.patch}"></em>` : ''}${esc(s.belt)}</p>` : ''}
    </div>`).join('')}
    ${bt.closing ? `<p class="bt-foot">${esc(bt.closing)}</p>` : ''}
    ${certHtml}`;
}
// 첫 화면용: 다가오는 일정 + 이달 공지를 한 장에 (색 뱃지 없이 차분하게)
function newsCard(d){
  const next = EVENTS.filter(e => e.en >= TODAY).slice(0, 3);
  const nt = monthNotices(d);
  const rows = next.map(e => {
    const n = dayDiff(e.s, TODAY);
    const label = n > 0 ? 'D-' + n : (n === 0 ? '오늘' : '진행 중');
    return `<li><span class="dday${n <= 0 ? ' now' : ''}">${label}</span><div class="t"><b>${esc(e.title)}</b><span>${esc(e.type || '일정')} · ${rangeText(e)}${e.note ? ' · ' + esc(e.note) : ''}</span></div></li>`;
  }).join('');
  return `<div class="card news">
    <div class="nh"><h3>다가오는 일정</h3><a href="${go('schedule')}">전체 보기 ›</a></div>
    ${rows ? `<ul class="nup">${rows}</ul>` : `<p class="empty">예정된 일정이 없어요.</p>`}
    ${nt.list.length ? `<div class="nh"><h3>${nt.m}월 공지</h3><a href="${go('notice')}">더 보기 ›</a></div>
      <ul class="nnt">${nt.list.slice(0, 3).map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </div>`;
}
function rangeText(e){
  const a = `${e.s.getMonth()+1}.${e.s.getDate()}(${WEEK[e.s.getDay()]})`;
  if(+e.en === +e.s) return a;
  return `${a} ~ ${e.en.getMonth()+1}.${e.en.getDate()}(${WEEK[e.en.getDay()]})`;
}
const eventsOn = dt => EVENTS.filter(e => e.s <= dt && dt <= e.en);

function setupCalendar(){
  const cal = document.getElementById('cal'), box = document.getElementById('evlist');
  if(!cal) return;
  let y = TODAY.getFullYear(), m = TODAY.getMonth(), sel = null;
  const draw = () => {
    const first = new Date(y, m, 1), days = new Date(y, m+1, 0).getDate(), lead = first.getDay();
    let cells = '';
    for(let i = 0; i < lead; i++) cells += '<span class="cell out"></span>';
    for(let dd = 1; dd <= days; dd++){
      const dt = new Date(y, m, dd), evs = eventsOn(dt);
      const cls = ['cell', dt.getDay() === 0 ? 'sun' : '', dt.getDay() === 6 ? 'sat' : '', evs.some(e => e.type === '휴관') ? 'off' : '', +dt === +TODAY ? 'today' : '', sel && +dt === +sel ? 'sel' : ''].join(' ');
      cells += `<button type="button" class="${cls}" data-d="${dd}" aria-label="${m+1}월 ${dd}일${evs.length ? ', 일정 ' + evs.length + '개' : ''}"><span class="n">${dd}</span>
        ${evs.length ? `<span class="dots">${evs.slice(0,3).map(e => `<i style="background:${EV_COLORS[e.type] || EV_COLORS['기타']}"></i>`).join('')}</span>` : ''}</button>`;
    }
    cal.innerHTML = `<div class="cal-top"><button type="button" data-mv="-1" aria-label="이전 달">${svg('left')}</button><b>${y}년 ${m+1}월</b><button type="button" data-mv="1" aria-label="다음 달">${svg('right')}</button></div>
      <div class="grid7">${WEEK.map(w => `<span class="dow">${w}</span>`).join('')}${cells}</div>`;
    cal.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { m += +b.dataset.mv; if(m < 0){ m = 11; y--; } if(m > 11){ m = 0; y++; } sel = null; draw(); });
    cal.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const dt = new Date(y, m, +b.dataset.d); sel = sel && +sel === +dt ? null : dt; draw(); });
    let evs, title;
    if(sel){ evs = eventsOn(sel); title = krDate(sel); }
    else{ const s = new Date(y, m, 1), e = new Date(y, m+1, 0); evs = EVENTS.filter(x => x.s <= e && x.en >= s); title = `${m+1}월 일정`; }
    box.innerHTML = `<h4>${title}</h4>` + (evs.length ? evs.map(e => `
      <div class="ev"><div class="when"><b>${e.s.getDate()}</b><span>${e.s.getMonth()+1}월 ${WEEK[e.s.getDay()]}</span></div>${e.image ? `<img class="thumb" src="${esc(e.image)}" alt="${esc(e.title)}" data-zoom loading="lazy">` : ''}
        <div class="what" style="border-color:${EV_COLORS[e.type] || EV_COLORS['기타']}"><b><span class="tag" style="background:${EV_COLORS[e.type] || EV_COLORS['기타']}">${esc(e.type || '기타')}</span>${esc(e.title)}</b>
        <span>${rangeText(e)}${e.note ? ' · ' + esc(e.note) : ''}</span></div></div>`).join('') : `<div class="ev"><div class="what" style="border-color:var(--line)"><span>등록된 일정이 없어요.</span></div></div>`);
  };
  draw();
}

// ---------- 프로그램 탭 ----------
function setupTabs(){
  const box = document.getElementById('divBox');
  if(!box) return;
  const today = DAYS[TODAY.getDay() - 1];
  let prev = -1;
  const show = i => {
    const v = list(D.program.divisions)[i];
    document.querySelectorAll('.vtabs button').forEach(b => b.classList.toggle('on', +b.dataset.div === i));
    const dir = prev < 0 ? '' : (i > prev ? 'slide-up' : (i < prev ? 'slide-down' : '')); prev = i;
    const days = v.days || {};
    const cls = list(D.classes).find(c => c.name && (c.name === v.name || c.name.split('·').some(w => v.name.includes(w.replace(/부$/, '')))));
    box.innerHTML = `
      <div class="dv ${dir}"><h4>${esc(v.name)}</h4>
      <div class="wcols whead">${DAYS.map(dd => `<div class="wc${dd === today ? ' today' : ''}"><b>${dd}</b></div>`).join('')}</div>
      ${v.common ? `<p class="every2">${esc(v.common)}</p>` : ''}
      <div class="wcols wbody">${DAYS.map(dd => `<div class="wc${dd === today ? ' today' : ''}">${list(days[dd]).map(x => /^\(.*\)$/.test(x) ? `<small>${esc(x.slice(1, -1))}</small>` : `<p>${esc(x)}</p>`).join('')}</div>`).join('')}</div>
      ${list(v.extra).length ? `<div class="cu-purp extra3">${list(v.extra).map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div>`;
  };
  document.querySelectorAll('.vtabs button').forEach(b => b.onclick = () => show(+b.dataset.div));
  show(0);
}

// ---------- 사진 ----------
function gallery(d){
  const pics = list(d.gallery);
  if(!pics.length) return '';
  return `<div class="pstack" aria-label="사진 넘겨보기">
      ${pics.map((p, i) => `<figure class="pc${i === 0 ? ' p0' : i === 1 ? ' p1' : i === 2 ? ' p2' : ''}"><img src="${esc(p)}" alt="수업 사진" ${i > 3 ? 'loading="lazy"' : ''} decoding="async"><figcaption>HAERANG <b>${pad2(i + 1)}</b> / ${pad2(pics.length)}</figcaption></figure>`).join('')}
    </div>
    <p class="ps-hint">옆으로 넘기거나 눌러서 크게 보세요</p>
    <div class="photogrid">${pics.map(p => `<img src="${esc(p)}" alt="수업 사진" loading="lazy">`).join('')}</div>`;
}
function setupStack(){
  const st = document.querySelector('.pstack');
  if(!st) return;
  const cs = [...st.querySelectorAll('.pc')];
  if(cs.length < 2) return;
  let i = 0, t, hold = false;
  const paint = () => cs.forEach((c, k) => {
    const r = (k - i + cs.length) % cs.length;
    c.classList.toggle('p0', r === 0); c.classList.toggle('p1', r === 1); c.classList.toggle('p2', r === 2);
    if(r === 3) c.querySelector('img').loading = 'eager';
  });
  const go = dir => {
    const f = cs[i]; f.classList.add(dir < 0 ? 'outr' : 'out');
    i = (i + (dir < 0 ? -1 : 1) + cs.length) % cs.length;
    paint(); setTimeout(() => f.classList.remove('out', 'outr'), 650);
  };
  const loop = () => { clearInterval(t); t = setInterval(() => { if(!hold && st.isConnected && st.offsetParent) go(1); }, 3800); };
  let x0 = null;
  st.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; hold = true; }, {passive:true});
  st.addEventListener('touchend', e => { hold = false; if(x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if(Math.abs(dx) > 40){ go(dx < 0 ? 1 : -1); loop(); e.preventDefault(); } }, {passive:false});
  st.addEventListener('mouseenter', () => hold = true); st.addEventListener('mouseleave', () => hold = false);
  st.pause = v => hold = v;
  loop();
}
function setupGallery(){
  const lb = document.createElement('div');
  lb.className = 'lightbox'; lb.innerHTML = '<img alt="">';
  document.body.append(lb);
  const m = document.querySelector('.marquee');
  document.getElementById('app').addEventListener('click', e => {
    const img = e.target.closest('.pstack .p0 img, .photogrid img, img[data-zoom]');
    if(!img) return;
    lb.querySelector('img').src = img.src;
    lb.classList.add('on'); const ps = document.querySelector('.pstack'); if(ps && ps.pause) ps.pause(true);
  });
  lb.addEventListener('click', () => { lb.classList.remove('on'); const ps = document.querySelector('.pstack'); if(ps && ps.pause) ps.pause(false); });
}
// 홈의 사진·알림판 슬라이드 (4초마다 넘어감, ‖ 로 멈춤)
function setupSliders(){
  document.querySelectorAll('.slider').forEach(box => {
    const sl = [...box.querySelectorAll('.sl')], cur = box.querySelector('[data-cur]'), pp = box.querySelector('[data-pp]'), capl = box.querySelector('.capline');
    const cap = () => { if(capl && sl[i]){ capl.innerHTML = ''; capl.append(sl[i].dataset.cap || ''); const sm = document.createElement('small'); sm.textContent = sl[i].dataset.sub || ''; capl.append(sm); } };
    let i = 0; cap();
    if(sl.length < 2) return;
    let playing = true, t;
    const show = n => { sl[i].classList.remove('on'); i = (n + sl.length) % sl.length; sl[i].classList.add('on'); if(cur) cur.textContent = String(i + 1).padStart(2, '0'); cap(); };
    const loop = () => { clearInterval(t); if(playing) t = setInterval(() => show(i + 1), 4000); };
    const setPP = () => { pp.innerHTML = svg(playing ? 'pause' : 'play', 2.6); pp.setAttribute('aria-label', playing ? '멈춤' : '재생'); };
    const pv = box.querySelector('[data-prev]'), nx = box.querySelector('[data-next]');
    if(pv) pv.onclick = () => { show(i - 1); loop(); };
    if(nx) nx.onclick = () => { show(i + 1); loop(); };
    pp.onclick = () => { playing = !playing; setPP(); loop(); };
    let x0 = null;
    box.querySelector('.slides').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, {passive:true});
    box.querySelector('.slides').addEventListener('touchend', e => { if(x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if(Math.abs(dx) > 40){ show(i + (dx < 0 ? 1 : -1)); loop(); } x0 = null; });
    setPP(); loop();
  });
}

// ---------- 메뉴 ----------
function setupMenu(){
  const dr = document.getElementById('drawer'), btn = document.getElementById('menuBtn');
  const open = on => {
    dr.classList.toggle('on', on); document.body.classList.toggle('lock', on);
    dr.setAttribute('aria-hidden', on ? 'false' : 'true'); btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  btn.onclick = () => open(true);
  dr.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => open(false)));
  document.addEventListener('keydown', e => { if(e.key === 'Escape') open(false); });
}
function setupTop(){
  const top = document.getElementById('totop');
  top.onclick = () => window.scrollTo({top:0, behavior:'smooth'});
  const f = () => top.classList.toggle('on', window.scrollY > 700);
  window.addEventListener('scroll', f, {passive:true}); f();
}

fetch('data.json?t=' + Date.now())
  .then(r => { if(!r.ok) throw 0; return r.json(); })
  .then(render)
  .catch(() => {
    document.getElementById('app').innerHTML = '<p style="padding:40px 20px;text-align:center;color:#6B6460">내용을 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>';
    document.getElementById('app').classList.add('ready');
  });

// 공유하기: 폰은 공유 창(카톡·문자 등), 지원 안 되면 링크 복사
function toast(msg){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200);
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-share]');
  if(!b) return;
  e.preventDefault();
  const url = 'https://haerangtkd.github.io/';
  const data = {title: '해랑경희 태권도장', text: '울산 남구 해랑경희 태권도장을 소개합니다.', url};
  if(navigator.share){ try { await navigator.share(data); } catch(_){} return; }
  try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요. 원하는 곳에 붙여넣어 보내주세요.'); }
  catch(_){ prompt('아래 링크를 복사해 주세요', url); }
});
