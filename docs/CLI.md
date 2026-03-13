# CLI 渠道文档

本文档描述 CLI（命令行）渠道的功能和使用。

---

## 概述

CLI 渠道通过 Unix Socket 提供终端交互界面，支持：
- 文字输入/输出
- 语音输入/输出（TTS）
- 实时 API 调试信息
- 多群组管理

---

## 语音交互

### 语音输入

- **快捷键**: `Ctrl+R` 开始录音，`Enter` 停止并转录
- **引擎**: 本地 whisper.cpp (离线，无需 API 调用)
- **安装依赖**:
  ```bash
  brew install ffmpeg whisper-cpp
  ```
- **下载模型**:
  ```bash
  curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o data/models/ggml-base.bin
  ```

### 语音输出 (TTS)

- **快捷键**: `Ctrl+T` 切换文本转语音
- **默认引擎**: macOS `say` 命令 (免费，离线，支持多语言)
- **可选引擎**: OpenAI TTS API (需设置 `OPENAI_API_KEY`)

### 语音指示器

状态图标显示当前状态：
- 🔴 录音中
- ⏳ 转录中
- 💬 播放中
- 🎤 就绪

---

## API 调试面板

CLI 界面实时显示 API 请求信息：

- 使用的模型
- 上下文消息数量
- Max tokens 设置
- 首条消息预览
- 请求状态 (进行中/已完成)

---

## 故障排查

### 语音问题

**录音失败：**
- 检查 ffmpeg 安装: `brew install ffmpeg`
- 检查 whisper-cli 安装: `brew install whisper-cpp`
- 下载模型文件到 `data/models/ggml-base.bin`

**TTS 不工作：**
- macOS `say` 命令应开箱即用
- OpenAI TTS 需验证 `OPENAI_API_KEY` 已设置

### 连接问题

**无法连接到 NanoClaw：**
- 检查 Unix Socket 文件: `ls data/nanoclaw.sock`
- 确认 NanoClaw 正在运行: `launchctl list | grep nanoclaw`
- 检查权限: Socket 文件权限应为 666
