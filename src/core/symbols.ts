// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import { DEV } from '../env';
export const SCOPE = Symbol(DEV ? 'SCOPE' : 0);

/**
 * Store (spec §3.5): reading this key on a store array proxy subscribes to the array's shape with ONE
 * link and returns a plain array of its items (wrapped). `mapArray` reads it so a list over a store
 * array never subscribes per index. `Symbol.for`: the store module defines `$TRACK` as this symbol.
 */
export const TRACK: unique symbol = Symbol.for('frameact.track') as any;
