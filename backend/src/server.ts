import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
const server = createApp().listen(config.PORT, "127.0.0.1", () =>
  logger.info({ port: config.PORT }, "AfterBuy API listening"),
);
const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
