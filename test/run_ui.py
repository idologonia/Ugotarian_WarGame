# Запускає UI-тести test/ui*_test.py (Python + Playwright) проти dist/Yugotaria-Civil-War.html.
#   python3 test/run_ui.py         — усі
#   python3 test/run_ui.py ui12    — лише вибрані
# Ці скрипти здебільшого друкують стан інтерфейсу для перегляду, а не порівнюють значення,
# тому провалом вважається: виняток (ненульовий код) або помилка JS на сторінці
# (рядок «ERRORS [...]» не порожній чи «PAGEERROR» у виводі). Скриншоти — у test/out/.
import glob, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
filters = sys.argv[1:]
files = sorted(f for f in glob.glob(os.path.join(HERE, 'ui*_test.py'))
               if not filters or any(x in os.path.basename(f) for x in filters))
if not os.path.exists(os.path.join(HERE, '..', 'dist', 'Yugotaria-Civil-War.html')):
    sys.exit('Немає dist/Yugotaria-Civil-War.html — спершу виконайте: node build.js')

failed = []
t0 = time.time()
for f in files:
    name = os.path.basename(f)
    try:
        r = subprocess.run([sys.executable, f], capture_output=True, text=True, timeout=300)
        out, code = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, code = '[перевищено час очікування 300 с]', -1
    bad_errs = [l for l in out.splitlines() if l.startswith('ERRORS') and l.strip() != 'ERRORS []']
    ok = code == 0 and not bad_errs and 'PAGEERROR' not in out
    print(('✓ ' if ok else '✗ ') + name)
    if not ok:
        failed.append(name)
        print('\n'.join('    ' + l for l in out.strip().splitlines()[-20:]))

print(f'\n{len(files) - len(failed)}/{len(files)} пройдено за {time.time() - t0:.1f} с')
sys.exit(1 if failed else 0)
