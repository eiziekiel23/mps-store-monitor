/**
 * Creates a structured JSONL logger correlated with the current run and trace.
 */
export function createLogger({ traceId, runId, region = 'gha-us' } = {}) {
  const entries = [];

  function log(level, msg, fields = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toLowerCase(),
      message: msg,
      trace_id: traceId,
      run_id: runId,
      region,
      ...fields
    };
    entries.push(entry);
    return entry;
  }

  return {
    log,
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    entries: () => [...entries],
    toJsonl: () => entries.map(e => JSON.stringify(e)).join('\n')
  };
}
