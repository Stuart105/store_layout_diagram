// Babel 配置（从 .babelrc 迁移而来，支持按环境切换）
// - 开发模式：开启 preset-react development + react-dev-inspector 插件（点击定位组件）
// - 生产 / 静态导出：关闭 development（避免产物混入 jsxDEV，导致生产预渲染报
//   "jsxDEV is not a function"），并移除仅用于开发的 inspector 插件
const isDev = process.env.NODE_ENV === 'development';
const isStaticExport = process.env.NEXT_STATIC_EXPORT === 'true';
const useDevMode = isDev && !isStaticExport;

module.exports = {
  presets: [
    [
      'next/babel',
      {
        'preset-react': {
          development: useDevMode,
        },
      },
    ],
  ],
  plugins: useDevMode ? ['@react-dev-inspector/babel-plugin'] : [],
};
