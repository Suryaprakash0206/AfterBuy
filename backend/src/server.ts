import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import {
  startInlineScanner,
  stopInlineScanner,
} from "./modules/documents/inline.js";
const server = createApp().listen(config.PORT, "127.0.0.1");
server.on("listening", () => {
  startInlineScanner();
  logger.info({ port: config.PORT }, "AfterBuy API listening");
});
server.on("error", (error: NodeJS.ErrnoException) => {
  logger.error(
    { port: config.PORT, code: error.code, message: error.message },
    error.code === "EADDRINUSE"
      ? "AfterBuy API could not start: another process is using this port"
      : "AfterBuy API could not start",
  );
  process.exit(1);
});
const close = () =>
  server.close(() => {
    void stopInlineScanner().finally(() => process.exit(0));
  });
process.on("SIGINT", close);
process.on("SIGTERM", close);
