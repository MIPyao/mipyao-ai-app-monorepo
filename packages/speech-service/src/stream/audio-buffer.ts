/**
 * 音频流缓冲工具
 * 用于确保流式音频播放的连续性
 */

export interface AudioBufferOptions {
  /** 最小缓冲块数（达到后才开始播放） */
  minChunks?: number;
  /** 最大缓冲块数（超过则丢弃旧块） */
  maxChunks?: number;
}

export class AudioStreamBuffer {
  private chunks: Buffer[] = [];
  private readonly minChunks: number;
  private readonly maxChunks: number;
  private isComplete: boolean = false;

  constructor(options: AudioBufferOptions = {}) {
    this.minChunks = options.minChunks ?? 2;
    this.maxChunks = options.maxChunks ?? 100;
  }

  /**
   * 添加音频块
   * @param chunk 音频数据块
   * @param isLast 是否是最后一个块
   */
  push(chunk: Buffer, isLast: boolean = false): void {
    if (chunk.length > 0) {
      this.chunks.push(chunk);

      // 如果超过最大缓冲数，移除最旧的块
      while (this.chunks.length > this.maxChunks) {
        this.chunks.shift();
      }
    }

    if (isLast) {
      this.isComplete = true;
    }
  }

  /**
   * 检查是否可以开始播放
   * @returns 是否达到最小缓冲要求或已完成
   */
  canPlay(): boolean {
    return this.chunks.length >= this.minChunks || this.isComplete;
  }

  /**
   * 弹出一个音频块
   * @returns 音频块或 null
   */
  pop(): Buffer | null {
    return this.chunks.shift() || null;
  }

  /**
   * 获取当前缓冲的块数
   */
  get length(): number {
    return this.chunks.length;
  }

  /**
   * 是否已完成（接收到最后一个块）
   */
  get complete(): boolean {
    return this.isComplete && this.chunks.length === 0;
  }

  /**
   * 是否为空
   */
  get empty(): boolean {
    return this.chunks.length === 0;
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.chunks = [];
    this.isComplete = false;
  }

  /**
   * 获取所有缓冲的音频数据（合并）
   * @returns 合并后的音频数据
   */
  getAll(): Buffer {
    const result = Buffer.concat(this.chunks);
    this.chunks = [];
    return result;
  }
}
