function createLogger() {
  function write(level, event, meta) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(meta ? { meta } : {}),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }

  return {
    info: (event, meta) => write("info", event, meta),
    warn: (event, meta) => write("warn", event, meta),
    error: (event, meta) => write("error", event, meta),
  };
}

module.exports = { createLogger };

