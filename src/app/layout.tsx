import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '卖场区域透视表',
    template: '%s | 卖场区域透视表',
  },
  description:
    '卖场区域透视表：按款号、中类、时段汇总门店销售数据，并以卖场区位可视化呈现，支持飞书多维表格实时同步。',
  keywords: [
    '卖场区域透视表',
    '门店销售',
    '区域透视',
    '安踏',
    '零售数据',
    '飞书多维表格',
  ],
  authors: [{ name: 'Stuart' }],
  openGraph: {
    title: '卖场区域透视表',
    description:
      '按款号、中类、时段汇总门店销售数据，并以卖场区位可视化呈现，支持飞书多维表格实时同步。',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
