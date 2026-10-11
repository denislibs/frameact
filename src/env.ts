// Build-time dev flag. Bundlers replace process.env.NODE_ENV; vitest sets it to 'test'.
export const DEV: boolean =
  typeof process !== 'undefined' ? process.env.NODE_ENV !== 'production' : true;
