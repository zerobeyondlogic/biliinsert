# B站属地补全

为 Chrome / Edge 补全 B站网页中的 **IP 属地和关注时间**，采用普通文字样式，支持个人主页、动态、评论及楼中楼。

**当前版本：v0.2.3** · [下载最新版](https://github.com/zerobeyondlogic/biliinsert/releases/latest) · [更新记录](CHANGELOG.md) · [来源与许可](THIRD_PARTY_NOTICES.md)

## 功能

| 位置 | 显示内容 | 使用条件 |
| --- | --- | --- |
| 视频与动态评论、楼中楼 | 每条评论自己的 IP 属地，紧接发布时间 | 无需扩展授权 |
| 个人主页 | 用户名旁显示该账号公开的 IP 属地 | 首次使用需 B站 App 扫码授权 |
| 动态列表、个人空间动态、动态详情 | 每条动态发表时的 IP 属地 | 需要有效扫码授权 |
| 转发中的原动态 | 独立显示原动态的属地 | 不使用转发者属地代替 |
| 主页关注按钮、关注/粉丝列表 | 对应关注关系的时间 | 使用正常网页登录，无需 App 授权 |

- 主页横幅上的属地和关注时间使用白字；评论及动态文字跟随发布时间的字号和颜色，无底色、无圆角。
- 支持滚动加载、楼中楼展开、页面切换及节点复用。
- 四个显示开关可独立控制，无需安装油猴或其他评论属地插件。
- 已有其他插件显示评论属地时会尽量避免重复；建议只保留一个插件负责同一功能。

## 安装

1. 从 [Releases](https://github.com/zerobeyondlogic/biliinsert/releases/latest) 下载 `B站属地补全-版本号.zip` 并解压。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后**直接包含 manifest.json** 的文件夹。
4. 刷新 B站网页。评论和楼中楼属地可直接使用。
5. 要显示个人主页和动态属地，点击扩展图标中的“扫码授权”，用 B站 App 扫码，核对设备登录提示后确认。

扫码授权有效期内会复用，不必每次扫码，也无需退出当前网页登录。尚未上架浏览器扩展商店。

**更新：** 覆盖原扩展目录，在扩展管理页点击“重新加载”，再刷新 B站页面。保留原目录可保留扩展身份、开关和已有有效授权。

## 关注时间的含义

主页显示“你关注 Ta 于”。关注列表显示主页主人关注该用户的时间，粉丝列表显示该用户关注主页主人的时间；查看他人列表时不会把“主页主人”误标为“你”。

使用 B站接口返回的关系时间。主页沿用参考组件的保守判断，仅对明确的普通关注状态显示；互关、拉黑等其他关系变动不会当成首次关注时间。取消后重新关注可能改变时间，无法还原接口没有提供的历史。

列表复用网页已加载的数据，主页仅查询当前目标，不额外遍历完整关注列表。

## 数据与权限

- 属地均来自 B站返回字段，不推测位置，不读取用户自行填写的资料地区。
- 主页属地、单条动态属地和单条评论属地可能不同，各自独立取数。
- 不申请扩展 Cookie 读取权限。扫码使用 B站官方登录接口，二维码在本机生成。
- App 登录凭据仅保存在本机扩展存储，限制可信扩展上下文访问；不云同步、不传入网页、不写日志。
- 显示开关使用浏览器扩展设置同步；属地缓存仅保存在内存中。
- 没有第三方查询服务、统计或远程执行脚本。查询只访问 B站接口。
- “清除本地授权”移除扩展凭据及相关缓存，不退出浏览器登录；B站侧的设备登录可在账号设置中管理。

固定权限为 `storage` 和 `declarativeNetRequestWithHostAccess`。请求规则仅作用于本扩展发往指定 App 接口的请求，不改写普通网页请求。

扫码取得的是手机端设备登录凭据，并非平台提供的“仅属地”权限令牌。

## 限制与常见问题

**为什么部分内容没有属地？**

接口必须提供有效地区和可验证的内容编号。历史内容、删除内容及部分特殊类型可能没有数据；缺失、错误或身份不匹配时不显示。不会用作者主页属地填充其他内容。

**网页登录已经成功，为什么主页和动态还要扫码？**

网页登录 Cookie 与 App 凭据不同。早期版本的网页登录转换在真实使用中被 B站拒绝，v0.2.2 已停用；当前不提供这种转换。评论和关注时间仍可独立使用。

**支持哪些页面？**

支持 B站主站评论、个人空间和 `t.bilibili.com` 动态，以及 `www.bilibili.com/opus/` 动态详情。评论适配 Lit、Vue 和旧版结构，但未逐一验收所有灰度及历史页面版本；旧版 `read/cv` 专栏正文不在本版范围内。

**更新后没有变化？**

同时重新加载扩展并刷新 B站页面。确认对应开关开启；主页/动态还需有效授权。遇到限流稍后再试。

问题请提交到[本仓库 Issues](https://github.com/zerobeyondlogic/biliinsert/issues)，附页面链接、浏览器和扩展版本。**不要提交 Cookie、登录令牌或完整账号网络日志。**

## 来源与致谢

感谢以下项目和作者：

- [BiliReveal](https://github.com/maxchang3/BiliReveal) / [BiliRevealForSpace](https://github.com/maxchang3/userscripts/tree/main/BiliRevealForSpace)：评论适配和主页属地接口参考。
- [Chihiro521/bili-ip-region](https://github.com/Chihiro521/bili-ip-region)：动态协议、数据校验和页面绑定的改编基础。
- [lzghzr/libBilibiliToken](https://github.com/lzghzr/TampermonkeyJS/tree/master/libBilibiliToken)：二维码登录及签名协议参考。
- [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) 的 [subscribeTimeShow](https://github.com/the1812/Bilibili-Evolved/blob/master/registry/lib/components/utils/subscribe-time-show/index.ts)，作者 [GH4NG](https://github.com/GH4NG)：关注时间功能参考，本项目独立重写。

具体改编范围、依赖及版权声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [licenses/](licenses/)。本项目采用 [MIT 许可](LICENSE)，不代表 B站官方或上游项目，问题由本项目维护。

## 开发与验证

需要 Node.js 24：

~~~sh
npm ci
npm test
npm run build
~~~

构建产物位于 `dist/`，可直接作为已解压扩展加载。

浏览器验证需要 Chromium：

~~~sh
npx playwright install chromium
npm run test:browser
node tests/comments-browser.mjs
node tests/subscribe-time-browser.mjs
node tests/popup-auth-browser.mjs
node tests/popup-layout-browser.mjs
~~~

可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 Chromium 路径。测试使用独立浏览器资料和模拟数据；弹窗测试通过真实 `chrome.action.openPopup()` 检查布局。模拟测试不能替代真实账号和所有 B站页面的验收。

可选联网检查 `node tests/live-smoke.mjs` 仅在独立浏览器中申请官方二维码，不扫码、不登录。

源码仓库不包含 node_modules、构建产物、浏览器资料、研究下载或本地测试报告；安装包单独发布在 Releases。
