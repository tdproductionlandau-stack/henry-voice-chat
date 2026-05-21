import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { registerRealtimeRelay } from "./realtimeRelay";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Serve static files from the 'dist/public' directory
  const distPath = path.resolve(import.meta.dirname, "..", "dist", "public");
  app.use(express.static(distPath));

  // Fallback to index.html for SPA routing
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  // Register WebSocket relay for OpenAI Realtime API
  registerRealtimeRelay(server);

  const port = parseInt(process.env.PORT || "3000");

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
