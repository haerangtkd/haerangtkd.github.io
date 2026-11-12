#!/usr/bin/env python3
"""장부 화면(ledger/index.html)의 회비 계산 코드(HL)를 장부 서버(ledger/worker/worker.js)에 똑같이 복사한다.
화면의 HL을 고치면 이걸 한 번 돌리고 장부 서버를 다시 배포한다:  python3 tools/sync_ledger_hl.py"""
import pathlib, re, sys
R = pathlib.Path(__file__).resolve().parent.parent
html = (R / 'ledger/index.html').read_text()
m = re.search(r"/\* 해랑경희 장부 — 계산 로직.*?\}\)\(typeof globalThis !== 'undefined' \? globalThis : this\);", html, re.S)
if not m: sys.exit('HL 코드를 찾지 못했어요')
B, E = '// ==== HL 시작 (ledger/index.html에서 자동 복사 · 손으로 고치지 말고 tools/sync_ledger_hl.py) ====', '// ==== HL 끝 ===='
w = (R / 'ledger/worker/worker.js').read_text()
block = B + '\n' + m.group(0) + '\n' + E
if B in w: w = w[:w.index(B)] + block + w[w.index(E) + len(E):]
else: w = w.rstrip() + '\n\n' + block + '\n'
(R / 'ledger/worker/worker.js').write_text(w)
print('HL 복사함:', len(m.group(0)), '글자')
