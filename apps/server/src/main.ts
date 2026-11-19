import { createApplication } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const { httpServer } = createApplication();

httpServer.listen(port, host, () => {
  console.log(`串红A server listening on http://${host}:${port}`);
  console.log("Room state is memory-only and will be lost on restart.");
});
