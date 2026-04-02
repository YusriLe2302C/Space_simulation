const mongoose = require("mongoose");

async function connectDb(mongoUri, logger) {
  mongoose.set("strictQuery", true);

  mongoose.connection.on("connected", () =>
    logger.info("mongo_connected", { mongoUriRedacted: redactMongoUri(mongoUri) }),
  );
  mongoose.connection.on("disconnected", () => logger.warn("mongo_disconnected"));
  mongoose.connection.on("error", (err) =>
    logger.error("mongo_error", { message: err.message }),
  );

  await mongoose.connect(mongoUri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 10000,
  });
}

function redactMongoUri(uri) {
  try {
    const hasAuth = uri.includes("@");
    if (!hasAuth) return uri;
    const [schemeAndAuth, rest] = uri.split("@");
    const scheme = schemeAndAuth.split("://")[0];
    return `${scheme}://***:***@${rest}`;
  } catch {
    return "<redacted>";
  }
}

module.exports = { connectDb };

