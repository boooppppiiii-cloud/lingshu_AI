# WhatsApp Coexistence 调研结论

调研日期：2026-07-11

## 结论

建议主推 **共存模式**：已在 WhatsApp Business App 上运营的商家，可以通过 Embedded Signup 继续使用原手机号和手机端工作流，同时把 Cloud API 接入灵枢用于收件箱、自动草稿、低风险自动回复和数据沉淀。

同时保留 **专用新号模式** 作为回退：当商家手机号不符合共存资格、所在地区或账号状态被 Meta 拒绝、或商家需要更高吞吐/更强自动化隔离时，引导其走新号 Cloud API 接入。

接入向导 Step 3 文案需要更新为：

> 已有 WhatsApp Business App 号码：优先选择“连接现有 WhatsApp Business App（共存模式）”，扫码授权后可同步联系人与近 180 天历史消息（需商家授权）。如果号码不符合资格，改用“注册专用 Cloud API 新号”。

## 1. 国家/地区覆盖

Meta 官方文档没有给出一个固定、完整、带日期的 Coexistence 国家清单。接入资格主要由 Embedded Signup 流程校验；Meta 支持文档明确排除受制裁地区，例如 Cuba、Iran、North Korea、Syria 以及 Ukraine 的 Crimea、Donetsk、Luhansk。

对中国商家常见注册地与目标市场的判断：

- 中国大陆商家常用海外主体、香港主体、新加坡主体、欧美/中东目标市场，需要以 Embedded Signup 实际校验结果为准。
- 只要商家已使用 WhatsApp Business App，且号码/企业主体通过 Meta 校验，共存模式是优先尝试路径。
- 若 Embedded Signup 返回国家、账号、号码资格错误，则回退专用新号模式。

## 2. 接入流程兼容性

Meta 的 “Onboard WhatsApp Business app users” 文档说明，Embedded Signup 可以配置为让商家使用现有 WhatsApp Business App 账号和手机号接入 WhatsApp Business Platform。这与我们现有 per-customer app / tenant platform app 模式兼容：

- 灵枢仍按租户保存 Meta app、webhook verify token、app secret。
- Embedded Signup 完成后，把 WABA、phone number id、access token 等绑定到租户。
- Webhook 仍复用 `/api/webhooks/meta/:tenantId`，区别是共存模式会多出 `history`、`smb_app_state_sync`、`smb_message_echoes` 等字段。

## 3. 历史同步范围与技术方式

Meta 官方 history webhook reference 说明，`history` webhook 用于同步通过 Solution Provider onboard 的 WhatsApp Business App 客户聊天历史。公开文档/官方索引指向的字段包括：

- `history`：历史消息同步。商家同意共享历史后，可收到历史聊天记录事件；行业实现通常按近 180 天（约 6 个月）处理。
- `smb_app_state_sync`：同步 WhatsApp Business App 联系人。
- `smb_message_echoes`：共存后，商家在 WhatsApp Business App 或 companion device 上发送的新消息回声。

本次实现的 `server/whatsapp/historyImport.ts` 按以下方式处理：

- 联系人按 `wa_number` upsert customer。
- 历史消息按 Meta message id 幂等写入 interactions。
- 时间戳排序后生成客户 timeline。
- 导入进度写入 `data/whatsapp-import-status.json`，集成中心显示“正在导入历史记录（done/total）”。

## 4. 限制清单

共存模式不是完整 Cloud API 迁移，需在产品文案中明确：

- 群聊不会同步到 API 收件箱。
- Disappearing messages 会被关闭。
- View once media、live location 等部分 App 功能不适用于共存 API 路径。
- WhatsApp for Windows / WearOS companion clients 不支持；文档显示 companion clients 大多支持，但 Windows 和 WearOS 除外。
- 历史聊天同步依赖商家授权；若拒绝共享历史，只能从接入后的新消息开始沉淀。
- L4 动作（报价、折扣、付款条款、交期承诺、补偿等）即便在 auto 档也必须降级为草稿。

## 5. 产品建议

主流程：

1. Step 3 默认推荐“连接现有 WhatsApp Business App（共存模式）”。
2. 同屏放置“没有旧号/共存失败？使用专用 Cloud API 新号”。
3. 授权后先触发联系人和历史同步，导入完成前前端显示进度。
4. 新消息进入客户收件箱后，统一走附录 A 动作风险引擎。

工程边界：

- 当前仓库已实现 webhook 入库、历史导入、实时消息处理、红线拦截和客户 API 骨架。
- 真实发送 WhatsApp 自动回复仍需要已配置 phone number id/access token，并在发送前经过 `guardOutbound`。

## 参考来源

- Meta for Developers: [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- Meta for Developers: [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- Meta for Developers: [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- Meta for Developers: [WhatsApp webhooks overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
- Meta for Developers: [history webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history)
- Meta for Developers: [smb_app_state_sync webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_app_state_sync)
- Meta for Developers: [WhatsApp Business Platform support](https://developers.facebook.com/documentation/business-messaging/whatsapp/support)
