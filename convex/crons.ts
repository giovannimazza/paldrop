import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweep expired sessions and delete their files from storage every minute.
crons.interval(
  "cleanup expired sessions",
  { minutes: 1 },
  internal.sessions.cleanupExpiredSessions,
  {}
);

export default crons;
