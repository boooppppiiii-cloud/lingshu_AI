# WhatsApp 一键连接接入说明

这份文档给系统管理员和实施同事使用。普通客户不需要理解 Phone Number ID、Access Token、Verify Token 或 Webhook，只需要在插件市场点击「连接 WhatsApp Business」。

## 目标体验

客户看到的流程应该只有四步：

1. 打开「插件市场」并安装 WhatsApp 商业版。
2. 点击「连接 WhatsApp Business」。
3. 在 Meta 弹窗里登录账号，选择或创建业务账户、WhatsApp Business Account 和电话号码。
4. 完成短信/语音验证码后回到系统，插件显示已连接。

系统后台负责保存授权、号码 ID、Webhook 验证字符串，并订阅 messages 事件。

## 管理员一次性准备

在 Meta 开发者后台准备：

1. 创建或打开一个 Meta App，并添加 WhatsApp 产品。
2. 创建 WhatsApp Embedded Signup / Facebook Login for Business 配置，拿到 Configuration ID。
3. 在 App 基础设置里拿到 App ID 和 App Secret。
4. 在 WhatsApp Webhooks 配置里填写本系统的回调地址。
5. 确认 App 权限覆盖 WhatsApp 发送消息和管理业务资产所需范围。

生产环境必须使用公网 HTTPS 域名，本地 `localhost` 或内网地址不能接收 Meta 的 Webhook 回调。

## 环境变量

在 `.env` 中配置：

```env
PUBLIC_BASE_URL=https://your-real-domain.com
META_GRAPH_VERSION=v25.0
WHATSAPP_EMBEDDED_SIGNUP_APP_ID=
WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET=
WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=
```

字段含义：

`PUBLIC_BASE_URL`：生产环境公网 HTTPS 域名，不要带末尾斜杠。

`META_GRAPH_VERSION`：Graph API 版本。后续 Meta 升级版本时，只改这里。

`WHATSAPP_EMBEDDED_SIGNUP_APP_ID`：Meta App ID。

`WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET`：Meta App Secret，只放服务端环境变量。

`WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`：Embedded Signup / Facebook Login for Business 的 Configuration ID。

## Webhook 配置

插件安装后，系统会自动生成 Verify Token。管理员可在 WhatsApp 插件弹窗的「高级实施配置」里看到：

```text
https://your-real-domain.com/api/overseas/plugins/whatsapp_business/webhook
```

Meta 后台 Webhook 配置：

1. Callback URL 填上面的地址。
2. Verify Token 填系统生成的 Verify Token。
3. 订阅字段选择 `messages`。

注意：当前实现是单租户/单 WhatsApp 插件配置。如果未来要让多个客户共用同一个部署，需要把插件配置迁移到 tenant 维度，并让 Webhook 地址或事件分发能区分客户。

## 客户侧文案

面向客户时，不要出现这些词：

- Phone Number ID
- Access Token
- Verify Token
- Webhook
- Graph API

建议统一说法：

- 「连接 WhatsApp Business」
- 「登录 Meta 账号完成授权」
- 「选择要接入的 WhatsApp 商业号码」
- 「授权完成后即可接收客户消息和发送模板消息」

## 高级实施配置

保留「高级实施配置」用于内部兜底：

- 客户所在国家/账号暂时无法使用 Embedded Signup。
- Meta 弹窗授权异常，需要手动填入长期 Access Token。
- 迁移旧账号时已经有 Phone Number ID 和 Token。

普通客户培训和交付时不要引导他们打开高级配置。

## 验收清单

管理员配置完成后，按这个顺序验收：

1. 打开插件市场，WhatsApp 卡片显示「连接」或「管理连接」。
2. 未配置 Meta 参数时，弹窗只提示管理员待配置，不显示技术输入框。
3. 配好环境变量并重启服务后，「连接 WhatsApp Business」按钮可点击。
4. 完成 Meta 弹窗授权后，插件显示已连接的业务名和号码。
5. 点击「测试」能读取号码信息。
6. 在 Meta 后台 Webhook 测试能通过验证。
7. 用真实客户号码给该 WhatsApp 商业号码发一条消息，服务端日志能收到 incoming message。

## 已知边界

当前系统已经接入：

- Embedded Signup 前端入口。
- 授权码换取 Access Token。
- Phone Number ID 保存。
- Verify Token 自动生成。
- messages Webhook 验证和接收。
- Graph API 版本从环境变量读取。

后续生产化建议：

- 把 Access Token 加密保存。
- 把 WhatsApp 插件配置迁移为租户隔离。
- 将 incoming message 写入询盘/转化专家工作台，而不是只打印日志。
- 增加模板消息管理和模板审批状态同步。
- 增加 Webhook 签名校验和重放保护。
