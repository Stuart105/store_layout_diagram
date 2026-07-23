import * as path from 'path';
import type { NextConfig } from 'next';

// 静态导出开关：仅在构建静态部署站时（NEXT_STATIC_EXPORT=true）开启 output:'export'。
// 开发 / SSR 模式保持关闭，这样 /api/feishu 路由与飞书实时刷新仍可用。
const isStaticExport = process.env.NEXT_STATIC_EXPORT === 'true';

// GitHub Pages 部署：项目页位于 /仓库名/ 子路径，静态导出的绝对路径资源需加 basePath 修正。
// 仅 GITHUB_PAGES=true 时启用（如 GitHub Actions 构建）；EdgeOne / 本地 dev 保持空路径，不受影响。
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const gitHubRepoName = 'store_layout_diagram';

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site', 'localhost'],
  // GitHub Pages 子路径修正（默认空，不影响 EdgeOne / 本地 dev）
  ...(isGitHubPages ? { basePath: `/${gitHubRepoName}` } : {}),
  // 锁定构建追踪根目录，避免被上层误判的 lockfile 干扰
  outputFileTracingRoot: path.resolve(__dirname),
  // 静态导出：构建产物输出到 out/，不含服务端路由（飞书 API 在构建前会被临时禁用）
  ...(isStaticExport ? { output: 'export' as const } : {}),
  // 把 basePath 注入到客户端，方便 fetch 静态资源时拼出正确路径（GitHub Pages 子路径 / EdgeOne 根路径）
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? `/${gitHubRepoName}` : '',
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lf-coze-web-cdn.coze.cn',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
