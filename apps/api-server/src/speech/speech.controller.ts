/**
 * Speech Controller - ASR 端点
 */

import {
  Controller,
  Post,
  HttpException,
  HttpStatus,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { SpeechService } from "./speech.service";

// 定义上传文件接口（避免依赖 @types/multer）
interface UploadedFileData {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("speech")
@Controller("speech")
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {}

  // ----------------------------------------------------
  // POST /speech/asr - 语音识别
  // ----------------------------------------------------
  @Post("asr")
  @ApiOperation({
    summary: "语音识别 (ASR)",
    description: "上传音频文件，返回识别的文本",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "音频文件 (WebM/Opus 格式)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "识别成功",
    schema: { properties: { text: { type: "string" } } },
  })
  @ApiResponse({ status: 400, description: "无效的音频文件" })
  @ApiResponse({ status: 500, description: "ASR 服务错误" })
  @UseInterceptors(FileInterceptor("file"))
  async recognize(@UploadedFile() file: UploadedFileData) {
    if (!file || !file.buffer) {
      throw new HttpException("请上传音频文件", HttpStatus.BAD_REQUEST);
    }

    // 限制文件大小 (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new HttpException(
        "音频文件过大，请限制在 10MB 以内",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const text = await this.speechService.recognize(file.buffer);
      return { text };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new HttpException(
        `语音识别失败: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
