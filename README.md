# Life Progress

Windows 桌面人生周历：Tauri + Rust + 原生 TypeScript + 单 Canvas。
固定横向 90 列 × 52 行，共 4,680 周。保留周历、标记和桌面静默模式。

## 使用

1. 启动后窗口居中，进入静默：背景透明、无边框、置底、点击穿透，不出现在任务栏。
2. 按 **Ctrl + Alt + L** 或左键点击托盘图标进入编辑；在顶部填写出生日期，修改后自动保存。
3. 悬停查看年龄、周序号、日期及标题；点击一周编辑标题、备忘和颜色。方向键可选中节点，Enter 打开编辑。
4. 点击「保存标记」继续编辑其他周；**ESC**、「完成」或再次按快捷键保存当前输入并返回静默。
5. 拖动顶部空白区域移动窗口，拖动边缘调整尺寸。位置和尺寸仅在本次运行有效，切换模式时保持不变。
6. 右键托盘选择「保存并退出」。关闭窗口只会返回静默。

未设置生日时不显示虚构的进度。当前周以红色表示。
清空标题不会删除记录，删除请使用「删除标记」；保存失败时保留输入并停留在编辑模式。

## 数据

数据仅保存于本机，默认路径：

```text
%APPDATA%\com.lifeprogress.desktop\milestones.json
```

文件包含 `version: 2`、`birthDate` 和 `milestones`。每条标记包含 `title`、`details`、`color`，节点键为 0 至 4679。
可直接读取旧版文件，保留生日与全部标记内容；布局、缩放、位置、呼吸动画和标记类型等已移除设置不再保存。
读取不会改写文件，首次保存前会备份旧文件并写入新版格式；旧版程序不支持新版格式。

每次保存先同步临时文件，再原子替换 JSON，`milestones.json.bak` 保留上一次保存的版本。
读取损坏文件时禁止覆盖；恢复按钮会另存损坏原件，有可用备份则恢复，否则重新设置。
文件上限 2MB，标题最多 120 字符，备忘最多 4,000 字符。

每个生日至下一个生日均分为 52 格，单格不总是精确的 7 天；平年将 2 月 29 日生日按 2 月 28 日处理。
剩余格数包含本周。Canvas 在日期、数据、模式或尺寸变化时重绘，没有呼吸动画或逐帧绘制循环。

## 开发

需要 Node.js 24+、Rust MSVC 工具链、Visual Studio C++ Build Tools / Windows SDK 和 WebView2 Runtime。

```powershell
npm install
npm run tauri dev
npm run tauri build
```

开发与使用均通过 Tauri 桌面宿主，已移除独立浏览器预览。
可执行文件位于 `src-tauri/target/release/life-progress.exe`，NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`。

## 验证

```powershell
npm test
npm run test:ui
npm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

UI 测试使用 Microsoft Edge 和仅供测试的 Tauri IPC 模拟，正式程序不包含浏览器存储逻辑。
覆盖日期边界、节点拾取、编辑与删除、保存失败重试、静默模式几何稳定、旧文件迁移和备份保护。

原生联调使用独立目录：

```powershell
$env:LIFE_PROGRESS_DATA_DIR = "$PWD/.qa/native"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9229"
npm run tauri dev
```

另开终端执行 `node tests/native.mjs` 和 `powershell -File tests/window-modes.ps1`。
后者测试真实快捷键、点击穿透、置顶和焦点；运行时应只有一个 Life Progress 实例。
数据目录覆盖仅在 debug 构建有效，正式版始终使用应用数据目录。

## 边界

使用普通置底窗口，尚未绑定 Windows WorkerW 壁纸层；显示桌面或 Explorer 重启可能影响显示。
快捷键冲突时可通过托盘进入编辑。没有开机自启、导入导出或安装包签名。
