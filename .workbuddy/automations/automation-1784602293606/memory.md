# 卖场看板每日刷新与部署 — 执行记忆

## 2026-07-22 08:55 (GMT+8) 执行

- 步骤 1-6 全部成功：端口 5000 无占用；route.ts / .babelrc 已禁用并恢复；环境变量已设置；
  fetch-data.ts 从飞书拉取最新数据成功（Sales 1191 / Location 2761 / Inventory 5485 条，写入 public/data/*.json）；
  `next build --webpack` 静态导出成功，out/ 完整生成（index.html + /layout-view + /online-sales + data/*.json）。
- 步骤 7 部署失败：调用 edgeone-pages deploy_folder 时 OAuth 鉴权超时
  （EDGEONE_PAGES_API_TOKEN not found within 3 minutes），edgeone-pages 连接器状态为 disconnected，
  无人值守环境无法完成浏览器登录。按步骤 8 规则停止并报告错误。
- 结论：数据刷新与静态构建均已就绪，仅 EdgeOne 上线未完成。待连接器重新授权后可重跑部署步骤。

## 注意事项
- deploy_folder 需 edgeone-pages 连接器处于 connected 且有有效 API Token；自动化 7AM 运行无人鉴权会卡住。
- 若需无人值守上线，建议改用已连接的备用通道或预先配置好 API Token 环境变量。
