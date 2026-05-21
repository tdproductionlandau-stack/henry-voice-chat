import { describe, expect, it } from "vitest";

/**
 * Tests for the Realtime Relay configuration and function call handling.
 */

describe("Realtime Relay", () => {
  it("OPENAI_API_KEY environment variable is set", () => {
    const key = process.env.OPENAI_API_KEY;
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThan(0);
  });

  it("exports registerRealtimeRelay function", async () => {
    const mod = await import("./realtimeRelay");
    expect(mod.registerRealtimeRelay).toBeDefined();
    expect(typeof mod.registerRealtimeRelay).toBe("function");
  });

  it("OPENAI_API_KEY starts with sk-", () => {
    const key = process.env.OPENAI_API_KEY;
    expect(key).toBeDefined();
    expect(key!.startsWith("sk-")).toBe(true);
  });
});

describe("Realtime Relay - Session Configuration", () => {
  it("contains correct system prompt with Henry persona", async () => {
    // We read the source to verify the configuration is correct
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(__dirname, "./realtimeRelay.ts"),
      "utf-8"
    );

    expect(content).toContain("Du bist Henry");
    expect(content).toContain("Boss");
    expect(content).toContain("Jarvis");
    expect(content).toContain("TD Production");
  });

  it("configures correct voice and audio settings", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(__dirname, "./realtimeRelay.ts"),
      "utf-8"
    );

    expect(content).toContain('"coral"');
    expect(content).toContain('"pcm16"');
    expect(content).toContain('"server_vad"');
    expect(content).toContain('"text", "audio"');
  });

  it("registers all four function calling tools", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(__dirname, "./realtimeRelay.ts"),
      "utf-8"
    );

    expect(content).toContain('"send_whatsapp"');
    expect(content).toContain('"send_email"');
    expect(content).toContain('"check_calendar"');
    expect(content).toContain('"web_search"');
  });

  it("connects to correct OpenAI Realtime API URL", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(__dirname, "./realtimeRelay.ts"),
      "utf-8"
    );

    expect(content).toContain("wss://api.openai.com/v1/realtime?model=gpt-realtime-2");
    expect(content).toContain("OpenAI-Beta");
    expect(content).toContain("realtime=v1");
  });

  it("relay path is /api/realtime", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(__dirname, "./realtimeRelay.ts"),
      "utf-8"
    );

    expect(content).toContain("/api/realtime");
  });
});
