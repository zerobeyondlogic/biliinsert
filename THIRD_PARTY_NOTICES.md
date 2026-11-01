# 来源、改编与第三方许可

本项目采用 [MIT 许可](LICENSE)。下表区分改编代码、接口参考和功能参考；上游的版权及许可声明保存在 [licenses/](licenses/)，并随扩展安装包分发。各文件中的原作者声明保留，不能用本项目的许可证替代。

## 功能与协议来源

| 来源 | 本项目的使用范围 | 版权与许可 |
| --- | --- | --- |
| [Chihiro521/bili-ip-region](https://github.com/Chihiro521/bili-ip-region) | 动态 gRPC 编解码、请求元信息、内容与作者匹配、Vue 动态绑定及评论数据处理策略；相关代码经过裁剪和改编 | Copyright (c) 2026 Chihiro521；[MIT 原文](licenses/bili-ip-region-MIT.txt) |
| [maxchang3/BiliReveal](https://github.com/maxchang3/BiliReveal) | 评论组件适配，Lit / bbComment Hook 与 IP 属地字段读取策略 | Copyright (c) 2023-present MaxChang3；[MIT 原文](licenses/BiliReveal-MIT.txt) |
| [maxchang3/BiliRevealForSpace](https://github.com/maxchang3/userscripts/tree/main/BiliRevealForSpace) | 个人主页 App 接口及 location 标签字段参考 | Copyright (c) 2024 maxchang3；[所属仓库 MIT 原文](licenses/BiliRevealForSpace-MIT.txt) |
| [lzghzr/libBilibiliToken](https://github.com/lzghzr/TampermonkeyJS/tree/master/libBilibiliToken) | 手机客户端公开参数、请求签名和二维码登录协议参考；当前版本不包含 Cookie 自动确认流程 | Copyright (c) lzghzr；[MIT 原文](licenses/libBilibiliToken-MIT.txt) |
| [Bilibili-Evolved / subscribeTimeShow](https://github.com/the1812/Bilibili-Evolved/blob/master/registry/lib/components/utils/subscribe-time-show/index.ts) | 关注时间的功能位置、关系方向与接口行为参考；本项目独立重写，未打包上游组件或完整脚本 | 原功能作者 [GH4NG](https://github.com/GH4NG)；见上游 [LICENCE.md](https://github.com/the1812/Bilibili-Evolved/blob/master/LICENCE.md)，包含 MIT 基础及分发相关要求 |

主要代码对应：

- `src/dynamic-protocol.js`、`src/dynamic-api.js`、`src/binding.js`：bili-ip-region 的协议与动态绑定。
- `src/comments-main.js`、`src/comments-data.js`：BiliReveal 和 bili-ip-region 的评论适配策略。
- `src/api.js`：BiliRevealForSpace 的主页接口参考，以及 libBilibiliToken 的登录/签名协议参考。
- `src/subscribe-time-*.js`：独立实现关注时间显示；功能参考 subscribeTimeShow。

旧版本曾研究网页登录会话转换，但该生产路径已在 v0.2.2 删除，不属于当前支持能力。

## 打包进扩展的依赖

| 依赖 | 版本 | 用途 | 上游许可声明 |
| --- | --- | --- | --- |
| [blueimp-md5](https://github.com/blueimp/JavaScript-MD5) | 2.19.0 | 本地请求签名 | [MIT](licenses/blueimp-md5-MIT.txt) |
| [node-qrcode](https://github.com/soldair/node-qrcode) | 1.5.4 | 本地生成二维码 | [MIT](licenses/qrcode-MIT.txt) |
| [dijkstrajs](https://github.com/tcort/dijkstrajs) | 1.0.3 | 二维码编码依赖 | [上游版权与 MIT 声明](licenses/dijkstrajs-MIT.txt) |

开发和测试工具 esbuild、sharp、Playwright 不打包进运行时扩展；其版本和依赖信息保存在 `package-lock.json`。

## 项目关系与反馈

本扩展并非哔哩哔哩官方产品，也不代表上述项目的官方分支或背书。请在[本仓库 Issues](https://github.com/zerobeyondlogic/biliinsert/issues)反馈本扩展的问题，维护与技术支持由本项目承担，不转交上游。

B站网页组件和接口可能变化，功能以接口实际返回的数据为准。
