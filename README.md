[![][image-banner]][releases-link]

这是一个帮你把 QQ 聊天记录导出到本地的工具。把它下载到你自己的电脑上，就能直接读取并保存好友和群聊的记录。

它不仅可以导出 HTML、JSON、TXT 和 Excel 等各种你需要的格式，还可以将聊天中发过的图片、视频和表情文件一并下载到本地保存。最最最重要的是，所有读取和解析都在你自己的电脑上完成，项目没有服务器或数据传输，绝对不会把你的聊天记录上传到任何地方。

**[下载][releases-link]** **[使用文档][docs-link]** **[Docker 部署][docker-doc]** **[反馈问题][issues-link]**

[![][github-release-shield]][releases-link]
[![][github-downloads-shield]][releases-link]
[![][github-stars-shield]][stars-link]
[![][github-license-shield]][license-link]

> \[!IMPORTANT]
>
> **Star 一下**，你将第一时间收到 GitHub 上的新版本发布通知哟

## 特性

![会话导出](docs/images/features-1.png)

![多格式与定时导出](docs/images/features-2.png)

![现代化查看器](docs/images/features-3.png)

![资源画廊](docs/images/features-4.png)

## 快速开始

从 [Releases][releases-link] 下载适合当前系统的安装包或 Shell 包。

### Windows 一键安装（推荐）

1. 下载 `QQChatExporter-Installer-*.exe` 并运行
2. 用 QQ 扫码登录
3. 打开 `http://localhost:40653/qce`，在「会话」里选择记录并导出为 HTML

### Shell 模式（Windows / Linux / macOS Apple Silicon 预览）

1. 下载并解压对应平台的 Shell 包。Windows x64 使用 `.zip`，Linux x64 和 macOS Apple Silicon 使用各自的 `.tar.gz`
2. 运行 `launcher-user.bat`（Windows）或 `./launcher-user.sh`（Linux / macOS）
3. 用 QQ 扫码登录，打开控制台打印的一键登录链接，随后可在「会话」里选择记录并导出为 HTML
4. 也可手动访问 `http://localhost:40653/qce`，令牌见控制台输出；在「设置 → 启动」里可开启登录后自动打开浏览器

> \[!NOTE]
> macOS 当前仅提供 Apple Silicon（arm64）预览包，且启动前需要完全退出电脑上的 QQ，详见 [macOS 使用指南][macos-doc]。

### QCE 上游的 Docker 部署

适用于 macOS（含 Apple Silicon）、Linux、Windows，无需安装 QQ 客户端：

```bash
git clone https://github.com/shuakami/qq-chat-exporter.git
cd qq-chat-exporter/docker
docker compose up -d

# 查看登录二维码与 Token
docker logs -f napcat-qce
```

> \[!NOTE]
> Apple Silicon (M1/M2/M3/M4) 通过 Rosetta 模拟运行，首次启动可能稍慢。详见 [Docker 部署指南][docker-doc]。

## 在导出的 HTML 里整理 Log

在 QCE 选会话并导出 HTML。打开普通 HTML 文件，或解压流式 ZIP 后打开 `index.html`，即可直接阅读和整理。查看器随导出文件生成，保留分块加载、附件、搜索和按成员、类型、日期的筛选。

导出前，可在「时间范围」选择起止日期。多个会话可通过「会话 → 批量选择 → 设置并导出」一次创建任务，每个会话会生成独立文件。

- 点击消息后按 `A` 保留、`S` 排除或 `E` 编辑。按 `Ctrl+Enter` 确认并选中下一条。下一条已经可见时，消息区保持当前位置。
- 拖选连续消息后填入章节／回合并点「归入」。触屏使用「选择范围」。也可勾选「当前整理」，让后续确认自动归类。
- 在侧栏「角色管理」改名，消息中的昵称和成稿会使用角色名。
- 在「记录管理」添加单文件 HTML、解压后的流式文件夹、JSON、JSONL、TXT 或早期 `.qcelog` 工程。选中「纳入成稿」的记录可以一起导出。消息都有时间时按时间合并，否则延续记录顺序。导入记录中的非文本内容以文字标记显示。
- 顶部可开「左右分屏」或「上下分屏」。对照窗可单独滚动，点消息可在主窗继续整理。
- 在「成稿」预览、编辑并导出。标准模板支持 TXT、Markdown 和 HTML；「朗读女」使用 `[角色]` 加换行正文；「豹骰」可导出兼容 TXT 或海豹原生 JSON，推荐用 JSON 导入[海豹染色器](https://log.weizaima.com/)。拖动浮窗标题可以改变位置。
- 「TXT 附图」默认开启，有图片时下载 ZIP，内含 TXT 和 `images/` 图片文件夹；没有图片时仍下载 TXT。本地图片若无法读取，选择对应记录的原导出文件夹即可补齐。豹骰 JSON 会内嵌图片，可一起导入染色器。
- 在成稿里点「连成一段」，选中同一窗口里要相邻的消息，再点「确认连段」。整段放在第一条的时间位置，其他消息继续按时间排。点「拆开此段」可恢复。
- 进度自动保存在当前浏览器。侧栏的「整理进度」可备份当前记录的进度，打开同一份记录即可恢复。

## 文档

[![文档](docs/images/docs-banner.png)][docs-link]

## 相关项目

[![ChatLab](docs/images/bento-chatlab.png)](https://chatlab.fun/cn)

<p><a href="https://github.com/Ruoan-486/QCE2Chatlab"><img src="docs/images/bento-qce2chatlab.png" alt="QCE2ChatLab" width="49%"></a><a href="https://github.com/CutrelyAlex/QQChatAnalyzer"><img src="docs/images/bento-qqchatanalyzer.png" alt="QQChatAnalyzer" width="49%"></a><a href="https://github.com/JUSTMONIKA2022/QQ-Chat-AI-Analyzer"><img src="docs/images/bento-qq-chat-ai-analyzer.png" alt="QQ-Chat-AI-Analyzer" width="49%"></a><a href="https://github.com/streetartist/napcat-qce-python"><img src="docs/images/bento-napcat-qce-python.png" alt="napcat-qce-python" width="49%"></a></p>

我们非常欢迎和 QCE 有关的社区项目！如果需要展示您的项目，可以在[这里](https://github.com/shuakami/qq-chat-exporter/issues/new)提一个 issue。

## 贡献者

感谢每一位让 QCE 变得更好的贡献者，也感谢 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 团队提供的框架支持。参与开发？请阅读[贡献指南](https://shuakami.github.io/qq-chat-exporter/docs/contributing.html)。

<a href="https://github.com/shuakami/qq-chat-exporter/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shuakami/qq-chat-exporter" alt="Contributors" />
</a>

## 许可证

[GPL-3.0][license-link]

<!-- LINK GROUP -->

[image-banner]: docs/images/banner.png
[docs-link]: https://shuakami.github.io/qq-chat-exporter/
[releases-link]: https://github.com/annncatto/qq-chat-exporter-log/releases
[issues-link]: https://github.com/shuakami/qq-chat-exporter/issues
[stars-link]: https://github.com/annncatto/qq-chat-exporter-log/stargazers
[license-link]: LICENSE
[docker-doc]: https://shuakami.github.io/qq-chat-exporter/docs/docker-napcat-deployment.html
[macos-doc]: https://shuakami.github.io/qq-chat-exporter/docs/macos-deploy.html
[github-release-shield]: https://img.shields.io/github/v/release/annncatto/qq-chat-exporter-log?include_prereleases&color=317cfe&labelColor=black&logo=github&style=flat-square
[github-downloads-shield]: https://img.shields.io/github/downloads/annncatto/qq-chat-exporter-log/total?color=317cfe&labelColor=black&style=flat-square
[github-stars-shield]: https://img.shields.io/github/stars/annncatto/qq-chat-exporter-log?color=317cfe&labelColor=black&style=flat-square
[github-license-shield]: https://img.shields.io/badge/license-GPL--3.0-317cfe?labelColor=black&style=flat-square
