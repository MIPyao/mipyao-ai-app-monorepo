## ADDED Requirements

### Requirement: 用户可以听取 AI 回答的实时语音朗读

系统 SHALL 为 AI 回答提供流式语音合成，在 LLM 生成文本的同时实时朗读。

#### Scenario: 用户开启 TTS 开关

- **WHEN** 用户点击 TTS 开关按钮
- **THEN** 系统启用流式语音合成功能，后续 AI 回答将自动朗读

#### Scenario: 流式播放 AI 回答

- **WHEN** LLM 开始生成回答
- **THEN** 系统边生成文本边转换为语音流，前端实时播放音频，无需等待回答完成

#### Scenario: 用户暂停播放

- **WHEN** 用户点击暂停按钮
- **THEN** 系统暂停音频播放，但继续接收后端音频流（缓冲）

#### Scenario: 用户恢复播放

- **WHEN** 用户点击播放按钮
- **THEN** 系统从缓冲区继续播放，追赶上实时进度

#### Scenario: 用户关闭 TTS

- **WHEN** 用户点击 TTS 开关关闭
- **THEN** 系统停止音频播放，仅显示文本

### Requirement: 系统将 LLM 文本流实时转换为语音流

系统 SHALL 在接收 LLM 文本流的同时，将文本分句并调用 TTS 服务生成音频流。

#### Scenario: 检测到完整句子后触发 TTS

- **WHEN** 后端检测到 LLM 输出的完整句子（以。！？\n 结尾）
- **THEN** 系统立即将该句子发送给 TTS 服务，生成音频 chunk

#### Scenario: TTS 服务生成音频流

- **WHEN** TTS 服务返回音频 chunk
- **THEN** 系统通过 SSE 将音频流发送给前端

#### Scenario: TTS 服务返回错误

- **WHEN** TTS 服务返回错误（如网络超时、服务不可用）
- **THEN** 系统跳过当前句子的 TTS，继续处理后续句子，前端仅显示文本

### Requirement: 系统保证音频播放的连续性

系统 SHALL 确保流式音频播放不出现明显断续。

#### Scenario: 音频缓冲预加载

- **WHEN** 前端接收到音频 chunk
- **THEN** 系统将音频加入播放队列，缓冲至少 2 个 chunk 后开始播放

#### Scenario: 音频 chunk 无缝衔接

- **WHEN** 当前音频 chunk 播放完毕
- **THEN** 系统自动播放队列中的下一个 chunk，无明显间隔

#### Scenario: 网络延迟导致队列为空

- **WHEN** 播放队列为空（网络延迟）
- **THEN** 系统暂停播放，显示加载状态，待缓冲后继续

### Requirement: 系统支持多种 TTS 服务提供商

系统 SHALL 支持配置不同的 TTS 服务，并可通过环境变量切换。

#### Scenario: 使用 Edge-TTS（默认）

- **WHEN** 配置 `TTS_PROVIDER=edge-tts`
- **THEN** 系统使用微软 Edge-TTS 服务，免费，支持流式

#### Scenario: 使用 SiliconFlow TTS

- **WHEN** 配置 `TTS_PROVIDER=siliconflow`
- **THEN** 系统使用 SiliconFlow TTS API，复用现有 API Key

#### Scenario: 使用 OpenRouter TTS

- **WHEN** 配置 `TTS_PROVIDER=openrouter`
- **THEN** 系统使用 OpenRouter TTS API，复用现有 API Key

### Requirement: 系统在消息中显示播放状态

系统 SHALL 在 AI 消息旁显示当前播放状态。

#### Scenario: 正在流式播放

- **WHEN** 系统正在流式播放 TTS
- **THEN** 消息旁显示播放动画图标和"正在朗读..."状态

#### Scenario: 播放完成

- **WHEN** TTS 播放完成
- **THEN** 状态图标变为静音，显示"播放完成"

#### Scenario: 用户切换到其他消息

- **WHEN** 用户点击其他 AI 消息的播放按钮
- **THEN** 系统停止当前消息的播放，开始播放新消息
