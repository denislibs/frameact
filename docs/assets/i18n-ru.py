# Generates how-it-works.ru.html from how-it-works.html.
# Keep the English file as the source of truth; re-run this after editing it.
# usage: python3 i18n-ru.py
import sys

SRC, DST = "how-it-works.html", "how-it-works.ru.html"
s = open(SRC, encoding="utf-8").read()

PAIRS = [
    # fonts: Archivo has no Cyrillic — titles switch to Unbounded
    ('family=Archivo:wdth,wght@125,900&', 'family=Archivo:wdth,wght@125,900&family=Unbounded:wght@800&'),
    ('<title>frameact — how it renders</title>', '<title>frameact — как это рендерит</title>'),
    ('<html lang="en">', '<html lang="ru">'),
    ('.t{font-family:Archivo,sans-serif;font-stretch:125%;font-weight:900;font-size:34px;',
     '.t{font-family:Unbounded,sans-serif;font-weight:800;font-size:27px;'),
    ('.outro .tag{margin-top:26px;font-family:Archivo,sans-serif;font-stretch:125%;font-weight:900;font-size:28px;',
     '.outro .tag{margin-top:26px;font-family:Unbounded,sans-serif;font-weight:800;font-size:22px;'),
    # chrome
    ('<span class="s">how it renders</span>', '<span class="s">как это рендерит</span>'),
    ('how it renders · in six frames', 'как это рендерит · в шести кадрах'),
    ('<i></i>01 signals', '<i></i>01 сигналы'),
    ('<i></i>02 one pass', '<i></i>02 один проход'),
    ('<i></i>03 phases', '<i></i>03 фазы'),
    ('<i></i>05 gating', '<i></i>05 гейтинг'),
    # 01
    ('01 · signals, not a VDOM', '01 · сигналы, а не VDOM'),
    ('Graph now.<br>DOM on the frame.', 'Граф — сразу.<br>DOM — в кадре.'),
    ('<b>set()</b> marks dependents dirty immediately. Nothing touches the DOM until the next rAF tick.',
     '<b>set()</b> сразу помечает зависимые узлы грязными. DOM никто не трогает до следующего тика rAF.'),
    ('// compute · pure', '// compute · чисто'),
    ('// apply · on frame', '// apply · в кадре'),
    ('>signal</text>', '>сигнал</text>'),
    ('>memo</text>', '>мемо</text>'),
    ('>effect</text>', '>эффект</text>'),
    ('>mutation</text>', '>мутация</text>'),
    ('>dirty</text>', '>грязный</text>'),
    ('>queued</text>', '>в очереди</text>'),
    # 02
    ('02 · one pass per frame', '02 · один проход на кадр'),
    ('Three writes.<br>One commit.', 'Три записи.<br>Один коммит.'),
    ('Writes batch between ticks. On the tick the graph settles once and every DOM binding is applied once, in order.',
     'Записи копятся между тиками. На тике граф досчитывается один раз, и каждый DOM-биндинг применяется один раз, по порядку.'),
    ('// graph: count → label, recomputed once', '// граф: count → label, пересчитан один раз'),
    ('// DOM:   el.textContent = "3 unread", once', '// DOM:  el.textContent = "3 unread", один раз'),
    ('DOM writes this frame', 'DOM-записей в этом кадре'),
    ('one pass · one write', 'один проход · одна запись'),
    # 03
    ('Reads first.<br>Writes second.', 'Сначала чтение.<br>Потом запись.'),
    ('Effects arrive in any order. The scheduler runs every layout read before the first DOM write, so layout is computed <b>once per frame</b>, never thrashed.',
     'Эффекты приходят в любом порядке. Планировщик выполняет все чтения layout до первой записи в DOM, поэтому layout считается <b>один раз за кадр</b>, без thrashing.'),
    ('// deps', '// зависимости'),
    ('// read layout', '// чтение layout'),
    ('// write DOM', '// запись в DOM'),
    ('one frame · 16.7 ms', 'один кадр · 16.7 мс'),
    ('arrive in this order ↓', 'приходят в таком порядке ↓'),
    ('read scrollHeight', 'чтение scrollHeight'),
    ('write style.height', 'запись style.height'),
    ('read getBoundingClientRect', 'чтение getBoundingClientRect'),
    ('write classList', 'запись classList'),
    ('>interleaved</text>', '>вперемешку</text>'),
    # 04
    ('Read after write?<br>Say so.', 'Читать после записи?<br>Скажи явно.'),
    ('A forced reflow is an <b>explicit</b> measurement slot after mutate, with its own write slot after it. One extra layout, on purpose, still before paint. Rare by design.',
     'Forced reflow — <b>явный</b> слот измерения после mutate со своим слотом записи следом. Один лишний layout, осознанно, всё ещё до paint. Редкость by design.'),
    ('// 1 · write', '// 1 · запись'),
    ('// 2 · read mid-frame', '// 2 · чтение в кадре'),
    ('// 3 · write after', '// 3 · запись после'),
    ('>then write</text>', '>затем запись</text>'),
    ('list · viewport', 'список · viewport'),
    ('>anchor</text>', '>якорь</text>'),
    ('1 · prepend 4 older messages', '1 · сверху добавили 4 старых сообщения'),
    ('anchor is pushed down', 'якорь уехал вниз'),
    ('layout recalculated once, mid-frame', 'layout пересчитан один раз, в середине кадра'),
    ('anchor back in place · no visible jump', 'якорь на месте · прыжка нет'),
    # 05
    ('05 · heavy-animation gating', '05 · гейтинг тяжёлых анимаций'),
    ('Animation first.<br>Updates land after.', 'Сначала анимация.<br>Обновления потом.'),
    ('While a blocking animation runs, frame work is held back — <b>whole frames, never half</b>. When it ends, everything lands in one pass.',
     'Пока идёт blocking-анимация, кадровая работа ждёт — <b>целыми кадрами, не половинами</b>. Когда она кончается, всё приземляется одним проходом.'),
    ('// store keeps flowing…', '// стор продолжает писать…'),
    ('// …and commits here', '// …а коммит здесь'),
    ('panel · sliding', 'панель · едет'),
    ('heavy animation · frame queues gated', 'тяжёлая анимация · кадровые очереди под гейтом'),
    ('>held</text>', '>ждут</text>'),
    ('animation done · held writes released together', 'анимация кончилась · записи отпущены вместе'),
    # 06
    ('Break a phase,<br>get named.', 'Нарушил фазу —<br>узнаешь кто.'),
    ('In dev, the DOM API itself is guarded. A write during <b>measure</b> is caught at the call site and attributed to the effect that did it.',
     'В dev под охраной сам DOM API. Запись во время <b>measure</b> ловится в точке вызова и атрибутируется эффекту, который её сделал.'),
    ('// ← write in measure', '// ← запись в measure'),
    ('el.style.width during measure', 'el.style.width во время measure'),
    ('✕ stricterdom · DOM mutation during "measure" phase', '✕ stricterdom · мутация DOM во время фазы "measure"'),
    ('  at MessageList.tsx:41', '  в MessageList.tsx:41'),
    ('→ move the write into createMutationEffect', '→ перенеси запись в createMutationEffect'),
    ('>console</text>', '>консоль</text>'),
    # credits
    ('>made by</span>', '>сделано</span>'),
    ('&amp; bro claude', 'и братишка claude'),
    ('.credits .amp{font-family:Archivo,sans-serif;font-stretch:125%;font-weight:900;font-size:22px;', '.credits .amp{font-family:Unbounded,sans-serif;font-weight:800;font-size:19px;'),
    # outro
    ('Fine-grained signals. <span>One commit per frame.</span>', 'Мелкозернистые сигналы. <span>Один коммит на кадр.</span>'),
]

missing = [a for a, _ in PAIRS if a not in s]
if missing:
    sys.exit("not found in source:\n  " + "\n  ".join(missing))
for a, b in PAIRS:
    s = s.replace(a, b)
open(DST, "w", encoding="utf-8").write(s)
print(DST, "written,", len(PAIRS), "replacements")
