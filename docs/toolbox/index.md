# 工具箱总览

工具箱集中放置排查、维护和资源制作工具。适合在 Mod 出问题、需要处理 VPK 文件或制作喷漆时使用。

## 工具列表

<div class="tool-grid">
  <a class="tool-card" href="/toolbox/problem-mod-scan">
    <span class="tool-card-mark">01</span>
    <strong>问题 Mod 查找</strong>
    <span>按二分法逐轮缩小范围，帮助找出导致异常的 Mod。</span>
  </a>
  <a class="tool-card" href="/toolbox/conflict-check">
    <span class="tool-card-mark">02</span>
    <strong>Mod 冲突检测</strong>
    <span>扫描多个 VPK 是否覆盖了相同文件。</span>
  </a>
  <a class="tool-card" href="/toolbox/model-stats">
    <span class="tool-card-mark">03</span>
    <strong>模型面数检测</strong>
    <span>读取模型顶点和三角形数量，定位高面数资源。</span>
  </a>
  <a class="tool-card" href="/toolbox/vpk-unpack">
    <span class="tool-card-mark">04</span>
    <strong>VPK 解包</strong>
    <span>把 VPK 按内部目录结构解包到文件夹。</span>
  </a>
  <a class="tool-card" href="/toolbox/vpk-pack">
    <span class="tool-card-mark">05</span>
    <strong>VPK 打包</strong>
    <span>把 materials、scripts 等资源目录打包成 VPK。</span>
  </a>
  <a class="tool-card" href="/toolbox/mdmp-report">
    <span class="tool-card-mark">06</span>
    <strong>崩溃转储查看器</strong>
    <span>打开 .mdmp 或 .dmp，查看异常、线程和模块信息。</span>
  </a>
  <a class="tool-card" href="/toolbox/spray-tool">
    <span class="tool-card-mark">07</span>
    <strong>喷漆制作</strong>
    <span>导入图片或动画，生成 L4D2 可用的 VTF/VMT。</span>
  </a>
</div>

## 使用建议

- 游戏崩溃或报错时，先用问题 Mod 查找缩小范围。
- 怀疑两个 Mod 覆盖同一资源时，用冲突检测。
- 角色、武器或感染者模型卡顿时，用模型面数检测。
- 需要查看或修改 VPK 内容时，用解包和打包。
- 有 `.mdmp` 或 `.dmp` 文件时，用崩溃转储查看器。
- 想制作喷漆时，用喷漆制作工具。
