// Imported first: silences the logs before any logger reads LOG_LEVEL, unless
// the run asks for them (LOG_LEVEL=debug npm test).
process.env.LOG_LEVEL ??= 'silent';
