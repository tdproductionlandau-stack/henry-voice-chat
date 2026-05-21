import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "speaking" | "listening";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

/**
 * Resample audio from source sample rate to target sample rate using linear interpolation.
 */
function resampleAudio(inputBuffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
  if (inputSampleRate === outputSampleRate) return inputBuffer;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputBuffer.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputBuffer.length - 1);
    const frac = srcIndex - srcIndexFloor;
    output[i] = inputBuffer[srcIndexFloor] * (1 - frac) + inputBuffer[srcIndexCeil] * frac;
  }
  return output;
}

export function useRealtime() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentAssistantTextRef = useRef("");
  const currentAssistantIdRef = useRef("");

  // Convert Float32Array to PCM16 base64
  const float32ToPcm16Base64 = useCallback((float32Array: Float32Array): string => {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  // Convert PCM16 base64 to Float32Array
  const pcm16Base64ToFloat32 = useCallback((base64: string): Float32Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
    }
    return float32;
  }, []);

  // Stop current playback
  const stopPlayback = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // Already stopped
      }
      currentSourceRef.current = null;
    }
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // Play audio from queue
  const playAudioQueue = useCallback(() => {
    if (isPlayingRef.current || playbackQueueRef.current.length === 0) return;

    const playbackContext = playbackContextRef.current;
    if (!playbackContext || playbackContext.state === "closed") return;

    isPlayingRef.current = true;
    setStatus("speaking");

    const playNext = () => {
      if (playbackQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        currentSourceRef.current = null;
        // Only set connected if we're still in a session
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          setStatus("connected");
        }
        return;
      }

      const chunk = playbackQueueRef.current.shift()!;
      const buffer = playbackContext.createBuffer(1, chunk.length, 24000);
      buffer.getChannelData(0).set(chunk);

      const source = playbackContext.createBufferSource();
      source.buffer = buffer;
      source.connect(playbackContext.destination);
      currentSourceRef.current = source;
      source.onended = playNext;
      source.start();
    };

    playNext();
  }, []);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "session.created":
          case "session.updated":
            setStatus("connected");
            break;

          case "input_audio_buffer.speech_started":
            setStatus("listening");
            // Stop any current playback when user starts speaking (barge-in)
            stopPlayback();
            break;

          case "input_audio_buffer.speech_stopped":
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              setStatus("connected");
            }
            break;

          case "conversation.item.input_audio_transcription.completed":
            if (data.transcript) {
              setTranscript((prev) => [
                ...prev,
                {
                  id: `user-${Date.now()}`,
                  role: "user",
                  text: data.transcript.trim(),
                  timestamp: Date.now(),
                },
              ]);
            }
            break;

          case "response.audio_transcript.delta":
            if (data.delta) {
              currentAssistantTextRef.current += data.delta;
              const id = currentAssistantIdRef.current || `assistant-${Date.now()}`;
              currentAssistantIdRef.current = id;

              setTranscript((prev) => {
                const existing = prev.find((t) => t.id === id);
                if (existing) {
                  return prev.map((t) =>
                    t.id === id ? { ...t, text: currentAssistantTextRef.current } : t
                  );
                }
                return [
                  ...prev,
                  {
                    id,
                    role: "assistant",
                    text: currentAssistantTextRef.current,
                    timestamp: Date.now(),
                  },
                ];
              });
            }
            break;

          case "response.audio_transcript.done":
            currentAssistantTextRef.current = "";
            currentAssistantIdRef.current = "";
            break;

          case "response.audio.delta":
            if (data.delta) {
              const audioData = pcm16Base64ToFloat32(data.delta);
              playbackQueueRef.current.push(audioData);
              playAudioQueue();
            }
            break;

          case "response.audio.done":
            // Audio response complete
            break;

          case "error":
            console.error("[Realtime] Error:", data.error);
            break;
        }
      } catch {
        // Non-JSON message, ignore
      }
    },
    [pcm16Base64ToFloat32, playAudioQueue, stopPlayback]
  );

  // Start capturing audio from microphone
  const startAudioCapture = useCallback(() => {
    const audioContext = audioContextRef.current;
    const stream = mediaStreamRef.current;
    if (!audioContext || !stream) return;

    const source = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    // Use ScriptProcessorNode for PCM access
    // Buffer size 4096 at native sample rate, then resample to 24kHz
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    workletNodeRef.current = processor;

    const nativeSampleRate = audioContext.sampleRate;

    processor.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      // Resample from native rate to 24kHz for OpenAI
      const resampled = resampleAudio(inputData, nativeSampleRate, 24000);
      const base64Audio = float32ToPcm16Base64(resampled);

      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        })
      );
    };

    // Connect source -> processor -> null destination (NOT speakers to avoid echo)
    // We need to connect processor to something for it to process, so we use a gain node set to 0
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(audioContext.destination);

    source.connect(processor);
    processor.connect(silentGain);

    setIsRecording(true);
  }, [float32ToPcm16Base64]);

  // Stop audio capture
  const stopAudioCapture = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Connect to the relay server
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");

    // Initialize separate audio contexts for capture and playback
    // Capture context uses native sample rate (we resample in software)
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    // Playback context at 24kHz to match OpenAI output
    const playbackContext = new AudioContext({ sampleRate: 24000 });
    playbackContextRef.current = playbackContext;

    // Get microphone access
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
    } catch (err) {
      console.error("[Realtime] Microphone access denied:", err);
      setStatus("disconnected");
      return;
    }

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/realtime`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[Realtime] Connected to relay");
      setStatus("connected");
      startAudioCapture();
    };

    ws.onmessage = handleMessage;

    ws.onerror = (err) => {
      console.error("[Realtime] WebSocket error:", err);
    };

    ws.onclose = () => {
      console.log("[Realtime] Disconnected");
      setStatus("disconnected");
      setIsRecording(false);
      stopAudioCapture();
    };
  }, [handleMessage, startAudioCapture, stopAudioCapture]);

  // Disconnect from relay
  const disconnect = useCallback(() => {
    stopPlayback();
    stopAudioCapture();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (playbackContextRef.current && playbackContextRef.current.state !== "closed") {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    setStatus("disconnected");
    setIsRecording(false);
  }, [stopAudioCapture, stopPlayback]);

  // Toggle connection
  const toggleConnection = useCallback(() => {
    if (status === "disconnected") {
      connect();
    } else {
      disconnect();
    }
  }, [status, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    transcript,
    isRecording,
    toggleConnection,
    connect,
    disconnect,
  };
}
