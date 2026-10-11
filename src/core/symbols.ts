// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import { DEV } from '../env';
export const SCOPE = Symbol(DEV ? 'SCOPE' : 0);
