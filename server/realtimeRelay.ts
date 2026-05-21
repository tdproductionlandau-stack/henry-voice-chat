import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime-2";

const HENRY_SYSTEM_PROMPT = `Du bist Henry, der persönliche KI-Assistent von Tim Dittmann (TD Production). Du sprichst Deutsch, bist locker, direkt und effizient. Du hast einen Jarvis-ähnlichen Stil – professionell aber mit Humor. Du nennst Tim 'Boss'. Du kannst Aufgaben ausführen wie E-Mails senden, WhatsApp-Nachrichten schicken, Kalender checken, Recherchen machen. Antworte kurz und knapp, maximal 2-3 Sätze. Sei wie ein echter Assistent der mitdenkt.`;

const TOOLS = [
  {
    type: "function" as const,
    name: "send_whatsapp",
    description: "Sendet eine WhatsApp-Nachricht an einen Kontakt",
    parameters: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "Name oder Nummer des Empfängers" },
        message: { type: "string", description: "Die zu sendende Nachricht" },
      },
      required: ["recipient", "message"],
    },
  },
  {
    type: "function" as const,
    name: "send_email",
    description: "Sendet eine E-Mail",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "E-Mail-Adresse des Empfängers" },
        subject: { type: "string", description: "Betreff der E-Mail" },
        body: { type: "string", description: "Inhalt der E-Mail" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    type: "function" as const,
    name: "check_calendar",
    description: "Prüft den Kalender für ein bestimmtes Datum",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Datum im Format YYYY-MM-DD" },
      },
      required: ["date"],
    },
  },
  {
    type: "function" as const,
    name: "web_search",
    description: "Sucht im Internet nach Informationen",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchanfrage" },
      },
      required: ["query"],
    },
  },
];

/**
 * Handle function calls from OpenAI - placeholder implementations
 */
function handleFunctionCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "send_whatsapp":
      return JSON.stringify({
        success: true,
        message: `WhatsApp-Nachricht an ${args.recipient} gesendet: "${args.message}"`,
      });
    case "send_email":
      return JSON.stringify({
        success: true,
        message: `E-Mail an ${args.to} gesendet. Betreff: "${args.subject}"`,
      });
    case "check_calendar":
      return JSON.stringify({
        success: true,
        events: [
          { time: "10:00", title: "Team Meeting" },
          { time: "14:00", title: "Kundengespräch" },
        ],
        message: `Kalender für ${args.date} abgerufen.`,
      });
    case "web_search":
      return JSON.stringify({
        success: true,
        results: `Suchergebnisse für "${args.query}" - Feature noch in Entwicklung.`,
      });
    default:
      return JSON.stringify({ success: false, error: "Unbekannte Funktion" });
  }
}

export function registerRealtimeRelay(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);

    if (url.pathname === "/api/realtime") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (clientWs: WebSocket) => {
    console.log("[Realtime Relay] Client connected");

    if (!OPENAI_API_KEY) {
      console.error("[Realtime Relay] No OPENAI_API_KEY configured");
      clientWs.close(1008, "Server misconfigured: missing API key");
      return;
    }

    // Connect to OpenAI Realtime API
    const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    let sessionConfigured = false;

    openaiWs.on("open", () => {
      console.log("[Realtime Relay] Connected to OpenAI");

      // Configure session once connected
      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: HENRY_SYSTEM_PROMPT,
          voice: "coral",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: {
            model: "whisper-1",
            language: "de",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          tools: TOOLS,
        },
      };

      openaiWs.send(JSON.stringify(sessionConfig));
      sessionConfigured = true;
    });

    // Relay messages from OpenAI to client
    openaiWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        const message = data.toString();

        // Handle function calls server-side
        try {
          const parsed = JSON.parse(message);

          if (parsed.type === "response.function_call_arguments.done") {
            // Execute the function and send result back to OpenAI
            const result = handleFunctionCall(parsed.name, JSON.parse(parsed.arguments));

            const functionOutput = {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: parsed.call_id,
                output: result,
              },
            };

            openaiWs.send(JSON.stringify(functionOutput));
            // Trigger a new response after function output
            openaiWs.send(JSON.stringify({ type: "response.create" }));
          }
        } catch {
          // Not JSON or parse error, just relay
        }

        // Always relay to client for transcript/audio
        clientWs.send(message);
      }
    });

    openaiWs.on("error", (error) => {
      console.error("[Realtime Relay] OpenAI WebSocket error:", error.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", error: { message: "OpenAI connection error" } }));
      }
    });

    openaiWs.on("close", (code, reason) => {
      console.log(`[Realtime Relay] OpenAI disconnected: ${code} ${reason.toString()}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000, "OpenAI session ended");
      }
    });

    // Relay messages from client to OpenAI
    clientWs.on("message", (data) => {
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(data.toString());
      }
    });

    clientWs.on("close", () => {
      console.log("[Realtime Relay] Client disconnected");
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    });

    clientWs.on("error", (error) => {
      console.error("[Realtime Relay] Client WebSocket error:", error.message);
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    });
  });

  console.log("[Realtime Relay] WebSocket relay registered on /api/realtime");
}
