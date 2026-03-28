"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";

export interface StreamAudioPlayerProps {
  autoPlay?: boolean;
  minBufferChunks?: number;
}

export interface StreamAudioPlayerRef {
  addChunk: (base64Audio: string) => void;
  endStream: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
}

type PlaybackStatus = "idle" | "buffering" | "playing" | "paused" | "completed";

export const StreamAudioPlayer = forwardRef<
  StreamAudioPlayerRef,
  StreamAudioPlayerProps
>(({ autoPlay = true, minBufferChunks = 1 }, ref) => {
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [bufferedChunks, setBufferedChunks] = useState<string[]>([]);
  const [isStreamEnded, setIsStreamEnded] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const hasStartedRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pendingDecodeCountRef = useRef(0);

  // 初始化 AudioContext
  useEffect(() => {
    audioContextRef.current = new AudioContext();

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // 解码音频 chunk
  const decodeAudioChunk = useCallback(
    async (base64Data: string): Promise<AudioBuffer | null> => {
      if (!audioContextRef.current) return null;

      try {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const audioBuffer = await audioContextRef.current.decodeAudioData(
          bytes.buffer,
        );
        return audioBuffer;
      } catch (error) {
        console.error("Failed to decode audio chunk:", error);
        return null;
      }
    },
    [],
  );

  // 播放下一个音频
  const playNext = useCallback(() => {
    console.log(
      `[StreamAudioPlayer] playNext called: queue=${audioQueueRef.current.length}, playing=${isPlayingRef.current}, ended=${isStreamEnded}`,
    );

    if (!audioContextRef.current) {
      console.error("[StreamAudioPlayer] No audio context in playNext");
      return;
    }

    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      console.log(
        "[StreamAudioPlayer] Cannot play: already playing or queue empty",
      );
      return;
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current
        .resume()
        .catch((e) => console.error("[StreamAudioPlayer] Resume failed:", e));
    }

    const audioBuffer = audioQueueRef.current.shift();
    if (!audioBuffer) {
      console.error("[StreamAudioPlayer] No audio buffer in queue");
      return;
    }

    console.log(
      `[StreamAudioPlayer] Playing audio buffer, duration: ${audioBuffer.duration}s`,
    );

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);

    const estimatedDuration = (audioBuffer.duration + 1) * 1000;
    const timeoutId = setTimeout(() => {
      if (isPlayingRef.current) {
        console.warn(
          `[StreamAudioPlayer] Playback timeout after ${estimatedDuration}ms, forcing completion`,
        );
        const currentSource = currentSourceRef.current;
        if (currentSource) {
          try {
            currentSource.stop();
          } catch {}
        }
        handleEnded();
      }
    }, estimatedDuration);

    const handleEnded = () => {
      console.log("[StreamAudioPlayer] Audio playback ended");
      currentSourceRef.current = null;
      isPlayingRef.current = false;
      clearTimeout(timeoutId);

      if (audioQueueRef.current.length > 0) {
        console.log("[StreamAudioPlayer] Playing next from queue");
        playNext();
      } else if (
        isStreamEnded &&
        pendingDecodeCountRef.current >= bufferedChunks.length
      ) {
        console.log(
          "[StreamAudioPlayer] Stream completed (all chunks processed)",
        );
        setStatus("completed");
        hasStartedRef.current = false;
      } else {
        console.log("[StreamAudioPlayer] Queue empty, waiting for more chunks");
      }
    };

    source.onended = handleEnded;
    source.onerror = (e) => {
      console.error("[StreamAudioPlayer] Source error:", e);
      handleEnded();
    };

    currentSourceRef.current = source;
    isPlayingRef.current = true;
    setStatus("playing");
    try {
      source.start(0);
    } catch (e) {
      console.error("[StreamAudioPlayer] source.start failed:", e);
      clearTimeout(timeoutId);
      isPlayingRef.current = false;
      setStatus("idle");
    }
  }, [isStreamEnded, bufferedChunks.length]);

  // 处理新收到的 audio chunks
  const processPendingChunks = useCallback(async () => {
    console.log(
      `[StreamAudioPlayer] processPendingChunks: buffered=${bufferedChunks.length}, pending=${pendingDecodeCountRef.current}, queue=${audioQueueRef.current.length}, playing=${isPlayingRef.current}`,
    );

    if (!audioContextRef.current) {
      console.error("[StreamAudioPlayer] No audio context");
      return;
    }

    const toDecode = bufferedChunks.slice(pendingDecodeCountRef.current);
    if (toDecode.length === 0) {
      console.log("[StreamAudioPlayer] No new chunks to decode");
      return;
    }

    console.log(`[StreamAudioPlayer] Decoding ${toDecode.length} new chunks`);

    for (const chunk of toDecode) {
      pendingDecodeCountRef.current++;
      const audioBuffer = await decodeAudioChunk(chunk);
      if (audioBuffer) {
        console.log(
          `[StreamAudioPlayer] Decoded chunk, duration: ${audioBuffer.duration}s, length: ${audioBuffer.length}`,
        );
        audioQueueRef.current.push(audioBuffer);
      } else {
        console.error("[StreamAudioPlayer] Failed to decode chunk");
      }
    }

    console.log(
      `[StreamAudioPlayer] After decode: queue=${audioQueueRef.current.length}, playing=${isPlayingRef.current}`,
    );

    if (!isPlayingRef.current && (autoPlay || hasStartedRef.current)) {
      console.log("[StreamAudioPlayer] Starting playback");
      hasStartedRef.current = true;
      playNext();
    }
  }, [bufferedChunks, decodeAudioChunk, autoPlay, playNext]);

  useEffect(() => {
    if (bufferedChunks.length > 0) {
      processPendingChunks();
    }
  }, [bufferedChunks.length, processPendingChunks]);

  // 监听流结束
  useEffect(() => {
    if (!isStreamEnded) return;

    const checkCompletion = () => {
      if (
        audioQueueRef.current.length === 0 &&
        !isPlayingRef.current &&
        pendingDecodeCountRef.current >= bufferedChunks.length
      ) {
        console.log("[StreamAudioPlayer] Stream completed (end triggered)");
        setStatus("completed");
        hasStartedRef.current = false;
      } else {
        console.log(
          `[StreamAudioPlayer] Stream ended but not ready: queue=${audioQueueRef.current.length}, playing=${isPlayingRef.current}, pending=${pendingDecodeCountRef.current}, buffered=${bufferedChunks.length}`,
        );
      }
    };

    checkCompletion();

    const interval = setInterval(() => {
      checkCompletion();
      if (
        audioQueueRef.current.length === 0 &&
        !isPlayingRef.current &&
        pendingDecodeCountRef.current >= bufferedChunks.length
      ) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isStreamEnded, status]);

  // 添加 chunk
  const handleAddChunk = useCallback(
    (base64Audio: string) => {
      console.log(
        `[StreamAudioPlayer] addChunk: new total = ${bufferedChunks.length + 1}`,
      );
      setBufferedChunks((prev) => [...prev, base64Audio]);
    },
    [bufferedChunks.length],
  );

  // 标记流结束
  const handleEndStream = useCallback(() => {
    console.log(
      "[StreamAudioPlayer] handleEndStream called, setting isStreamEnded=true",
    );
    setIsStreamEnded(true);
  }, []);

  // 播放
  const handlePlay = useCallback(async () => {
    if (audioContextRef.current?.state === "suspended") {
      await audioContextRef.current.resume();
    }

    if (audioQueueRef.current.length > 0) {
      hasStartedRef.current = true;
      playNext();
    }
  }, [playNext]);

  // 暂停
  const handlePause = useCallback(() => {
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    isPlayingRef.current = false;
    setStatus("paused");
  }, []);

  // 停止
  const handleStop = useCallback(() => {
    console.log("[StreamAudioPlayer] stop() called");
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {}
      currentSourceRef.current = null;
    }
    isPlayingRef.current = false;

    audioQueueRef.current = [];
    pendingDecodeCountRef.current = 0;
    hasStartedRef.current = false;
    setBufferedChunks([]);
    setIsStreamEnded(false);
    setStatus("idle");

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = new AudioContext();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      addChunk: handleAddChunk,
      endStream: handleEndStream,
      play: handlePlay,
      pause: handlePause,
      stop: handleStop,
    }),
    [handleAddChunk, handleEndStream, handlePlay, handlePause, handleStop],
  );

  // 不渲染任何 UI
  return null;
});

StreamAudioPlayer.displayName = "StreamAudioPlayer";

export default StreamAudioPlayer;
