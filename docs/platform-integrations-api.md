# 平台集成接口说明

社媒/电商平台账号连接、OAuth、token 刷新、发布和数据同步统一通过以下接口提供。

Base path:

```text
/api/overseas/platform-integrations
```

## 获取平台列表

```http
GET /providers
```

返回支持的平台与能力标记。

## 连接账号

```http
POST /:provider/connect
```

能力说明：
- OAuth 平台返回授权地址，或处理授权 code。
- 保存加密 token。
- 返回连接账号信息。

Demo 模式：
- 直接返回模拟连接成功。

## 查看连接状态

```http
GET /:provider/status
```

返回是否连接、账号名、头像、权限范围、最近同步时间。

## 同步数据

```http
POST /:provider/sync
```

触发订单、商品、客户、广告或社媒数据同步任务。

## 发布内容

```http
POST /:provider/publish
```

接收成片、caption、hashtags、发布时间等，调用平台 API 发布。

Demo 模式：
- 不外发，返回 `demo_post_*`。

## 断开连接

```http
DELETE /:provider
```

删除或失效授权信息。

## 当前支持 provider

- `shopify`
- `tiktok`
- `instagram`
- `facebook`
- `youtube`
- `whatsapp`
