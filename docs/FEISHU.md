# Feishu 飞书渠道文档

本文档描述 Feishu (飞书) 渠道的特有功能。

---

## 消息表情反应

NanoClaw 使用飞书消息表情 (Reactions) 提供视觉反馈：

| 场景 | 表情 |
|------|------|
| 消息收到 | Get, OK, THUMBSUP |
| 处理中 | Typing, OnIt, OneSecond |
| 成功/完成 | DONE, LGTM, CheckMark |
| 错误 | ERROR, CrossMark, FACEPALM |

表情根据消息内容关键词自动选择（支持中英文）。

---

## 故障排查

### 连接问题

**Bot 收不到消息：**
- 确认飞书应用设置中启用了 "长连接" 模式（非 HTTP webhook）
- 检查订阅了 `im.message.receive_v1` 事件
- 确保 Bot 已加入群聊且应用已发布
- 查看日志: `tail -f logs/app.log`

**无法发送消息：**
- 确认飞书应用权限中授予了 `im:message:send` 权限
- 检查 `.env` 中 `FEISHU_APP_SECRET` 正确
- Token 过期会自动刷新（SDK 处理）

**WebSocket 连接断开：**
- Feishu SDK 会自动重连
- 检查网络稳定性
- 监控日志查看重连事件
