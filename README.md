# Cebu Trip Map

一个用于查看和编辑 Cebu 行程的单页旅行地图。

项目把行程日期、时间安排、地点、路线和地图整合在同一个页面里，适合自己维护旅行计划，也适合在出发前快速查看每天的移动路线。

## 功能

- 按日期查看每日行程
- 在地图上展示地点、路线和交通方式
- 支持编辑时间安排、地点和路线
- 总览页支持折叠地点和路线面板
- 左侧信息栏支持拖拽拉宽拉窄
- 侧栏变窄时自动切换为紧凑布局
- 地图会根据当天内容自动缩放
- `2026-09-28` 这一天会使用更近一级的地图缩放

## 项目结构

```text
index.html
assets/
  app.js
  styles.css
```

- [index.html](E:\cebu-trip-main\cebu-trip-main\index.html): 页面结构和第三方脚本引入
- [assets/app.js](E:\cebu-trip-main\cebu-trip-main\assets\app.js): 数据加载、渲染、编辑、地图逻辑
- [assets/styles.css](E:\cebu-trip-main\cebu-trip-main\assets\styles.css): 页面样式、响应式布局、地图标注样式

## 技术栈

- 原生 HTML / CSS / JavaScript
- [Leaflet](https://leafletjs.com/) 地图组件
- [OpenStreetMap](https://www.openstreetmap.org/) 底图
- [Supabase](https://supabase.com/) 作为行程数据来源和编辑接口

## 如何打开

这是一个纯前端页面，不需要打包。

最简单的方法：

1. 进入项目目录
2. 启动一个本地静态服务
3. 用浏览器打开对应地址

例如使用 Python：

```bash
python -m http.server 4173
```

然后打开：

[http://127.0.0.1:4173/](http://127.0.0.1:4173/)

也可以直接双击 `index.html`，但更推荐本地服务方式，调试会更稳定。

## 数据来源

页面启动后会从 Supabase 拉取这几张表的数据：

- `days`
- `day_times`
- `places`
- `segments`

读取逻辑在 [assets/app.js](E:\cebu-trip-main\cebu-trip-main\assets\app.js:224)。

编辑操作会通过 Supabase Edge Function `trip-edit` 提交，相关逻辑在 [assets/app.js](E:\cebu-trip-main\cebu-trip-main\assets\app.js:265)。

## 编辑说明

- 页面默认是查看模式
- 点击左上角编辑按钮后输入密码，可以进入编辑模式
- 编辑模式下可以修改：
  - 每日备注
  - 时间安排
  - 地点
  - 路线
- 部分航班路线是前端内置的虚拟数据，不参与普通编辑

## 地图行为

- 非总览页会在地图上显示地点名称标签
- 地点标签会根据文字内容自动调整宽度
- 地图会根据路线和地点自动 `fitBounds`
- 为避免标签被裁切，地图四周会额外预留边距
- `2026-09-28` 会使用更高的最大缩放级别，方便查看 Sumilon 一带

相关逻辑可见：

- [assets/app.js](E:\cebu-trip-main\cebu-trip-main\assets\app.js:1071)
- [assets/app.js](E:\cebu-trip-main\cebu-trip-main\assets\app.js:1100)

## 侧栏拖拽

桌面端支持拖拽左侧信息栏右边缘的分隔条。

- 可以拉宽侧栏，方便编辑内容
- 可以拉窄侧栏，查看更多地图
- 拖拽宽度会保存到浏览器本地，下次打开会沿用
- 当侧栏变窄时，会自动切换成紧凑布局，避免内容溢出
- 移动端保留原来的侧滑面板，不启用拖拽

相关逻辑可见：

- [assets/app.js](E:\cebu-trip-main\cebu-trip-main\assets\app.js:84)
- [assets/app.js](E:\cebu-trip-main\cebu-trip-main\assets\app.js:99)
- [assets/styles.css](E:\cebu-trip-main\cebu-trip-main\assets\styles.css:33)

## 已知注意事项

- 目前项目直接在前端写入了 Supabase 地址和 publishable key
- 页面文案里有一部分历史编码问题，个别中文会显示异常
- 地图路线依赖在线服务，请确保网络可用
- 这是一个单文件风格项目，适合快速维护，但后续如果功能继续增加，建议拆分模块

## 后续可改进方向

- 把 Supabase 配置改成环境变量或独立配置文件
- 修正文案编码问题
- 增加 README 截图
- 增加导出行程或分享视图
- 为不同日期提供更细的地图缩放策略

