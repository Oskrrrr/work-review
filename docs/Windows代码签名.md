# Windows 安装包代码签名

Windows 的“未知发布者”提示不是应用名称配置造成的，而是安装包没有被 Windows 信任的 Authenticode 证书签名。

项目已经配置了：

- Windows 安装包和应用使用 `Oskrrrr` 作为发布者名称；
- 使用 `build/work-review.ico` 作为应用、快捷方式和安装包图标；
- 保留 Electron Builder 的资源编辑和签名流程；
- 支持通过 Electron Builder 官方环境变量注入签名证书。

## 正式签名构建

准备受信任的 Windows 代码签名证书（通常为 `.pfx`），然后在当前 PowerShell 会话中设置：

```powershell
$env:CSC_LINK = 'D:\certs\work-review.pfx'
$env:CSC_KEY_PASSWORD = '证书密码'
pnpm run client:package
```

也可以在 CI 中使用 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD`，不要把证书、密码或私钥提交到 GitHub。

只有使用受信任的证书签名后，其他用户安装时才会显示受信任的发布者名称；仅设置 `publisherName` 或把作者写成 `Oskrrrr`，不能消除 Windows 对未签名程序的“未知发布者”警告。自签名证书只适合内部测试，其他电脑默认不会信任它。
