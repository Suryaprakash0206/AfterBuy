import { Queue } from "bullmq";
import { config } from "../config.js";
export function redisConnection() {
  const u = new URL(config.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number(u.pathname.slice(1) || 0),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
export function createQueues() {
  const options = {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  };
  return {
    documents: new Queue("afterbuy-documents", options),
    reminders: new Queue("afterbuy-reminders", options),
  };
}
