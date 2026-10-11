import { createEffect } from '../../src/core/effects';
import { computed, signal } from '../../src/core/signals';
import { getScope, onDispose, onError, root, scoped } from '../../src/core/core';
import { flushMicrotasks } from '../helpers/micro';

const NO_OWNER = 'inside an effect apply has no owner';

function mockConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

function loggedText(spy: ReturnType<typeof mockConsoleError>) {
  return spy.mock.calls
    .flat()
    .map((a) => (a instanceof Error ? a.message : String(a)))
    .join('\n');
}

afterEach(() => vi.restoreAllMocks());

// Finding 1
it('a bailed child is re-scheduled even when its parent run throws', async () => {
  const err = mockConsoleError();
  const $a = signal(1);
  const $boom = signal(false);
  const $src = computed(() => {
    if ($boom()) throw new Error('src');
    return 1;
  });
  const childApply = vi.fn();
  root(() => {
    createEffect(
      () => {
        createEffect(() => $a(), childApply);
        return $src();
      },
      () => {},
    );
  });
  await flushMicrotasks();
  $a.set(2); // child scheduled first …
  $boom.set(true); // … parent goes CHECK: the child bails onto it, then the parent's run throws
  await flushMicrotasks();
  expect(err).toHaveBeenCalled();
  expect(childApply).toHaveBeenLastCalledWith(2, 1);
});

// Finding 2
it('ancestor rule: a dirty effect further up wins over pulling a dirty memo in between', async () => {
  const err = mockConsoleError();
  const $user = signal<{ name: string } | null>({ name: 'a' });
  const memoRanWithNull = vi.fn();
  root(() => {
    createEffect(
      () => {
        if (!$user()) return null;
        const $name = computed(() => {
          createEffect(() => $user(), () => {}); // subscribes to $user before the memo and the parent
          const user = $user();
          if (!user) memoRanWithNull();
          return user!.name;
        });
        return $name();
      },
      () => {},
    );
  });
  await flushMicrotasks();
  $user.set(null);
  await flushMicrotasks();
  expect(memoRanWithNull).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
});

// Finding 3
it('a failed first compute (handled by onError) never applies; the next change retries', async () => {
  const $ok = signal(false);
  const apply = vi.fn();
  const handler = vi.fn();
  root(() => {
    onError(handler);
    createEffect(() => {
      if (!$ok()) throw new Error('not yet');
      return $ok();
    }, apply);
  });
  await flushMicrotasks();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  $ok.set(true);
  await flushMicrotasks();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith(true, undefined);
});

// Finding 4
it('_applied does not advance when apply throws: the same value is applied again, prev stays undefined', async () => {
  const err = mockConsoleError();
  const $unrelated = signal(0);
  let calls = 0;
  const apply = vi.fn(() => {
    if (++calls === 1) throw new Error('first apply fails');
  });
  root(() =>
    createEffect(() => {
      $unrelated();
      return 'x';
    }, apply),
  );
  await flushMicrotasks();
  expect(err).toHaveBeenCalled();
  expect(apply).toHaveBeenCalledTimes(1);
  $unrelated.set(1); // recompute yields the same 'x'
  await flushMicrotasks();
  expect(apply).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenLastCalledWith('x', undefined);
  $unrelated.set(2); // now applied: no third apply
  await flushMicrotasks();
  expect(apply).toHaveBeenCalledTimes(2);
});

// Finding 5
describe('apply runs without an owner', () => {
  it('(a) onCleanup inside apply is a DEV error, routed like any apply error', async () => {
    const err = mockConsoleError();
    const seenScope = vi.fn();
    root(() =>
      createEffect(
        () => 1,
        () => {
          seenScope(getScope());
          onDispose(() => {});
        },
      ),
    );
    await flushMicrotasks();
    expect(seenScope).toHaveBeenCalledWith(null);
    expect(loggedText(err)).toContain(NO_OWNER);
  });

  it('(a) creating an effect or a computed with no owner inside apply is a DEV error; a plain signal is fine', async () => {
    const err = mockConsoleError();
    root(() => {
      createEffect(() => 1, () => createEffect(() => 1, () => {}));
      createEffect(() => 2, () => computed(() => 1));
      createEffect(() => 3, () => void signal(0));
    });
    await flushMicrotasks();
    const noOwnerErrors = err.mock.calls.filter((c) => c.some((a) => a instanceof Error && a.message.includes(NO_OWNER)));
    expect(noOwnerErrors).toHaveLength(2);
  });

  it('(b) the returned cleanup runs before the next apply and on dispose', async () => {
    const $a = signal(0);
    const log: string[] = [];
    const dispose = root((d) => {
      createEffect(
        () => $a(),
        (v) => {
          log.push('apply:' + v);
          return () => log.push('cleanup:' + v);
        },
      );
      return d;
    });
    await flushMicrotasks();
    $a.set(1);
    await flushMicrotasks();
    dispose();
    expect(log).toEqual(['apply:0', 'cleanup:0', 'apply:1', 'cleanup:1']);
  });

  it('(c) deliberate ownership via scoped()/runWithOwner inside apply is allowed', async () => {
    const err = mockConsoleError();
    const innerApply = vi.fn();
    const innerCleanup = vi.fn();
    const dispose = root((d) => {
      const owner = getScope();
      createEffect(
        () => 1,
        () => {
          scoped(() => {
            onDispose(innerCleanup);
            createEffect(() => 'inner', innerApply);
          }, owner);
        },
      );
      return d;
    });
    await flushMicrotasks();
    expect(err).not.toHaveBeenCalled();
    expect(innerApply).toHaveBeenCalledWith('inner', undefined);
    dispose();
    expect(innerCleanup).toHaveBeenCalledTimes(1);
  });
});

// Finding 6
it('DEV: an effect whose apply re-dirties it forever is stopped with an error', async () => {
  const err = mockConsoleError();
  const $n = signal(0);
  root(() => createEffect(() => $n(), (v) => void $n.set(v + 1)));
  await flushMicrotasks(300);
  expect(loggedText(err)).toContain('infinite');
});

// Finding 8
it('DEV: a throwing first compute of an effect does not print the computed "initial option" hint', async () => {
  const err = mockConsoleError();
  root(() =>
    createEffect(() => {
      throw new Error('boom');
    }, () => {}),
  );
  await flushMicrotasks();
  expect(loggedText(err)).not.toContain('initial');
  expect(loggedText(err)).toContain('boom');
});
