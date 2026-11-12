// 해랑경희 등록 서류 (기본정보 + 제자희망서) — 태블릿 상담 모드에서 쓰고, 업무 앱에서 봅니다.
// 초록 = 초등부(kid), 파랑 = 중고등·성인(adult). 종이 서류 내용을 그대로 옮겼어요.
// 서류 글을 고치면 앞으로 받는 서류부터 바뀌고, 이미 받은 서류는 받을 때의 글 그대로 남아요(서버에 함께 저장).
(function () {
  const ART = {
    kid: [
      { t: '1조 "안전하게 수련하기" 규정', b: '태권도 수련 중에는 뜻하지 않게 다칠 수도 있어요! 저희 지도진은 제자가 병원에 이송되기 전까지 할 수 있는 응급처치를 할 거랍니다. 또한, 제자의 상황을 보호자께 바로 보고드릴 거예요. 혹시나 제자가 개인적으로 실수로 다쳤을 경우, 저희 지도진에게 알리지 않으면 저희는 아이가 다쳐도 알 수 없을 지도 몰라요.\n도장에서 일어나는 부상, 괴롭힘 등이 있으면 주저 하지 않고, 지도진에게 꼭 알리라고 교육해주세요!' },
      { t: '2조 "레벨 UP! 승급심사" 및 초상권 규정', b: '승급심사는 1개월 단위로 진행해요. 태권도장에서 계획한 운동목표를 달성한다면 승급이 가능합니다.\n부득이한 경우에는 반드시 도장에 미리 연락을 주세요.\n그리고 도장에서 운동하는 모습이 저희 태권도장 SNS 또는 밴드에 공유될 수 있습니다.\n불편하신 분들께서는 미리 말씀해주시면 업로드 되지 않도록 하겠습니다.', photo: true },
      { t: '3조 "소중한 태권도 교육비 환불" 규정', b: '교육비는 지정일 결제 형식으로 진행됩니다. (ex. 3월 20일 입관 → 다음 회차 결제일 4월 20일)\n월별 일수 차이, 공휴일, 정기 휴관일에 따른 수업 일수가 많아지거나 줄어들어도 변동 없이 동일 하게 적용됩니다. 개인적인 사유로 인해 4영업일 이상 결석하게 되면 정기 결제일을 보류 해드립니다.\n정기휴관일(공휴일, 하계·동계도장방학, 9월4일 태권도의 날)' },
      { t: '4조 "분리" 규정', b: '① 자기 스스로를 다치게 할 위험이 있을 경우, ② 남을 다치게 할 위험이 있을 경우, ③ 사회통념상 손가락질을 받을 행동을 한 경우 정도에 따라 임시분리, 단기분리, 영구분리 조치가 진행될 수 있습니다.\n모든 수련생들이 안전하게 운동하기 위한 규정이고, 안전해야 즐거울 수 있음을 제자에게도 알려주세요!' },
    ],
    adult: [
      { t: '1조 "안전하게 수련하기" 규정', b: '태권도 수련 중에는 뜻하지 않게 다칠 수도 있어요! 저희 지도진은 제자가 병원에 이송되기 전까지 할 수 있는 응급처치를 할 거랍니다. 혹시나 개인적으로 실수로 다쳤을 경우 또는 몸의 상태가 좋지 않을 경우 저희 지도진에게 알리지 않으면 저희 스스로 알 수 없을지도 몰라요.\n도장에서 일어나는 부상 등이 있으면 주저 하지 않고, 지도진에게 꼭 알려주세요!' },
      { t: '2조 "소중한 태권도 교육비 환불" 규정', b: '승급심사는 1개월 단위로 진행해요. 태권도장에서 계획한 운동목표를 달성한다면 승급이 가능합니다.\n부득이한 경우에는 반드시 도장에 미리 연락을 주세요.\n환불 불가가 원칙이나 상호 합의하에 결제일을 미뤄드릴 수 있어요.' },
      { t: '3조 "친해지기, 화해하기" 및 초상권 규정', b: '혹여나, 지도진 혹은 제자와 제자들 사이에 문제가 발생하여 서로 마음 아픈 일이 발생할 경우에는 감정이 아닌 이성적으로 문제를 해결하도록 함께 노력해주세요.\n그리고 도장에서 운동하는 모습이 저희 태권도장 SNS 또는 밴드에 공유될 수 있습니다.\n불편하신 분들께서는 미리 말씀해주시면 업로드 되지 않도록 하겠습니다.', photo: true },
      { t: '4조 내몸 "스스로 챙기기" 규정', b: '내 몸은 소중한 나의 자산으로 운동에 참여하면서 항상 위험이 있음을 인식하여주세요.\n도중에 일어나는 부상에 대해 스스로 조심하고 스스로 책임져야 합니다.\n· 기구를 이용할 때\n· 기능을 평가하기 위하여 체력과 관련된 평가를 할 때\n· 운동과 관련된 집단 활동에 참가할 때\n· 해랑경희 태권도장의 설비나 탈의실 및 기관 내 다른 장소에서 항상 조심하시고 스스로 개인의 컨디션을 꼼꼼히 체크하셔서 부상의 위험에서 안전하게 운동하시길 바랍니다.' },
    ],
  };
  const CLOSE = {
    kid: '태권도장은 제자가 언제나 즐겁고, 바르게 태권도 수련을 할 수 있도록 올바르게 지도하겠습니다',
    adult: '태권도장은 언제나 즐겁고, 바르게 수련을 할 수 있도록 지도하겠습니다.',
  };
  // 비용 기본값 (업무 앱 설정에서 관리자가 바꿀 수 있어요)
  const FEES = {
    kid: [{ n: '입관비', p: 20000 }, { n: '도복비', p: 30000 }, { n: '수강료 (주5 이하)', p: 165000, g: '수강료' }, { n: '수강료 (주3 이하)', p: 145000, g: '수강료' }],
    adult: [{ n: '입관비', p: 20000 }, { n: '도복비', p: 40000 }, { n: '아디다스 도복비', p: 90000 }, { n: '수강료 (주5 이하)', p: 175000, g: '수강료' }],
  };
  const KIND = { kid: { label: '초등부', color: '#4E8A3E', soft: '#EEF5EA' }, adult: { label: '중고등·성인', color: '#2F5D9A', soft: '#EAF0F8' } };
  const ROUTE = ['자녀', '지인', '보호자', '인터넷', '홍보물'];
  const HEALTH = ['건강', '가끔 아픔', '자주 아픔', '현재도 아픔'];
  // 기본정보 칸 (sec: 묶음 제목)
  const INFO = {
    kid: [
      { sec: '제자의 기본사항', id: 'name', label: '성명', type: 'text', need: 1 },
      { id: 'sex', label: '성별', type: 'pick', opts: ['남', '여'] },
      { id: 'birth', label: '생일', type: 'date', need: 1 }, { id: 'lunar', label: '양력/음력', type: 'pick', opts: ['양력', '음력'] },
      { id: 'school', label: '학교/유치원', type: 'text' }, { id: 'grade', label: '학년', type: 'text', w: 's' }, { id: 'cls', label: '반', type: 'text', w: 's' },
      { id: 'addr', label: '주소', type: 'text' },
      { id: 'receipt', label: '현금영수증', type: 'pick', opts: ['○', '×'] }, { id: 'receiptNo', label: '현금영수증 번호', type: 'tel' },
      { id: 'home', label: '자택전화', type: 'tel' }, { id: 'phone', label: '제자전화', type: 'tel' },
      { sec: '가족사항', id: 'sib', label: '형제 (몇 남 몇 녀 중 몇째)', type: 'text', ph: '예: 1남 1녀 중 첫째' },
      { id: 'family', label: '가족', type: 'family', cols: ['관계', '성명', '생년월일', '연락처', '특이사항'], need: 1 },
      { sec: '제자를 알아가기 위한 필수 질문', id: 'tkd', label: '태권도를 수련한 경험이 있나요?', type: 'yn', more: [{ id: 'tkdUntil', label: '언제까지 (년 월 일, 띠·품)' }, { id: 'tkdWhere', label: '어디서' }, { id: 'tkdWhy', label: '그만둔 이유' }] },
      { id: 'want', label: '자녀가 태권도를 배우고 싶어 하나요?', type: 'yn', more: [{ id: 'wantWhy', label: '이유', always: 1 }] },
      { id: 'route', label: '도장을 알게 된 경로', type: 'pick', opts: ROUTE, more: [{ id: 'routeWho', label: '추천인', always: 1 }] },
      { id: 'sport', label: '다른 운동을 배운 적이 있나요?', type: 'yn', more: [{ id: 'sportWhat', label: '종목' }, { id: 'sportLong', label: '기간' }] },
      { id: 'env', label: '가정 환경 (해당되시면 체크)', type: 'multi', opts: ['편부', '편모', '다문화가정', '조부모', '새터민'], more: [{ id: 'envNation', label: '다문화가정이면 국적' }] },
      { id: 'char', label: '성격은 어때요?', type: 'multi', opts: ['활발하고 리더십이 있다', '사교적', '내성적', '낯가림', '적응력 부족', '감정표현을 잘 함', '감정표현이 적음', '겁이 많은'], more: [{ id: 'charEtc', label: '기타', always: 1 }] },
      { id: 'need', label: '태권도가 필요한 이유 (기대하는 성장 후 모습)', type: 'multi', opts: ['인성교육', '사회성 향상', '호신술', '기초체력 향상', '다이어트'], more: [{ id: 'needEtc', label: '기타', always: 1 }] },
      { id: 'care', label: '현재 치료를 받고 있나요?', type: 'multi', opts: ['ADHD', '틱증후군', '심리치료', '미술치료', '치아교정'], more: [{ id: 'careEtc', label: '기타', always: 1 }] },
      { id: 'health', label: '건강 상태는 어떤가요?', type: 'pick', opts: HEALTH, more: [{ id: 'sick', label: '질병', always: 1 }] },
      { id: 'fit', label: '자녀의 체력 점수', type: 'pick', opts: ['상', '중', '하'] },
      { id: 'manner', label: '자녀의 예절 점수', type: 'pick', opts: ['상', '중', '하'] },
      { id: 'period', label: '희망하는 태권도 교육기간', type: 'pick', opts: ['○품까지', '○학년까지', '아이가 원할 때까지', '미정'], more: [{ id: 'periodWhat', label: '몇 품 / 몇 학년', always: 1 }] },
      { id: 'week', label: '수업 요일 지정 (시간·차량)', type: 'week' },
      { id: 'start', label: '태권도 시작 가능일 (첫 수업 일자)', type: 'date' },
    ],
    adult: [
      { sec: '제자의 기본사항', id: 'name', label: '성명', type: 'text', need: 1 },
      { id: 'sex', label: '성별', type: 'pick', opts: ['남', '여'] },
      { id: 'birth', label: '생일', type: 'date', need: 1 }, { id: 'lunar', label: '양력/음력', type: 'pick', opts: ['양력', '음력'] },
      { id: 'school', label: '학교/직장', type: 'text' }, { id: 'grade', label: '학년', type: 'text', w: 's' }, { id: 'rank', label: '직급', type: 'text', w: 's' },
      { id: 'addr', label: '주소', type: 'text' },
      { id: 'home', label: '자택전화', type: 'tel' }, { id: 'phone', label: '제자전화', type: 'tel' },
      { sec: '가족사항', id: 'family', label: '가족', type: 'family', cols: ['관계', '성명', '생년월일', '연락처', '직업'] },
      { sec: '잘 알아야 잘 지도할 수 있다! 솔직하게 답변 부탁드립니다', id: 'tkd', label: '태권도를 수련한 경험이 있나요?', type: 'yn', more: [{ id: 'tkdUntil', label: '가장 최근 언제까지 배우셨나요?' }, { id: 'tkdDan', label: '유급자 / 1단~5단' }] },
      { id: 'sport', label: '다른 운동을 배운 적이 있나요?', type: 'yn', more: [{ id: 'sportWhat', label: '종목' }, { id: 'sportLong', label: '기간' }] },
      { id: 'want', label: '운동을 하고 싶은가요?', type: 'yn', more: [{ id: 'wantWhy', label: '이유', always: 1 }] },
      { id: 'route', label: '도장을 알게 된 경로', type: 'pick', opts: ROUTE, more: [{ id: 'routeWho', label: '추천인', always: 1 }] },
      { id: 'health', label: '건강 상태는 어떤가요?', type: 'pick', opts: HEALTH, more: [{ id: 'sick', label: '질병', always: 1 }] },
      { id: 'drink', label: '평소 음주 습관은?', type: 'pick', opts: ['거의 마시지 않는다', '월 2~3회 정도 마신다', '주 1~2회 마신다', '주 3~4회 마신다', '거의 매일 마신다'], more: [{ id: 'drinkAmt', label: '술을 마신다면 1회에 마시는 양', always: 1 }] },
      { id: 'smoke', label: '담배를 피우시나요?', type: 'pick', opts: ['피우지 않는다', '과거 피웠으나 현재 끊었다', '현재 피운다'], more: [{ id: 'smokeAmt', label: '담배를 피우신다면 하루에 피우는 양', always: 1 }] },
      { id: 'start', label: '태권도 시작 가능일 (수업 시작일)', type: 'date' },
    ],
  };
  const TYPES = ['신규 제자', '재입관 제자', '정보변경'];
  const WK = ['월', '화', '수', '목', '금'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => (+n || 0).toLocaleString('ko-KR') + '원';

  // 입력한 값 → 저장용 목록 [{sec, label, value}] (받을 때의 질문 그대로 남김)
  function flatten(kind, v) {
    const out = []; let sec = '';
    for (const f of INFO[kind]) {
      if (f.sec) sec = f.sec;
      let val = '';
      if (f.type === 'family') val = (v.family || []).filter(r => r.some(x => x)).map(r => f.cols.map((c, i) => r[i] ? c + ' ' + r[i] : '').filter(Boolean).join(' · ')).join('\n');
      else if (f.type === 'week') val = WK.map(d => (v.week || {})[d] && ((v.week[d].t || v.week[d].car) ? d + ' ' + (v.week[d].t || '') + (v.week[d].car ? ' (차량)' : '') : '')).filter(Boolean).join(', ');
      else if (f.type === 'multi') val = (v[f.id] || []).join(', ');
      else val = v[f.id] || '';
      const more = (f.more || []).map(m => v[m.id] ? m.label + ': ' + v[m.id] : '').filter(Boolean).join(' / ');
      if (val || more) out.push({ sec, label: f.label, value: [val, more].filter(Boolean).join(' · ') });
    }
    return out;
  }

  // 저장된 서류 → 보기용 HTML (업무 앱·인쇄)
  function view(rec, opt) {
    opt = opt || {}; const k = KIND[rec.kind] || KIND.kid; let sec = '';
    const info = (rec.info || []).map(x => { const h = x.sec !== sec ? '<h4>' + esc(x.sec) + '</h4>' : ''; sec = x.sec; return h + '<div class="cf-r"><span>' + esc(x.label) + '</span><b>' + esc(x.value).replace(/\n/g, '<br>') + '</b></div>'; }).join('');
    const arts = (rec.articles || []).map(a => '<div class="cf-a"><b>' + esc(a.t) + '</b><p>' + esc(a.b).replace(/\n/g, '<br>') + '</p>' + (a.photo && rec.photoNo ? '<p class="cf-no">📵 사진·영상 SNS 업로드 원하지 않음</p>' : '') + '<em>' + (a.ok ? '✓ 네, 알겠습니다' : '—') + '</em></div>').join('');
    const fees = (rec.fees || []).filter(f => f.on);
    return '<div class="cf-doc" style="--cf:' + k.color + ';--cfs:' + k.soft + '">' +
      '<div class="cf-h"><b>해랑경희 태권도장 등록 서류</b><span>' + esc(k.label) + ' · ' + esc(rec.type || '') + '</span></div>' +
      '<h3>기본정보</h3>' + info +
      '<h3>제자희망서</h3>' + arts +
      '<h4>비용</h4>' + (fees.length ? fees.map(f => '<div class="cf-r"><span>' + esc(f.n) + '</span><b>' + won(f.p) + '</b></div>').join('') + '<div class="cf-r cf-t"><span>합계</span><b>' + won(rec.total) + '</b></div>' : '<p class="cf-m">선택한 비용 없음</p>') +
      (rec.payDay ? '<div class="cf-r"><span>교육비 납부일</span><b>' + esc(rec.payDay) + '</b></div>' : '') +
      '<p class="cf-close">위 사항을 약속합니다. · ' + esc(rec.date || '') + '</p>' +
      '<div class="cf-sign"><span>이름: <b>' + esc(rec.signer || '') + '</b>' + (rec.signerRel ? ' (' + esc(rec.signerRel) + ')' : '') + '</span>' + (rec.sign ? '<img src="' + esc(rec.sign) + '" alt="서명">' : (opt.noSign ? '' : '<em>서명 불러오는 중…</em>')) + '</div>' +
      '<p class="cf-close">' + esc(rec.closing || '') + '<br>해랑경희 태권도장 대표 이아빈</p></div>';
  }
  const CSS = '.cf-doc{font-size:15px;line-height:1.55;color:#1F1B18}.cf-doc .cf-h{background:var(--cf);color:#fff;border-radius:14px;padding:12px 14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.cf-doc .cf-h span{opacity:.9;font-size:13px;font-weight:700}.cf-doc h3{font-size:17px;margin:18px 0 6px;color:var(--cf)}.cf-doc h4{font-size:13.5px;margin:14px 0 4px;color:#6F6862}.cf-doc .cf-r{display:flex;gap:10px;border-bottom:1px solid #EEE7E0;padding:7px 0}.cf-doc .cf-r span{flex:0 0 38%;color:#6F6862;font-size:13.5px}.cf-doc .cf-r b{flex:1;font-weight:600;word-break:break-all}.cf-doc .cf-t b{color:var(--cf);font-weight:800}.cf-doc .cf-a{background:var(--cfs);border-radius:12px;padding:10px 12px;margin:8px 0}.cf-doc .cf-a p{font-size:13.5px;margin:4px 0}.cf-doc .cf-a em{font-style:normal;font-weight:800;color:var(--cf);font-size:13.5px}.cf-doc .cf-no{color:#A40F16!important;font-weight:800}.cf-doc .cf-m{color:#6F6862;font-size:13.5px}.cf-doc .cf-close{text-align:center;color:#6F6862;font-size:13.5px;margin:14px 0}.cf-doc .cf-sign{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #EEE7E0;border-radius:12px;padding:8px 12px}.cf-doc .cf-sign img{height:90px;max-width:60%;object-fit:contain}';

  window.HAERANG_FORMS = { ART, CLOSE, FEES, KIND, INFO, TYPES, WK, flatten, view, CSS, esc, won };
})();
