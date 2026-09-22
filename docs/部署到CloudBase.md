# 部署到腾讯云 CloudBase

## 1. 创建 WPS 测试应用

在金山文档开放平台创建测试应用，申请以下只读权限：

- `user_basic`
- `access_personal_files`
- `download_personal_files`

把 CloudBase HTTP 云函数的 `/api/auth/wps/callback` 地址登记为 OAuth 回调地址。记录应用的 `APPID` 和 `APPKEY`。

## 2. 创建 CloudBase 环境

创建一个 CloudBase 环境，并启用：

- 静态网站托管
- 云函数
- 云数据库
- 云存储

云数据库需要以下集合：`app_config`、`integrations`、`records`、`cases`、`user_settings`、`sync_runs`。云存储保持私有，不开启匿名读取。

## 3. 设置环境变量

按照项目根目录 `.env.example` 配置云函数环境变量。`TOKEN_ENCRYPTION_KEY` 和 `SESSION_SECRET` 应使用两个独立的随机长字符串。`WPS_FILE_TOKEN` 是目标 WPS 云文档的文件 ID。

客户端首次使用时填写的 WPS App ID/Key 会通过 HTTPS 发送到你自己的云函数授权入口，并在授权回调和后续刷新令牌时以加密形式使用；它们不需要写进源码或 GitHub。服务器环境中的 `WPS_APP_ID`、`WPS_APP_KEY` 可以作为没有客户端凭据时的备用配置。

前端构建时把 `VITE_API_BASE_URL` 设置为云函数 HTTP 访问域名。云端密钥不得写入 `VITE_` 前缀变量，也不得放入前端源码。

## 4. 构建与部署

运行 `pnpm build` 生成 `dist`，随后使用 CloudBase Framework 或 CloudBase CLI 按 `cloudbase.json` 部署。定时触发器会每 15 分钟调用一次同步函数。

HTTP 云函数在 Windows 上发布时，请从函数目录执行部署，避免 CLI 把项目根目录误识别为代码包：

```powershell
Push-Location .\cloudfunctions\worklog-api
$hook = (Resolve-Path ..\..\scripts\force-bootstrap-mode.cjs).Path.Replace('\','/')
$env:NODE_OPTIONS="--require=\"$hook\""
tcb fn deploy worklog-api --httpFn --install-dependency true -e <你的环境ID> --dir . --force
Pop-Location
```

`scripts/force-bootstrap-mode.cjs` 只在发布时把 `scf_bootstrap` 的 Unix 执行权限写入上传包，不会改动业务代码或上传任何密钥。

首次访问时完成 WPS 授权。应用会把第一个授权成功的 WPS `openId` 锁定为唯一所有者；后续其他账号会被拒绝。

## 5. 个人配置备份

应用会把当前 WPS 账号的个人配置保存到 `user_settings` 集合，包括事项编号、自定义关联、自定义大类和排除词。原始工作记录和图片仍然分别保存到 `records` 和云存储中。

在客户端断网或准备换电脑时，也可以在“数据与同步”页面手动导出 JSON 配置文件，再在新设备同步同一份 WPS 工作记录后导入配置。

## 6. 安全检查

- 确认 `APPKEY`、访问令牌和刷新令牌只存在于云函数环境与加密数据库字段中。
- 确认静态站点无法直接访问 `work-review/` 云存储目录。
- 确认 HTTPS、`HttpOnly`、`Secure`、`SameSite=Lax` 会话 Cookie 生效。
- 用手动同步先验证记录数与图片数，再启用定时触发器。
