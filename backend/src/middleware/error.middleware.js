function errorMiddleware(logger) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    const message = status >= 500 ? "Internal Server Error" : err.message;

    logger.error("request_error", {
      status,
      message: err.message,
      path: req.path,
      method: req.method,
    });

    res.status(status).json({ error: message });
  };
}

module.exports = { errorMiddleware };

