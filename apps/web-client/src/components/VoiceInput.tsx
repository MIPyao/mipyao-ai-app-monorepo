"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Circle, Square } from "lucide-react";

interface VoiceInputProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  disabled?: boolean;
}

type RecordingStatus = "idle" | "recording" | "denied";

/**
 * 使用 AudioContext 直接录制 PCM 并编码为 WAV
 * 避免 WebM 格式不被 SiliconFlow 支持的问题
 */
class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private recordedData: Float32Array[] = [];
  private sampleRate = 16000;

  async start(): Promise<void> {
    // 先获取 MediaStream，让浏览器决定采样率
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        // 不指定 sampleRate，让浏览器使用设备默认采样率
      },
    });

    // 从 MediaStreamTrack 获取实际采样率
    const audioTrack = this.mediaStream.getAudioTracks()[0];
    const settings = audioTrack.getSettings();
    // 使用 MediaStream 的实际采样率
    this.sampleRate = (settings.sampleRate as number) || 48000;
    console.log("[VoiceInput] MediaStream sample rate:", this.sampleRate);

    // 不指定 AudioContext 采样率，让它自动匹配 MediaStream 的采样率
    this.audioContext = new AudioContext();
    console.log(
      "[VoiceInput] AudioContext sample rate:",
      this.audioContext.sampleRate,
    );

    // 再次确认采样率一致
    if (this.audioContext.sampleRate !== this.sampleRate) {
      console.warn(
        "[VoiceInput] Sample rate mismatch, forcing AudioContext to:",
        this.sampleRate,
      );
      // 关闭并重新创建 AudioContext
      await this.audioContext.close();
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(
      this.mediaStream,
    );
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
    // 断开连接
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
    }

    // 停止媒体流
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }

    // 关闭 AudioContext
    if (this.audioContext) {
      this.audioContext.close();
    }

    // 合并所有录制的数据
    const totalLength = this.recordedData.reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const mergedData = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.recordedData) {
      mergedData.set(chunk, offset);
      offset += chunk.length;
    }

    // 编码为 WAV
    const wavBuffer = this.encodeWAV(mergedData, this.sampleRate);
    return new Blob([wavBuffer], { type: "audio/wav" });
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

    // RIFF 头
    this.writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, "WAVE");

    // fmt 子块
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data 子块
    this.writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    // 写入音频数据
    let dataOffset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(
        dataOffset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
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
      if (recorderRef.current) {
        try {
          recorderRef.current.stop();
        } catch {}
      }
    };
  }, [cleanup]);

  useEffect(() => {
    if (status === "recording" && duration >= 60) {
      stopRecording();
    }
  }, [duration, status]);

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

  const stopRecording = () => {
    if (recorderRef.current) {
      try {
        const wavBlob = recorderRef.current.stop();
        onRecordingComplete(wavBlob);
      } catch (error) {
        console.error("停止录音失败:", error);
      }
      recorderRef.current = null;
    }
    cleanup();
    setStatus("idle");
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
        <div className="flex items-center gap-2">
          <Square className="w-4 h-4 fill-current" />
          <span className="text-sm font-medium">停止</span>
        </div>
      );
    }
    if (status === "denied") {
      return <MicOff className="w-5 h-5" />;
    }
    return <Mic className="w-5 h-5" />;
  };

  const renderStatusIndicator = () => {
    if (status === "recording") {
      return (
        <div className="flex items-center gap-2">
          <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
          <span className="text-sm font-medium text-red-600">
            {formatDuration(duration)}
          </span>
        </div>
      );
    }
    if (status === "denied") {
      return <span className="text-sm text-red-500">麦克风权限被拒绝</span>;
    }
    return null;
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleToggleRecording}
        disabled={disabled}
        className={`p-3 rounded-xl flex items-center justify-center transition-all duration-200 ${
          disabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : status === "recording"
              ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
              : status === "denied"
                ? "bg-red-50 text-red-400 hover:bg-red-100 border border-red-200"
                : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-300"
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

      {renderStatusIndicator()}

      {status === "idle" && !disabled && (
        <span className="text-xs text-slate-400">点击录音</span>
      )}
    </div>
  );
}
