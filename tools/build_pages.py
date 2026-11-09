#!/usr/bin/env python3
"""해랑경희 홈페이지 페이지 생성기

index.html + 메뉴별 하위 페이지(about/culture/training/news/contact.html)를 만든다.
화면은 모두 app.js가 data.json을 읽어서 그리고, 각 페이지에는
네이버 검색로봇이 읽을 수 있도록 실제 글 내용(prerender)을 함께 넣는다.

data.json을 크게 고친 뒤(관리자 페이지 포함) 저장소 루트에서 실행:
    python3 tools/build_pages.py
"""
import json, html, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://haerangtkd.github.io/'
NAME = '해랑경희 태권도장'
SUFFIX = '해랑경희 태권도장 공식 홈페이지'
VER = datetime.datetime.now().strftime('%Y%m%d%H%M')  # 올릴 때마다 바뀌어서 예전 파일이 남지 않음

d = json.load(open(os.path.join(ROOT, 'data.json'), encoding='utf-8'))
e = lambda s: html.escape(str(s or ''), quote=True)
L = lambda v: v if isinstance(v, list) else []


def ul(items):
    items = [i for i in items if i]
    return '<ul>' + ''.join(f'<li>{e(i)}</li>' for i in items) + '</ul>' if items else ''


def p(lines):
    if isinstance(lines, str):
        lines = [lines]
    return ''.join(f'<p>{e(str(x).replace("**", ""))}</p>' for x in L(lines) if x)


# ---------- 페이지별 본문 ----------
def about():
    ph, st, pm = d.get('philosophy', {}), d.get('staff', {}), d.get('promise', {}) or {}
    out = [f'<h2>{e(ph.get("title") or "교육 철학")}</h2>', p(ph.get('questions')), p(ph.get('message'))]
    out += [f'<h2>{e(pm.get("title") or "해랑경희의 약속")}</h2>'] + [f'<p>{e(y.get("year"))} {e(y.get("text"))}</p>' for y in L(pm.get('years'))]
    out += [f'<h2>{e(st.get("title") or "지도진 소개")}</h2>', p(st.get('lead'))]
    for m in L(st.get('members')):
        out.append(f'<h3>{e(m.get("role"))} {e(m.get("name"))}</h3>' + ul(m.get('career', [])))
    out.append(p(st.get('note')))
    out.append('<h2>보도자료</h2>')
    out.append('<ul>' + ''.join(
        f'<li><a href="{e(x.get("url"))}" rel="noopener">{e(x.get("title"))}</a> - {e(x.get("source"))} {e(x.get("date"))}</li>'
        for x in L(d.get('press'))) + '</ul>')
    return ''.join(out)


def training():
    cu, pr = d.get('curriculum', {}), d.get('program', {})
    out = [f'<h2>{e(cu.get("title") or "교육 내용")}</h2>', ul(cu.get('purposes', []))]
    for a in L(cu.get('areas')):
        out.append(f'<h3>{e(a.get("name"))}</h3>' + ul(a.get('items', [])))
    out += [f'<h2>{e(pr.get("title") or "수업 · 시간표")}</h2>']
    for c in L(d.get('classes')):
        out.append(f'<h3>{e(c.get("name"))} {e(c.get("time"))}</h3>' + ul(c.get('points', [])))
    for dv in L(pr.get('divisions')):
        days = dv.get('days') or {}
        out.append(f'<h3>{e(dv.get("name"))} 요일별 수업</h3>' + p(dv.get('common')) +
                   ul([f'{k}: {", ".join(v)}' for k, v in days.items()]))
    ch, le, bt, gp, gr = (d.get(k, {}) or {} for k in ('character', 'leaders', 'belts', 'guinnessPage', 'growth'))
    out += [f'<h2>{e(bt.get("title") or "띠 제도")}</h2>', p(bt.get('lead'))]
    k = bt.get('kup') or {}
    if k:
        out.append(f'<h3>{e(k.get("title"))}</h3>' + p([k.get('period'), k.get('desc')]))
        out.append(ul([b.get('n') for b in L(k.get('belts'))]))
    out += [f'<h2>{e(ch.get("title") or "인성 교육")}</h2>', p(ch.get('lead'))]
    out.append(ul([f'{b.get("t")} - {b.get("d")}' for b in L(ch.get('blocks'))]))
    out += [f'<h2>{e(le.get("title") or "선범단")}</h2>', p((le.get('lead') or '').split('\n'))]
    for g in L(le.get('groups')):
        out.append(f'<h3>{e(g.get("t"))}</h3>' + ul(g.get('items', [])))
    out += [f'<h2>{e(gp.get("title") or "해랑 기네스")}</h2>', p(gp.get('lead'))]
    out.append(ul([f'{f.get("t")} - {f.get("d")}' for f in L(gp.get('facts'))]))
    out += [f'<h2>{e(gr.get("title") or "분기별 성장 측정")}</h2>', p(gr.get('lead'))]
    out.append(ul([f'{f.get("t")} ({f.get("how")}) - {f.get("d")}' for f in L(gr.get('factors'))]))
    return ''.join(out)


def column():
    cp = d.get('columnPage', {}) or {}
    out = [f'<h2>{e(cp.get("title") or "해랑경희 칼럼")}</h2>', p(cp.get('lead'))]
    out.append('<ul>' + ''.join(
        f'<li><a href="{e(x.get("url"))}" rel="noopener">{e(x.get("title"))}</a> - {e(x.get("summary"))}</li>'
        for x in L(d.get('columns'))) + '</ul>')
    return ''.join(out)


def news():
    out = ['<h2>오늘의 운동</h2>', '<h2>해랑경희 일정</h2>']
    today = datetime.date.today().isoformat()
    ev = [x for x in L(d.get('schedule')) if (x.get('end') or x.get('date') or '') >= today[:8] + '01']
    out.append(ul([f'{x.get("date")} {x.get("title")} {x.get("note") or ""}'.strip() for x in ev[:20]]))
    out.append(f'<h2>{e(d.get("galleryTitle") or "사진으로 보는 해랑경희")}</h2>')
    return ''.join(out)


def contact():
    ct, lo, fe = d.get('contact', {}), d.get('location', {}), d.get('fee', {})
    out = [f'<h2>{e(ct.get("title") or "상담 문의")}</h2>']
    out.append(p([f'전화 {ct.get("phone")}', f'대표자 {ct.get("ceo")}', f'주소 {lo.get("address")}']))
    out.append('<ul>' + ''.join(
        f'<li><a href="{e(x.get("url"))}" rel="noopener">{e(x.get("name"))}</a> - {e(x.get("desc"))}</li>'
        for x in L(d.get('links'))) + '</ul>')
    out += [f'<h2>{e(fe.get("title") or "회비 · 차량 안내")}</h2>']
    out.append(ul([f'{x.get("name")} ({x.get("who")}) {x.get("price")}' for x in L(fe.get('plans'))]))
    out.append(p(L(fe.get('notes')) + [fe.get('shuttle'), fe.get('shuttleNote')]))
    out.append('<h2>자주 묻는 질문</h2>')
    for q in L(d.get('faq')):
        out.append(f'<h3>{e(q.get("q"))}</h3>' + p(q.get('a')))
    out.append(f'<h2>{e(lo.get("title") or "오시는 길")}</h2>')
    out.append(p([lo.get('address'), lo.get('landmark'), lo.get('parking')]))
    hrs = lo.get('hours') or {}
    if hrs:
        out.append(ul([f'{k} {v}' for k, v in hrs.items()]))
    return ''.join(out)


def home():
    out = [p(d.get('intro')), p(d.get('slogan'))]
    for c in L(d.get('classes')):
        out.append(f'<h2>{e(c.get("name"))} {e(c.get("time"))}</h2>' + ul(c.get('points', [])))
    return ''.join(out)


PAGES = [
    # 파일, 처음 보여줄 메뉴, 제목, 설명, 본문
    ('index.html', '', SUFFIX,
     f'{SUFFIX} - 교육 철학, 지도진, 수련 프로그램과 시간표, 일정과 오늘의 운동을 한눈에 보실 수 있습니다.', home),
    ('about.html', 'philosophy', '해랑경희 소개',
     f'{NAME}의 교육 철학과 약속, 전문 지도진, 언론 보도를 소개합니다.', about),
    ('training.html', 'curriculum', '수업 안내',
     f'{NAME} 교육 내용, 수업 테마·시간표, 띠 제도, 인성 교육, 선범단(先範團), 해랑 기네스와 분기별 성장 측정을 안내합니다.', training),
    ('column.html', 'column', '해랑경희 칼럼',
     f'{NAME}의 교육 이야기를 담은 해랑경희 칼럼입니다.', column),
    ('contact.html', 'contact', '등록 · 상담',
     f'{NAME} 체험·상담 예약, 회비·차량 안내, 자주 묻는 질문, 오시는 길과 운영 시간.', contact),
    ('news.html', 'today', '도장 소식',
     f'{NAME} 오늘의 운동, 일정, 알림판·공지와 사진.', news),
]
NAV = ''.join(f'<li><a href="{f}">{t if f != "index.html" else "홈"}</a></li>' for f, _, t, _, _ in PAGES)

LD = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": NAME,
    "url": SITE,
    "logo": SITE + "img/icon.png",
    "sameAs": sorted({('/'.join(x['url'].split('/')[:4]) if 'blog.naver' in x['url'] else x['url'])
                      for x in L(d.get('links'))
                      if any(k in x.get('url', '') for k in ('blog.naver', 'instagram', 'pf.kakao', 'talk.naver', 'youtube'))}),
}

TEMPLATE = '''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:url" content="{url}">
<meta property="og:site_name" content="{suffix}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:image" content="{site}img/og.jpg">
<meta name="naver-site-verification" content="45f7b7b64b60a4980ac6398f9fad8636f1121985" />
<script type="application/ld+json">
{ld}
</script>
<link rel="icon" href="img/icon.png">
<link rel="apple-touch-icon" href="img/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Noto+Serif+KR:wght@500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="app.css?v={ver}">
<noscript><style>#app{{opacity:1;padding:24px;max-width:900px;margin:0 auto}}</style></noscript>
</head>
<body>
<!-- 이 파일은 tools/build_pages.py가 만듭니다. 화면 코드는 app.js / app.css, 내용은 data.json -->
<div id="app"><div class="seo">
<h1>{h1}</h1>
<nav><ul>{nav}</ul></nav>
{body}
</div></div>
<script>window.START_PAGE = {start};</script>
<script src="app.js?v={ver}"></script>
</body>
</html>
'''

for f, start, t, desc, fn in PAGES:
    title = t if f == 'index.html' else f'{t} | {SUFFIX}'
    url = SITE if f == 'index.html' else SITE + f
    out = TEMPLATE.format(
        title=e(title), desc=e(desc), url=url, suffix=e(SUFFIX), site=SITE, ver=VER,
        ld=json.dumps(LD, ensure_ascii=False, indent=2), h1=e(NAME if f == 'index.html' else f'{NAME} {t}'),
        nav=NAV, body=fn(), start=json.dumps(start))
    open(os.path.join(ROOT, f), 'w', encoding='utf-8').write(out)

sm = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for f, *_ in PAGES:
    sm.append(f'  <url>\n    <loc>{SITE if f == "index.html" else SITE + f}</loc>\n'
              f'    <lastmod>{datetime.date.today().isoformat()}</lastmod>\n  </url>')
sm.append('</urlset>')
open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8').write('\n'.join(sm) + '\n')
print('built:', ', '.join(x[0] for x in PAGES), '+ sitemap.xml')
