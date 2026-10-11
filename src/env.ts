// Build-time dev flag. Bundlers textually replace `process.env.NODE_ENV` (keep it literal and
// unguarded so the replacement — and dead-code elimination of `if (DEV)` — works); vitest sets 'test'.
export const DEV: boolean = process.env.NODE_ENV !== 'production';
