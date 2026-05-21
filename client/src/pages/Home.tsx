import { useRealtime, ConnectionStatus, TranscriptEntry } from "@/hooks/useRealtime";
import { Mic, MicOff, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef } from "react";

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const statusConfig: Record<ConnectionStatus, { label: string; color: string; icon: React.ReactNode }> = {
    disconnected: {
      label: "Getrennt",
      color: "bg-red-500/20 text-red-400 border-red-500/30",
      icon: <WifiOff className="w-3.5 h-3.5" />,
    },
    connecting: {
      label: "Verbinde...",
      color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      icon: <Wifi className="w-3.5 h-3.5 animate-pulse" />,
    },
    connected: {
      label: "Verbunden",
      color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      icon: <Wifi className="w-3.5 h-3.5" />,
    },
    speaking: {
      label: "Henry spricht",
      color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      icon: <Wifi className="w-3.5 h-3.5" />,
    },
    listening: {
      label: "H\u00f6rt zu...",
      color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      icon: <Mic className="w-3.5 h-3.5" />,
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium tracking-wide ${config.color}`}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
}

function TranscriptMessage({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-primary/20 text-foreground rounded-br-md"
            : "bg-secondary text-secondary-foreground rounded-bl-md"
        }`}
      >
        {!isUser && (
          <span className="text-xs font-semibold text-primary block mb-1">Henry</span>
        )}
        <p>{entry.text}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { status, transcript, toggleConnection } = useRealtime();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const isActive = status !== "disconnected" && status !== "connecting";

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  return (
    <div className="min-h-screen flex flex-col items-center bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="w-full flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <span className="text-primary font-bold text-sm">H</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Henry</h1>
        </div>
        <StatusIndicator status={status} />
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-2xl flex flex-col items-center justify-center px-4 py-8">
        {/* Mic Button Area */}
        <div className="relative flex items-center justify-center mb-8">
          {/* Pulse rings when active */}
          {isActive && (
            <>
              <div className="absolute w-32 h-32 rounded-full border border-primary/20 animate-pulse-ring" />
              <div
                className="absolute w-32 h-32 rounded-full border border-primary/10 animate-pulse-ring"
                style={{ animationDelay: "0.5s" }}
              />
            </>
          )}

          {/* Status ring */}
          {status === "listening" && (
            <div className="absolute w-28 h-28 rounded-full border-2 border-purple-400/50 animate-pulse" />
          )}
          {status === "speaking" && (
            <div className="absolute w-28 h-28 rounded-full border-2 border-blue-400/50 animate-pulse" />
          )}

          {/* Main button */}
          <button
            onClick={toggleConnection}
            className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 ease-out active:scale-95 ${
              isActive
                ? "bg-primary shadow-lg shadow-primary/25 hover:bg-primary/90"
                : "bg-secondary hover:bg-secondary/80 border border-border"
            }`}
            aria-label={isActive ? "Verbindung trennen" : "Verbinden"}
          >
            {isActive ? (
              <Mic className="w-8 h-8 text-primary-foreground" />
            ) : (
              <MicOff className="w-8 h-8 text-muted-foreground" />
            )}
          </button>
        </div>

        {/* Instruction text */}
        <p className="text-muted-foreground text-sm mb-8 text-center">
          {status === "disconnected" && "Tippe auf das Mikrofon, um Henry zu aktivieren"}
          {status === "connecting" && "Verbindung wird hergestellt..."}
          {status === "connected" && "Sprich einfach los \u2013 Henry h\u00f6rt zu"}
          {status === "speaking" && "Henry antwortet..."}
          {status === "listening" && "Henry h\u00f6rt dir zu..."}
        </p>

        {/* Transcript */}
        {transcript.length > 0 && (
          <div className="w-full flex-1 max-h-[40vh] overflow-y-auto rounded-xl bg-card/50 border border-border p-4 backdrop-blur-sm">
            <div className="space-y-1">
              {transcript.map((entry) => (
                <TranscriptMessage key={entry.id} entry={entry} />
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full py-4 text-center">
        <p className="text-xs text-muted-foreground/50">
          Henry Voice Assistant &middot; TD Production
        </p>
      </footer>
    </div>
  );
}
