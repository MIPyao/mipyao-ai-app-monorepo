"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Circle, Square } from "lucide-react";

interface VoiceInputProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  disabled?: boolean;
}

type RecordingStatus = "idle" | "recording" | "denied";

class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private recordedData: Float32Array[] = [];
  private sampleRate = 16000;

  async start(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const audioTrack = this.mediaStream.getAudioTracks()[0];
    const settings = audioTrack.getSettings();
    this.sampleRate = (settings.sampleRate as number) || 48000;

    this.audioContext = new AudioContext();
    if (this.audioContext.sampleRate !== this.sampleRate) {
      await this.audioContext.close();
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.recordedData = [];

    this.processorNode.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this.recordedData.push(new Float32Array(inputData));
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  stop(): Blob {
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.processorNode) this.processorNode.disconnect();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) this.audioContext.close();

    const totalLength = this.recordedData.reduce((sum, arr) => sum + arr.length, 0);
    const mergedData = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.recordedData) {
      mergedData.set(chunk, offset);
      offset += chunk.length;
    }

    return new Blob([this.encodeWAV(mergedData, this.sampleRate)], { type: "audio/wav" });
  }

  private encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const bitDepth = 16;
    const numChannels = 1;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = samples.length * bytesPerSample;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    this.writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, "WAVE");
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let dataOffset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(dataOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      dataOffset += 2;
    }

    return arrayBuffer;
  }

  private writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}

export function VoiceInput({
  onRecordingComplete,
  disabled = false,
}: VoiceInputProps) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setDuration(0);
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      try { recorderRef.current?.stop(); } catch {}
    };
  }, [cleanup]);

  const stopRecording = useCallback(() => {
    try {
      const wavBlob = recorderRef.current?.stop();
      if (wavBlob) onRecordingComplete(wavBlob);
    } catch (error) {
      console.error("停止录音失败:", error);
    }
    recorderRef.current = null;
    cleanup();
    setStatus("idle");
  }, [onRecordingComplete, cleanup]);

  useEffect(() => {
    if (status === "recording" && duration >= 60) {
      stopRecording();
    }
  }, [duration, status, stopRecording]);

  const startRecording = async () => {
    try {
      const recorder = new AudioRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setStatus("recording");
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("请求麦克风权限失败:", error);
      setStatus("denied");
    }
  };

  const handleToggleRecording = () => {
    if (disabled) return;
    if (status === "recording") {
      stopRecording();
    } else if (status === "denied") {
      setStatus("idle");
      startRecording();
    } else {
      startRecording();
    }
  };

  const renderButtonContent = () => {
    if (status === "recording") {
      return (
        <div className="flex flex-col items-center justify-center">
          <Square className="w-4 h-4 fill-current" />
          <span className="text-[10px] font-medium leading-none mt-0.5">停止</span>
        </div>
      );
    }
    if (status === "denied") {
      return <MicOff className="w-5 h-5" />;
    }
    return <Mic className="w-5 h-5" />;
  };

  
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleToggleRecording}
        disabled={disabled}
        className={`p-3 rounded-lg flex items-center justify-center transition-all duration-200 ${
          disabled
            ? "bg-bg text-text-muted cursor-not-allowed"
            : status === "recording"
              ? "bg-error-light text-error hover:bg-error-light/80 border border-error/20"
              : status === "denied"
                ? "bg-error-light text-error/70 hover:bg-error-light/80 border border-error/20"
                : "bg-primary-50 text-primary-600 hover:bg-primary-100"
        }`}
        title={
          status === "recording"
            ? "点击停止录音"
            : status === "denied"
              ? "麦克风权限被拒绝，点击重新请求"
              : "点击开始录音"
        }
      >
        {renderButtonContent()}
      </button>

      </div>
  );
}
