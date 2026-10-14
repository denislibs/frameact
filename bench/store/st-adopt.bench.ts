// adopt() on writes that reuse store-owned objects (a client that mirrors an immutable global into the
// store writes entities and containers by reference): a container replaced by a new object whose
// children are mostly reused, a fresh result set referencing existing entities, and the all-new
// controls (pure adoption cost, cold createStore).
import { clearRaf } from './env';
import { createStore, unwrap } from '../../src/store/index';
import { heap, msOnce, report } from './util';

type Msg = { id: number; chatId: number; date: number; isOutgoing: boolean; content: { text: { text: string; entities: { type: string; offset: number; length: number }[] } }; reactions: { results: { emoji: string; count: number }[] }; views: number };
type Chat = { id: number; title: string; type: string; unreadCount: number; photo: { small: string; big: string }; permissions: { canSend: boolean; canPin: boolean }; lastMessageId: number; folderIds: number[] };
const msg = (i: number): Msg => ({ id: i, chatId: 7, date: 1700000000 + i, isOutgoing: i % 3 === 0, content: { text: { text: `message ${i}`, entities: [{ type: 'bold', offset: 0, length: 4 }] } }, reactions: { results: [{ emoji: '👍', count: 1 + (i % 5) }] }, views: 10 });
const chat = (i: number): Chat => ({ id: i, title: `chat ${i}`, type: 'chatTypePrivate', unreadCount: i % 7, photo: { small: `s${i}`, big: `b${i}` }, permissions: { canSend: true, canPin: i % 2 === 0 }, lastMessageId: i * 3, folderIds: [0, 1] });
const dict = <T,>(n: number, make: (i: number) => T) => { const d: Record<string, T> = {}; for (let i = 0; i < n; i++) d[i] = make(i); return d; };

const CHATS = 1000;
const MSGS = 5000;
process.stdout.write('| adopt on write (prod bundle) | cost | notes |\n|---|---|---|\n');
{
  // the ownership table, measured first (an ephemeron table keeps its peak capacity): heap per message of
  // a tree that stays alive, as a tab holds it — 8 objects per message, 6 of them containers
  const N = 20000;
  const initial = { messages: { byId: dict(N, msg) } };
  const h0 = heap();
  const keep = createStore(initial);
  const h1 = heap();
  report(`store bookkeeping per message, ${N} messages kept alive`, (h1 - h0) / N, 'B', `(root node + the owned-container table; raw message ≈ 8 objects) |`);
  if (keep.length !== 2) throw 0;
}
{
  // chats.byId replaced by a new dictionary: 999 chats reused by reference, 1 new (nobody read them through a proxy)
  const [state, setState] = createStore({ chats: { byId: dict(CHATS, chat) } });
  let k = CHATS;
  report(
    `replace a ${CHATS}-key dict, 1 new child, the rest reused store objects`,
    msOnce(() => ({ ...unwrap(state.chats.byId), [k]: chat(k++) }), (next) => setState('chats', 'byId', next), { runs: 25, warm: 10 }),
    'ms', `(${CHATS - 1} children already owned) |`,
  );
}
{
  // a fresh search result set: 5k new result objects, each referencing an existing message (never read)
  const [state, setState] = createStore({ messages: { byId: dict(MSGS, msg) }, search: { query: '', results: [] as { id: number; message: Msg }[] } });
  const byId = unwrap(state.messages.byId);
  let q = 0;
  report(
    `write a fresh ${MSGS}-item result set referencing existing messages`,
    msOnce(() => ({ query: `q${q++}`, results: Array.from({ length: MSGS }, (_, i) => ({ id: i, message: byId[i] })) }), (next) => setState('search', next), { runs: 25, warm: 10 }),
    'ms', `(${MSGS} new objects, ${MSGS} owned) |`,
  );
}
{
  // control: the same write with ALL-NEW messages (nothing to skip: pure adoption cost per object)
  const [, setState] = createStore({ search: { query: '', results: [] as { id: number; message: Msg }[] } });
  let q = 0;
  report(
    `write a fresh ${MSGS}-item result set with fresh messages (all new)`,
    msOnce(() => ({ query: `q${q++}`, results: Array.from({ length: MSGS }, (_, i) => ({ id: i, message: msg(i) })) }), (next) => setState('search', next), { runs: 25, warm: 10 }),
    'ms', `(${MSGS * 9} new objects) |`,
  );
}
{
  // control: cold createStore over a tt-sized slice (the whole tree is adopted once)
  const N = 20000;
  report(
    `createStore with ${N} messages (cold adopt)`,
    msOnce(() => ({ messages: { byId: dict(N, msg) } }), (initial) => createStore(initial), { runs: 15, warm: 3 }),
    'ms', `(${N * 8} objects, ${N * 6} containers) |`,
  );
}
process.stdout.write('\n| the same writes on a big live tree (50k messages = 300k owned containers; the ownership table is large) | cost | notes |\n|---|---|---|\n');
{
  const BIG = 50000;
  const [state, setState] = createStore({ messages: { byId: dict(BIG, msg) }, chats: { byId: dict(CHATS, chat) }, search: { query: '', results: [] as { id: number; message: Msg }[] } });
  const byId = unwrap(state.messages.byId);
  let q = 0;
  report(
    `write a fresh ${MSGS}-item result set referencing existing messages`,
    msOnce(() => ({ query: `q${q++}`, results: Array.from({ length: MSGS }, (_, i) => ({ id: i, message: byId[i] })) }), (next) => setState('search', next), { runs: 15, warm: 5 }),
    'ms', `(${MSGS} new containers marked) |`,
  );
  let k = CHATS;
  report(
    `replace a ${CHATS}-key dict, 1 new child, the rest reused store objects`,
    msOnce(() => ({ ...unwrap(state.chats.byId), [k]: chat(k++) }), (next) => setState('chats', 'byId', next), { runs: 15, warm: 5 }),
    'ms', '|',
  );
  let m = BIG;
  report(
    'write 200 fresh messages into the dictionary (steady-state marking cost)',
    msOnce(() => { const d: Record<string, Msg> = {}; for (let i = 0; i < 200; i++) d[m] = msg(m++); return d; }, (next) => setState('messages', 'byId', { ...byId, ...next }), { runs: 15, warm: 5 }),
    'ms', '(200 × 8 new objects; the dictionary copy itself is 50k keys) |',
  );
}
clearRaf();
