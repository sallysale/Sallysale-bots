// bots/shared/logger.mjs
// Logger פשוט — כותב לconsole + מחזיר מערך errors לbots_log

export function createLogger(botId) {
  const errors = [];
  const startTime = Date.now();

  const log  = (msg)  => console.log(`[${botId}] ${new Date().toISOString()} ℹ️  ${msg}`);
  const ok   = (msg)  => console.log(`[${botId}] ${new Date().toISOString()} ✅ ${msg}`);
  const warn = (msg)  => console.warn(`[${botId}] ${new Date().toISOString()} ⚠️  ${msg}`);
  const err  = (msg)  => { console.error(`[${botId}] ${new Date().toISOString()} ❌ ${msg}`); errors.push(msg); };
  const elapsed = ()  => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  return { log, ok, warn, err, errors, elapsed };
}
