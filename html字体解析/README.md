# FontLab · 字体表解析与编辑工具

一个纯前端（零依赖、零构建）的字体分析工具：打开 TrueType / OpenType 字体，把**每一张表**的数据解析成人类可读的形式，并为每个字段附上中文说明；修改后可以**重新保存为字体文件**。

直接用浏览器打开 `index.html` 即可使用，无需安装任何东西，所有解析与保存都在本地完成（不会上传文件）。
界面为玻璃拟态风格：渐变高光、卡片入场动画、吸顶工具栏、字形列表与检查器联动高亮等（遵循 `prefers-reduced-motion`，关闭动效偏好时自动降级）。
支持**亮色 / 暗色两套配色**，右上角按钮或按 `T` 键切换（首次访问跟随系统 `prefers-color-scheme`，选择记在 `localStorage`；`<html data-theme>` 由页面头部内联脚本提前设好，不会闪一下再换肤）。

---

## 快速开始

```bash
# 方式一：直接双击 index.html（Chrome / Edge / Firefox 均可，file:// 下也能正常预览）

# 方式二：起一个本地静态服务器（推荐；不用 file:// 才能正常做字体预览，见下）
python -m http.server 8321
# 然后访问 http://127.0.0.1:8321/index.html
```

打开后可点击右上角「打开字体」，或直接把字体文件拖到窗口里。

> 页面左上角会显示当前构建号（形如 `20260914e`）。`index.html` 里的脚本与样式都带了 `?v=<构建号>` 查询串，
> 更新代码后构建号一变，浏览器就会重新拉取，避免 `file://` 下命中旧缓存导致「改了代码但行为没变」。

> 两种方式都可用，包括直接双击 `index.html`（`file://`）。
> 预览字体是**通过 `new FontFace(family, ArrayBuffer)` 二进制源注册**的，不经过任何 `blob:` URL，
> 因此不会触发浏览器对本地文件的来源限制（`'file:' URLs are treated as unique security origins`）；
> `file://` 下导出则自动改用 `data:` URL 下载。

支持的输入格式：

| 格式 | 说明 |
| --- | --- |
| `.ttf` | TrueType（glyf 二次贝塞尔轮廓） |
| `.otf` | OpenType（CFF 三次贝塞尔轮廓） |
| `.ttc` | 字体集合，界面顶部可切换集合内的每个字体 |
| `.woff` | Web WOFF，自动解压还原（`.woff2` 不支持，需先转换） |

---

## 功能

### 1. 表结构浏览

左侧列出字体目录中的全部表（标签、中文名称、字节长度、偏移），右侧逐个解析。

> 本工具**不校验已有字体的校验和**（内部/中间态字体常常不维护它，逐个表比对只会产生无意义的告警）。
> 目录里记录的校验和值仍会展示，保存时会按实际内容重新计算并写入。

已实现结构化解析与中文说明的表：

| 类别 | 表 |
| --- | --- |
| 全局度量 | `head`、`hhea`、`vhea`、`maxp`、`OS/2`（版本 0~5，含 Panose、Unicode Range、Code Page Range 逐位解读） |
| 名称 | `name`（全部平台/编码/语言记录，附 nameID 对照表） |
| 映射 | `cmap`（格式 0/2/4/6/8/10/12/13/14，附每个子表的映射明细） |
| 轮廓 | `glyf`、`loca`（点坐标、轮廓、复合组件、提示指令长度，SVG 轮廓预览） |
| PostScript | `post`（字形名称表）、`CFF `、`CFF2`（INDEX / DICT / CharStrings / Private / FDArray） |
| 布局 | `GSUB`、`GPOS`（ScriptList → FeatureList → LookupList 三级结构、特性标签释义）、`GDEF`、`BASE` |
| 字距 | `kern`（格式 0 配对表 + 图形化添加/删除配对） |
| 提示 | `cvt `、`fpgm`、`prep`（操作码频次统计与解释）、`gasp` |
| 可变字体 | `fvar`、`avar`、`STAT` |
| 彩色/位图 | `COLR`、`CPAL`（含颜色色块）、`SVG `、`sbix`、`CBDT/CBLC/EBBDT/EBLC` |
| 其它 | `hdmx`、`LTSH`、`VDMX`、`PCLT`、`DSIG`、`meta`、`JSTF`… |
| 兜底 | 任何未收录的表都会显示表名、长度与可编辑的十六进制数据 |

每个表都有两个标签页：

* **解析视图** —— 字段表（名称 / 值 / 说明）与数据表格，数值一律附带中文解释；
* **原始数据** —— 十六进制转储，**点击任意字节即可直接修改**，适合修改本工具未提供界面的字段。

数据表格上方的筛选框会**匹配表格中的任意一列**（字符、字形名、数值都能搜），输入时实时过滤并显示「筛选命中 N / 总数 行」；
按 `Esc` 或点击「清除筛选」即可复位。左侧的表列表搜索框同时匹配表标签与中文表名（例如输入「字距」可找到 `kern`）。

### 2. 字形查看

* 「字形总览」：按 cmap 列出所有字符，网格中使用**字体本身**渲染，分页 + 搜索（按字符 / U+ 码点 / 字形名 / GID）；
  选中字形后**右侧**出现吸顶的「字形详情」（轮廓 + 轮廓数/点数/边界框/指令/长度），未选中时不占用右侧空间；
  筛选时只重绘网格本身，不重建输入框，并且**输入法组合期间（候选词未选定）不会刷新**——中文输入不会出现界面跳动或候选框丢失；
* `glyf` 表页采用**左右分栏**：左侧「字形列表」（含 GID、字符、字形名、类型、轮廓数、点数、边界框、指令字节、引用字形），右侧「字形检查器」随页面吸顶，边翻列表边看轮廓；
* 字形轮廓一律用**纯色**绘制：暗色主题白色、亮色主题黑色（`--glyph-solid`），基线/原点参考线分别为橙/绿；轮廓只受 CSS 变量控制，切换主题时不重绘 SVG；
* 字形列表的筛选框支持输入 **字符（如「我」）、字形名、`U+6211` 码点或 GID**——即使某字符没有被显示在「字符」列（同一字形映射了多个码点），也依然能被搜到；
* 字形检查器顶部的「定位字形」输入框同样可输入 **GID / 单个字符 / U+ 码点**，直接跳转；显示轮廓 SVG（含基线、原点参考线）、点坐标表（可编辑）、复合字形组件表与边界框。

### 3. 修改并重新保存

可编辑的内容：

* **任意字段**：`head` 版本号/时间/边界框、`unitsPerEm`、`OS/2` 字重字宽/嵌入权限/度量、`hhea` 度量、`maxp` 上限、`post` 角度、`name` 全部文本（含「常用名称快速编辑」）、`cmap` 码点→字形映射、`hmtx` 每个字形的宽度与承托、`kern` 调整值、`gasp`、`cvt `、`glyf` 点坐标/边界框/复合参数……
* **任意字节**：原始数据标签页。

保存时（右上角「保存为字体」或 `Ctrl+S`）：

1. 被改动的表按需**重建**：`name`、`cmap`、`post`、`hmtx`、`kern`、`gasp`、`glyf`+`loca`；
2. 自动完成一致性维护：重算 `head.indexToLocFormat`、`maxp` 轮廓/点数上限、`loca` 偏移、`head` 全局边界框、`hhea` 最大宽度/最小承托、所有表的校验和与 `head.checkSumAdjustment`；
3. 默认移除已失效的 `DSIG` 签名、并把 `cmap` 子表的 `language` 字段规范化为 0 —— 该字段已废弃，非 0 时 Chromium 的 OTS 校验会直接拒绝加载整个字体（老字体如 BELL.TTF 常见此问题），两项均可在「修改与导出」里关闭；也可选择移除 `hdmx/LTSH/VDMX` 等设备度量表；
4. 输出可下载的 `.ttf` / `.otf`，同时刷新「字体预览」（浏览器实际加载新字体来渲染，等于一次真实可用性验证）。

### 4. 主题（亮色 / 暗色）

* 所有颜色都收敛为 `css/style.css` 顶部的 CSS 变量，切换 `<html data-theme="light|dark">` 即可整体换肤；
* 两套配色的**强调色也不同**：暗色用亮蓝紫 + 深空底（适合长时间读十六进制），亮色用稍深的蓝紫 + 纸白底；
* 内联 SVG（字形轮廓、基线参考线）用 `var(--glyph-*)` / `var(--guide-*)` 上色，换主题时**不需要重绘任何内容**；
* 右上角按钮或快捷键 `T` 切换（在输入框里打字时不会误触发），亮色主题下关键文本对比度均 ≥ 4.5:1（见 `test/contrast.js`）。

### 5. 可变字体轴调节（预览）

打开的可变字体（含 `fvar` 表）会在「字体预览」里多出一块**轴控制面板**：

* 每个设计轴一行滑块：显示轴标签（`wght`/`wdth`…）、轴名（取自 name 表，如 Weight/Width）、最小值~最大值与当前值；
* `fvar` 里的**命名实例**（Named Instances）可用下拉框一键套用（如 Light → wght 350）；「回到默认值」恢复各轴默认值；
* 轴值实时生效：只改写预览样式里的 `font-variation-settings`，浏览器即时重绘，**不需要重新加载字体**，预览区、多字号示例和字形总览网格都会跟着变；
* 轴值**只影响预览**，保存输出的仍是原可变字体（不改写 `gvar`/`HVAR`）；非可变字体不会出现该面板；
* 兼容性修复（见「修改与导出」，默认开启）：`cmap.language` 归零、`maxp.maxZones` 修正为 2、
  移除长度为 0 的表——这三项都是浏览器 OTS 校验的硬性要求，不修就会被拒收（报 `Invalid font data in ArrayBuffer.`）；
* 预览始终优先用**浏览器自身的字体引擎**渲染（可变字体的轴插值也由浏览器完成）。
  只有当字体本身无法通过 OTS、且无法修复时，才退化为工具自己解析轮廓绘制（轮廓预览）。
* **轮廓模式下同样有效**：若浏览器（OTS）拒绝加载该字体，工具会退化为"轮廓预览"，此时按 `fvar → avar → gvar` 自己插值
  （含 IUP 未触及点插值），拖动轴值照样实时重画预览与字形总览；面板会显示一行「可变数据」诊断（fvar / gvar / CFF2 / avar / HVAR / MVAR / STAT 是否存在），
  缺 `gvar`/`CFF2` 时明确提示插值无法生效。

### 6. 字体预览的两种模式

预览会用**浏览器自己的字体引擎**加载保存结果（等于一次真实的可用性/合规性验证）：

* **字体模式**（默认）—— 浏览器通过 `FontFace(ArrayBuffer)` 加载，字形来自字体引擎，效果最真实；
* **轮廓模式**（自动兜底）—— 若浏览器拒绝该字体（`Invalid font data in ArrayBuffer.`，说明 Chromium 的 OTS 校验不接受这个字体），
  工具会先用**未经修改的原始字节**再试一次以区分责任：
  * 原始字体能加载 → 提示是「保存后的字节被拒绝」，并暂时回退为原始字体预览；
  * 原始字体也被拒绝 → 说明该字体**本身**不符合浏览器校验（Windows 及其他软件仍可正常使用），
    此时自动切换为轮廓模式：用本工具自己解析的 `glyf` 轮廓直接画文字（预览区与字形总览都适用）。
  * CFF（`.otf`）轮廓暂不反编译，因此这类字体在轮廓模式下无法预览，界面会明确说明原因。

> 顺带一个真实案例：`msjhl.ttc`（微软正黑体 Light）连**原始文件**都会被 Chromium 拒绝，这时"预览失败"与工具无关。

所有修改都有记录，可单条撤销或一键全部撤销（侧边栏底部）。

---

## 目录结构

```
index.html            页面结构
css/style.css         样式
js/util.js            格式化、MacRoman 编解码、表/nameID/字重等枚举与中文说明数据
js/binary.js          二进制 Reader / Builder / 字段描述 / 字节补丁
js/sfnt.js            容器层：表目录解析（TTF/OTF/TTC/WOFF）、重建与校验和
js/font.js            字体模型：字形命名、编辑记录、撤销、保存流程
js/glyf.js            轮廓解析（简单/复合字形）、SVG 路径生成、glyf/loca 重建
js/tables/*.js        各表解析器（basic / os2 / name / cmap / kern / layout / cff / misc）
js/app.js             界面逻辑（表浏览、字段与表格编辑、十六进制编辑、预览、导出）
test/                 验证脚本（Node 环境）
```

---

## 验证

`test/` 下有可直接运行的验证脚本（Node 18+，无需依赖）：

```bash
node test/syntax.js       # 前端脚本语法检查（页面白屏类问题）
node test/roundtrip.js    # 端到端：解析系统字体 → 修改 → 保存 → 重新解析校验（38 项）
node test/sections.js     # 结构校验：多字体全表解析，检查每个分区/字段的合法性
node test/otsrules.js     # 浏览器 OTS 校验规则的本地复现：22 个字体 × 各类编辑，159 项
node test/scan.js         # 扫描字体目录，找出可能被 OTS 拒绝的特征（cmap language≠0、缺必需表…）
node test/verify-out.js ./arial.edited.ttf   # 校验浏览器导出的字体文件
```

`test/sections.js` 覆盖 arial / 微软雅黑(CJK) / Bahnschrift(可变字体) / Sitka(TTC) 等字体，遍历每张表的每个分区，检查
矩阵行必须是数组、字段必须有名称与显示值、可编辑字段必须有写入位置等，用于拦截解析器回归。

`test/otsrules.js` 把浏览器 OTS（OpenType Sanitizer）真正会拒绝的规则固化成断言，覆盖
CJK / emoji / 符号字体 / 可变字体 / TTC 共 22 个字体，且每个字体都会走一遍「原样保存 + cmap/name/post/hmtx/glyf/kern 各类编辑后保存」：

* 表目录按 tag 升序、偏移 4 字节对齐、各表校验和正确、`head.checkSumAdjustment` 使整文件校验和为 `0xB1B0AFBA`；
* 必需表齐全；`maxp.numGlyphs` 与 `loca` 条目一致、`loca` 单调不减且不越出 `glyf`；
* **`cmap` 所有子表的 `language` 必须为 0**；格式 4 末段必须覆盖 `0xFFFF`、段按 `endCode` 升序；格式 12/13 的
  `length == 16 + 12×分组数` 且分组升序不重叠——这三点都是 OTS 会直接拒绝整个字体的硬性要求。

浏览器端另有一套实测（Playwright，需本地起服务）：

```bash
node test/ots.js 'C:\Windows\Fonts' 60 '.t' 24000000   # 生成素材：原始 + 重新保存后的字体
# 然后打开 http://127.0.0.1:8321/test/ots.html，页面会用 FontFace 逐个加载并对比结果
```

`test/editprobe.js`、`test/check2.js`、`test/ime.js`、`test/theme.js`、`test/contrast.js`、`test/glyphui.js`、`test/axes.js`、`test/holes.js`、`test/axisrepaint.js`、`test/gvarprobe.js`、`test/outlineaxis.js` 是注入页面的探针：`editprobe` 依次执行「改 OS/2 → 改 name →
改 cmap → 改 post → 改 kern → 改 glyf 点/边界框」，每步都刷新预览并记录浏览器是否加载成功；`check2` 检查预览模式、
复合字形轮廓、轮廓排版产物；`ime` 模拟输入法流程（`compositionstart` → 拼音 `input` → `compositionend`），
断言输入框 DOM 节点全程不被替换、组合期间网格不刷新、选词结束后才刷新；`theme` 校验主题切换（`data-theme`、
按钮文案/图标、`localStorage`、`<meta theme-color>`）与两套主题的实际取色；`contrast` 按 WCAG 公式计算
关键元素的文字/背景对比度，亮色主题下所有抽样元素均 ≥ 4.5:1；`glyphui` 校验字形轮廓为纯色（亮色 `rgb(0,0,0)`、
暗色 `rgb(255,255,255)`）以及「字形详情」确实位于网格右侧且吸顶。

---

## 已知限制

* **woff2** 未支持（Brotli + 字形变换，需要额外库）。
* `CFF` 的 CharString 只统计不反编译（不渲染 CFF 轮廓，`.otf` 的字形预览会提示查看 CFF 表）；`CFF2` 同理。
* 未解析的复杂子结构（`kern` 格式 2/3、`COLR v1` 绘制指令、`GSUB/GPOS` 各查找表的子表内部规则、AAT 表等）以概要或原始字节呈现，可用十六进制编辑。
* `name` 表写入时按记录原有编码编码，若新文本无法用该编码表示（例如往 MacRoman 记录里写中文），会以 `?` 替代并在保存结果中给出提示；跨语言名称建议放在 Windows/Unicode 平台的记录里。
* 保存 `.ttc` 时输出的是**当前正在查看的那个字体**（独立为 `.ttf`/`.otf`），不会保留集合结构。
* 修改字形轮廓后，`hdmx`/`LTSH`/`VDMX` 等设备度量表可能失配，建议在导出选项中一并移除。
