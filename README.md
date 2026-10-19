# Life Progress

一个 Windows 桌面常驻人生周历：Tauri v2 + Rust + Vanilla TypeScript + 单 Canvas。
默认横向 90 列 × 52 行，也可切换为纵向 52 列 × 90 行，共 4,680 格。无 Electron、React、Vue，也不捆绑 Chromium。

## 使用

1. 启动程序，默认横向显示并居中于屏幕工作区，进入静默模式：背景完全透明、无边框、置底、鼠标点击穿透，不出现在任务栏。
2. 按 **Ctrl + Alt + L**，或左键点击系统托盘点阵图标，进入编辑。
3. 首次编辑会打开设置，输入出生日期并保存。人生尺度固定为 90 岁。
4. 悬停查看年龄、周序号和日期；点击节点编辑标题、备忘、类型及颜色。保存标记后可以继续编辑其他周。
5. **ESC**、编辑界面的「完成」或再次按快捷键：保存当前输入并恢复静默。打开批注时点击外部空白也会保存并退出。
6. 设置中可以切换横向／纵向布局和小／中／大显示比例，默认采用中档，设置跨重启保存。点阵和窗口随显示比例一起缩放，并按屏幕工作区自动适配。进入或退出编辑时，窗口大小和点阵位置保持一致。“保持屏幕居中”默认开启，启动、保存设置和返回静默时自动居中。关闭后，编辑时拖动顶部标题区域移动窗口，位置会在保存时记录。拖动边缘可调整尺寸，手动尺寸暂不持久化。
7. 右键托盘图标可以将窗口居中或保存退出。关闭窗口相当于回到静默，不会退出进程。

未配置生日时不会假设年龄，也不显示虚构的进度。清空已有标题不会删除记录，删除请使用「删除标记」。
保存失败会保留输入并停留在编辑模式。

## 数据与计算

正式数据写入 Tauri 应用数据目录，通常为：

```text
%APPDATA%\com.lifeprogress.desktop\milestones.json
```

实际路径显示在设置底部。文件包含 version、birthDate、targetAge、breathing、orientation、displayScale、centered、milestones 和 position；旧文件自动采用横向、中档显示比例、居中默认设置。
节点键为 0 到 4679，年龄从 0 到 89（横向为列，纵向为行），对应出生至 90 岁生日之间的区间。
每个生日至下一个生日固定均分为 52 格；平年的 2 月 29 日生日按 2 月 28 日处理。
因此这是每岁 52 格的可视化尺度，单格不总是精确的 7 天。剩余格数包含正在经历的本周。

每次保存会先同步临时文件，再原子替换 JSON，保留上一版 milestones.json.bak。
退出编辑时合并草稿与窗口位置，只写入一次，避免重复保存覆盖上一版备份。
读取损坏文件时不会自动覆盖。恢复按钮会另存损坏原件，有可用备份时恢复备份，否则重新设置。
数据文件上限 2MB，标题最多 120 字符，备忘最多 4,000 字符。数据不上传至网络。

Canvas 仅在日期、数据、模式或尺寸变化时重绘。呼吸光晕采用 CSS 动画，可在设置中关闭，
并遵循系统减少动画偏好；不使用逐帧重绘全部节点的循环。

## 开发与构建

需要 Node.js 24+、Rust MSVC 工具链、Visual Studio C++ Build Tools / Windows SDK 和 WebView2 Runtime。
使用 npm 提供的 Tauri CLI，不需要额外安装 cargo-tauri。

```powershell
npm install
npm run tauri dev
npm run tauri build
```

构建输出：

- 可直接启动：src-tauri/target/release/life-progress.exe
- Windows NSIS 安装包：src-tauri/target/release/bundle/nsis/

开发时也可运行 npm run dev 在浏览器预览。浏览器预览使用独立 localStorage，
提供「编辑预览」入口；穿透、托盘与全局热键仅桌面宿主提供。

## 验证

```powershell
npm test
npm run test:ui
npm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

UI 测试使用本机 Microsoft Edge；未安装 Edge 时可调整 playwright.config.ts 的浏览器配置。
测试覆盖生日与闰年边界、90 岁终点、日期区间、拾取、编辑持久化、删除、ESC 保存、
保存失败不丢输入及重试、连续编辑、防误删、呼吸动画设置、Tooltip 文本安全及键盘操作。

原生联调使用独立测试目录，不接触正式数据：

```powershell
$env:LIFE_PROGRESS_DATA_DIR = "$PWD/.qa/native"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9229"
npm run tauri dev
```

在另一个终端执行 node tests/native.mjs，以及 powershell -File tests/window-modes.ps1。
后者验证真实 Ctrl+Alt+L、Windows WS_EX_TRANSPARENT、置前状态与焦点切换。
数据目录覆盖仅在 debug 构建有效；正式版本始终使用应用数据目录。
调试端口只供上述联调使用，普通启动无需设置这两个环境变量。

## 雏形边界

- 使用 Tauri 的普通置底窗口，尚未绑定 Windows WorkerW 壁纸层；显示桌面、Explorer 重启等场景需要继续完善。
- 当前未加入开机自启、可配置快捷键、JSON 导入导出、安装包签名。
- 全局快捷键冲突时会在编辑界面提示，仍可通过托盘进入编辑。
- 呼吸动画与 WebView2 有资源开销；不保证 CPU 恒为 0% 或总内存低于 30MB。
- 窗口大小不会跨重启保留；保存位置会校正到可用显示器工作区。

### 本机发布版资源采样

2026-09-30，预热后的静默状态（未配置生日、无呼吸动画、无调试端口），5 秒短采样：
宿主工作集约 28.55 MiB；含 WebView2 的进程总私有工作集约 82.67 MiB；
按全部逻辑处理器归一化的 CPU 采样为 0.000%。这不是持续零占用保证，也不代表启用呼吸动画时的表现。
因此总内存低于 30MB 的目标尚未达到。
