import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Express } from "express";
import { Server } from "socket.io";
import type { Server as SocketServer } from "socket.io";
import { RoomManager } from "./rooms.js";
import { registerSocketHandlers } from "./socket.js";

export interface CreateApplicationOptions {
  staticDir?: string | null;
  random?: () => number;
}

export interface ApplicationContext {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer;
  manager: RoomManager;
}

export function createApplication(
  options: CreateApplicationOptions = {}
): ApplicationContext {
  const app: Express = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, memoryOnly: true });
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true
    },
    maxHttpBufferSize: 64 * 1024
  });
  const manager = new RoomManager(options.random);
  registerSocketHandlers(io, manager);

  const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
  for (const document of ["RULES.md", "OPEN_QUESTIONS.md"]) {
    const documentPath = `${projectRoot}${document}`;
    if (existsSync(documentPath)) {
      app.get(`/${document}`, (_request, response) => {
        response.sendFile(documentPath);
      });
    }
  }

  const defaultStaticDir = fileURLToPath(
    new URL("../../web/dist", import.meta.url)
  );
  const staticDir = options.staticDir ?? defaultStaticDir;
  const indexPath = staticDir ? `${staticDir}/index.html` : "";

  if (staticDir && existsSync(indexPath)) {
    app.use(express.static(staticDir, { maxAge: "1h", index: false }));
    app.get("*", (_request, response) => {
      response.sendFile(indexPath);
    });
  }

  return { app, httpServer, io, manager };
}
