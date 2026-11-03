# Спільні шляхи для UI-тестів: гра береться з dist/, скриншоти пишуться в test/out/
# (або в теку з UI_OUT). Тести запускаються з будь-якої поточної теки.
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# YUGO_GAME — інший файл гри (напр. реліз із releases/) замість свіжої збірки
GAME = 'file://' + os.path.abspath(os.environ.get('YUGO_GAME') or os.path.join(ROOT, 'dist', 'Yugotaria-Civil-War.html'))
OUT = os.environ.get('UI_OUT') or os.path.join(ROOT, 'test', 'out')
os.makedirs(OUT, exist_ok=True)


def out(name):
    return os.path.join(OUT, name)
