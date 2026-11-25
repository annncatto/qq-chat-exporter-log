# Log 成稿导出

导出入口位于 HTML 查看器的「成稿」底部。只导出已保留、已纳入成稿的记录，使用整理后的正文和角色名；导出不会改动原消息或整理进度。

## 模板

| 模板 | 格式 | 内容 |
| --- | --- | --- |
| 标准 | TXT、Markdown、HTML | 保留现有排版、角色和章节／回合 |
| 朗读女 | TXT | `[角色]` 后换行写正文，正文中的括号原样保留 |
| 豹骰 | JSON、TXT | 海豹染色器可识别的消息、角色、账号和时间 |

朗读女需要在其自身的角色设置中配置对应标签和声音。本工具不生成语音或朗读女的声音配置。[朗读女角色朗读说明](https://www.443w.com/tts/?post=26)

豹骰推荐使用 JSON，导入[海豹染色器](https://log.weizaima.com/)即可继续编辑、染色。JSON 保留消息边界，正文即使包含 `<角色>:正文` 这样的行也不会被误拆。TXT 使用染色器自身的再导入格式，正文若与消息头相同，存在格式歧义。该格式不携带本工具的章节、筛选或整理进度。

## 图片

「TXT 附图」默认开启。有图片时下载 ZIP，内含一份 TXT 和 `images/` 文件夹，正文使用相对路径引用图片；无图片时仍下载 TXT。TXT 本身不能容纳二进制图片。

豹骰模板的「附图」同时作用于 TXT 和 JSON：TXT 连同图片打包，JSON 将图片内嵌在 CQ 图片码的 `url` 字段。这样染色器无需访问本机路径或已过期的 QQ 图片链接。取消勾选则只导出文字和原有图片标记。

图片按原记录读取，多份记录中的同名文件不会合并。流式文件夹导入时，会随记录保留引用到的图片文件，并在当前浏览器保存。单文件 HTML 中未内嵌的本地图片受浏览器读取权限限制；无法读取时，选择对应记录的原导出文件夹即可补齐。图片缺失时不生成不完整的压缩包。

## 维护与验证

实现位于 `qce-chunked-viewer/src/qce/`：`log-core.js` 负责文字模板，`log-media.ts` 提取图片引用，`log-export.ts` 生成成稿附件，`log-zip.mjs` 写入 ZIP。没有增加运行时依赖。修改后需构建并同步嵌入资源：

```bash
cd qce-chunked-viewer
npm run typecheck
npm test
npm run build
npm run sync
cd ../qce-v4-tool
pnpm exec playwright test e2e/html-log-export.spec.ts e2e/html-log-viewer.spec.ts --workers=1
```

兼容格式核对自海豹染色器 `2.5.5`，提交 [`71bb5c1`](https://github.com/sealdice/story-painter/tree/71bb5c1baecfceeeafac253c7e34a8d4e5b2fc72)：

- [RenderedLogImporter.ts](https://github.com/sealdice/story-painter/blob/71bb5c1baecfceeeafac253c7e34a8d4e5b2fc72/src/logManager/importers/RenderedLogImporter.ts)：TXT 消息头为 `2026/11/19 20:00:00<KP(10001)>:正文`。
- [SealDiceLogImporter.ts](https://github.com/sealdice/story-painter/blob/71bb5c1baecfceeeafac253c7e34a8d4e5b2fc72/src/logManager/importers/SealDiceLogImporter.ts)：JSON 使用顶层 `version` 和 `items`，每条保留 `nickname`、`IMUserId`、`time`、`message`、`isDice`、`commandId`。
- [msgImageFormat](https://github.com/sealdice/story-painter/blob/71bb5c1baecfceeeafac253c7e34a8d4e5b2fc72/src/utils/index.ts)：支持 `[CQ:image,file=images/0001.png,url=data:image/png;base64,...]`。

浏览器回归覆盖模板、正文不被替换、同名图片、多窗口、图片缺失补齐、流式文件夹重新打开、JSON 导入，以及原有整理操作。ZIP 由 Python 标准库独立检查 CRC 和原始图片字节。另将浏览器生成的 TXT、JSON 交给上述提交中的实际导入器解析，并用其图片格式化函数验证内嵌图片。此验证覆盖文件解析和图片标记转换；未覆盖染色器所有主题、字体或图片另存为行为。

已导出的 HTML 自带当时的查看器，不会随仓库更新自动变化。QQ 取记录依赖 NapCat；读取已有记录、整理和上述成稿导出在浏览器本地执行，不需要连接 NapCat。
