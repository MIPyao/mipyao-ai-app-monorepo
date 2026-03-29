/**
 * 文本分句工具
 * 用于将 LLM 输出的文本流按句子分割，便于逐句调用 TTS
 */

export interface Sentence {
  /** 完整的句子文本 */
  text: string;
  /** 在原始文本中的起始位置 */
  start: number;
  /** 在原始文本中的结束位置 */
  end: number;
}

/**
 * 分句检测器
 * 支持中英文分句
 */
export class TextSplitter {
  private buffer: string = "";
  private sentenceStart: number = 0;

  // 分句符号：中文句号、问号、感叹号、英文句号、换行符
  private static readonly SPLIT_PATTERN = /[。！？.!?\n]/;

  /**
   * 添加文本块并返回完整的句子
   * @param chunk 新的文本块
   * @returns 完整的句子数组
   */
  addChunk(chunk: string): Sentence[] {
    this.buffer += chunk;
    const sentences: Sentence[] = [];

    let match: RegExpExecArray | null;
    const pattern = new RegExp(TextSplitter.SPLIT_PATTERN, "g");

    while ((match = pattern.exec(this.buffer)) !== null) {
      const end = match.index + 1; // 包含分句符号
      const text = this.buffer.slice(0, end).trim();

      if (text.length > 0) {
        sentences.push({
          text,
          start: this.sentenceStart,
          end: this.sentenceStart + end,
        });
      }

      this.buffer = this.buffer.slice(end);
      this.sentenceStart += end;
      pattern.lastIndex = 0; // 重置正则位置
    }

    return sentences;
  }

  /**
   * 获取剩余未分句的文本
   * @returns 剩余文本
   */
  flush(): Sentence | null {
    const text = this.buffer.trim();
    if (text.length === 0) {
      return null;
    }

    const sentence: Sentence = {
      text,
      start: this.sentenceStart,
      end: this.sentenceStart + this.buffer.length,
    };

    this.buffer = "";
    this.sentenceStart = 0;

    return sentence;
  }

  /**
   * 重置分句器
   */
  reset(): void {
    this.buffer = "";
    this.sentenceStart = 0;
  }
}
