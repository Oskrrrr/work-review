# 安全说明

## 使用个人 WPS 模式

个人 WPS 登录由官方 `kdocs-cli` 完成，登录凭据保存在使用者自己的电脑系统凭据中。请不要把 WPS 登录缓存、导出的配置文件、工作记录 Excel 或 AI 文字稿提交到 GitHub。

## 使用旧版 CloudBase 模式

旧版企业 WPS/CloudBase 代码仅使用环境变量读取密钥。真实的 `WPS_APP_ID`、`WPS_APP_KEY`、`SESSION_SECRET`、`TOKEN_ENCRYPTION_KEY`、`CLOUDBASE_ENV_ID` 和 `WPS_FILE_TOKEN` 只能放在本地 `.env` 或云函数环境变量中，不能写入源码、截图、Issue 或 Pull Request。

如果密钥曾经被提交到 Git 历史，即使后来删除文件也不能认为已经安全，应立即在对应平台撤销并重新生成。

## 报告安全问题

请不要在公开 Issue 中粘贴密钥、访问令牌或真实工作记录。发现安全问题时，请通过仓库维护者提供的私下联系方式报告，并附上复现步骤和受影响版本。
