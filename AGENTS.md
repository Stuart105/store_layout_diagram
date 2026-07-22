# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

- **项目理解加速**：初始可以依赖项目下`package.json`文件理解项目类型，如果没有或无法理解退化成阅读其他文件。
- **Hydration 错误预防**：严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。


## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 项目说明

- **概述**: 卖场区域透视表网页应用，支持数据表格查看和布局图可视化两种模式，集成飞书多维表格API，支持在线保存和加载布局配置。
- **技术栈**: Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, coze-coding-dev-sdk (对象存储备用)
- **编码规范**: Airbnb JavaScript/React 规范，使用 pnpm 包管理器

## 飞书集成说明

### 数据源
- 使用飞书多维表格作为数据源
- 以款号为键匹配销售表和区位表数据

### 布局配置存储
- 布局配置和背景图统一存储在单张布局配置表中
- 背景图优先使用飞书云文档存储（`uploadFeishuImage` API）
- 降级方案：多单元格存储（`背景图_1`, `背景图_2` 等列）

### 数据结构
- **元数据记录**（楼层ID = `__META_5F__`）：存储更新时间、存储方式、飞书图片Token
- **区位记录**（楼层ID = `5`）：存储各区位的布局信息

### 关键函数
- `uploadFeishuImage`: 上传图片到飞书云文档，获取 file_token
- `getFeishuImageAsBase64`: 下载飞书图片并转为 base64，供前端直接使用

### API 接口
- `POST /api/feishu?action=saveLayout`: 保存布局配置到飞书多维表格（已废弃）
- `GET /api/feishu?action=loadLayout&floor=5`: 加载布局配置（已废弃）
- `POST /api/feishu?action=saveLayoutToDrive`: 保存布局配置到飞书云盘（推荐）
- `POST /api/feishu?action=loadLayoutFromDrive`: 从飞书云盘加载布局配置


