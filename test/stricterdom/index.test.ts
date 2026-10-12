import * as strict from '../../src/stricterdom/index';

it('exports the frameact/stricterdom surface', () => {
  for (const name of [
    'enableStrict', 'disableStrict', 'isStrictEnabled', 'forceMeasure', 'forceMutation', 'suppressStrict', 'setHandler',
    'enableRunLog', 'disableRunLog', 'getRunStats', 'resetRunStats',
  ]) {
    expect(typeof (strict as Record<string, unknown>)[name], name).toBe('function');
  }
  expect(strict.IGNORE_SUBTREE_ATTR).toBe('data-stricterdom-ignore');
  expect(strict.SLOW_RUN_MS).toBe(7);
  expect(new strict.StrictViolationError('measure', 'offsetHeight', 'mutate', null, null).message).toBe(
    '[frameact/stricterdom] Unexpected measurement `offsetHeight` outside an effect [mutate]',
  );
  expect(strict.LAYOUT_CAUSES.HTMLInputElement.props).toEqual(['selectionStart', 'selectionEnd']);
});

it('every escape is a plain call while strict is off', () => {
  const el = document.createElement('div');
  expect(strict.isStrictEnabled()).toBe(false);
  expect(strict.forceMutation(() => 1, el)).toBe(1);
  expect(strict.suppressStrict(() => 2)).toBe(2);
  expect(strict.getRunStats()).toEqual([]);
  expect(strict.forceMeasure(() => 3)).toBe(3);
});
