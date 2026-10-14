import * as store from 'frameact/store';

it('frameact/store exports the public surface and nothing internal', () => {
  for (const name of [
    'createStore', 'merge', 'produce', 'reconcile', 'unwrap', 'snapshot', 'live', 'ungated', 'defineActions', 'afterActions', 'keys', 'values', 'entries',
    '$TRACK', '$RAW', '$SHAPE',
  ]) {
    expect(typeof (store as any)[name], name).not.toBe('undefined');
  }
  for (const name of ['setProperty', 'isWrappable', 'storeStats', 'ungatedDepth', 'setUngatedDepth', 'storeGate']) {
    expect((store as any)[name], name).toBeUndefined();
  }
  expect(store.$TRACK).toBe(Symbol.for('frameact.track'));
  expect(store.$SHAPE).toBe(Symbol.for('frameact.shape'));
});
