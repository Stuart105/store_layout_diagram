'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TrendingUp, Package, DollarSign, Layers, Building2, RefreshCw, Wifi } from 'lucide-react';
import Link from 'next/link';
import { useSalesData } from '@/contexts/SalesDataContext';
import { Button } from '@/components/ui/button';

// SKU详情接口（按款号汇总，不显示尺码）
interface SkuDetail {
  styleCode: string;
  name: string;
  price: number;
  stock: number;
  salesQuantity: number;
  salesAmount: number;
  imageUrl: string;
  locationCount: number;
  locations: string[];
  category?: string;
}

// 中类按性别时段表格组件
function OnlineSubCategoryTable({ gender, getSubCategoryGenderHourTable, loading }: { 
  gender: '男' | '女'; 
  getSubCategoryGenderHourTable: (gender: string) => { 
    subCategories: string[]; 
    hours: number[]; 
    data: Map<string, Map<number, { amount: number; quantity: number }>>; 
    totals: Map<string, { amount: number; quantity: number }>; 
    hourTotals: Map<number, { amount: number; quantity: number }>; 
    grandTotal: { amount: number; quantity: number } 
  };
  loading: boolean;
}) {
  const tableData = !loading ? getSubCategoryGenderHourTable(gender) : null;
  
  if (loading || !tableData || tableData.subCategories.length === 0) {
    return null;
  }
  
  const { subCategories, hours, data, totals, hourTotals, grandTotal } = tableData;
  
  return (
    <Card className="bg-card/80 backdrop-blur border-border/50">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-base md:text-lg flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          {gender}装中类
          <span className="text-sm font-normal text-muted-foreground ml-2">
            总计: ¥{grandTotal.amount.toLocaleString()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left py-2 px-1 font-medium text-muted-foreground whitespace-nowrap sticky left-0 bg-card">时段</th>
              {subCategories.map(subCat => (
                <th key={subCat} className="text-right py-2 px-1 font-medium whitespace-nowrap">{subCat}</th>
              ))}
              <th className="text-right py-2 px-1 font-medium whitespace-nowrap text-primary">合计</th>
            </tr>
          </thead>
          <tbody>
            {hours.map(hour => (
              <tr key={hour} className="border-b border-border/20 hover:bg-muted/20">
                <td className="py-1.5 px-1 text-muted-foreground whitespace-nowrap sticky left-0 bg-card">{hour}:00</td>
                {subCategories.map(subCat => {
                  const hourMap = data.get(subCat);
                  const value = hourMap?.get(hour);
                  return (
                    <td key={subCat} className="text-right py-1.5 px-1 font-mono whitespace-nowrap">
                      {value && value.amount > 0 ? `¥${value.amount.toLocaleString()}` : '-'}
                    </td>
                  );
                })}
                <td className="text-right py-1.5 px-1 font-mono whitespace-nowrap font-medium text-primary">
                  ¥{hourTotals.get(hour)?.amount.toLocaleString() || 0}
                </td>
              </tr>
            ))}
            <tr className="font-bold bg-muted/30">
              <td className="py-2 px-1 whitespace-nowrap sticky left-0 bg-muted/30">累计</td>
              {subCategories.map(subCat => (
                <td key={subCat} className="text-right py-2 px-1 font-mono whitespace-nowrap text-primary">
                  ¥{totals.get(subCat)?.amount.toLocaleString() || 0}
                </td>
              ))}
              <td className="text-right py-2 px-1 font-mono whitespace-nowrap text-primary">
                ¥{grandTotal.amount.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// 格式化数字
function formatNumber(num: number): string {
  return num.toLocaleString();
}

// SKU卡片组件
function SkuCard({ sku, rank }: { sku: SkuDetail; rank: number }) {
  const [showDialog, setShowDialog] = useState(false);
  
  return (
    <>
      <div 
        className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={() => setShowDialog(true)}
      >
        {/* 排名 */}
        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          rank <= 3 ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground'
        }`}>
          {rank}
        </div>
        
        {/* 图片 */}
        <div className="w-10 h-10 bg-muted rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
          {sku.imageUrl ? (
            <img 
              src={sku.imageUrl} 
              alt={sku.name || sku.styleCode}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Package className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
        
        {/* 款号 + 品名 */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{sku.styleCode}</div>
          <div className="text-xs text-muted-foreground truncate">{sku.name || '-'}</div>
        </div>
        
        {/* 销售数据 */}
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-semibold text-amber-500">¥{Math.round(sku.salesAmount)}</div>
          <div className="text-xs text-muted-foreground">{sku.salesQuantity}件</div>
        </div>
      </div>
      
      {/* 详情弹窗 */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              {sku.styleCode}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            {/* 图片 */}
            <div className="w-full h-40 bg-muted rounded-xl overflow-hidden flex items-center justify-center">
              {sku.imageUrl ? (
                <img 
                  src={sku.imageUrl} 
                  alt={sku.name || sku.styleCode}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Package className="w-10 h-10 text-muted-foreground" />
              )}
            </div>
            
            {/* 信息 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/50 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">品名</div>
                <div className="text-sm font-medium truncate">{sku.name || '-'}</div>
              </div>
              <div className="bg-muted/50 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">价格</div>
                <div className="text-sm font-medium">¥{sku.price || '-'}</div>
              </div>
              <div className="bg-muted/50 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">库存</div>
                <div className="text-sm font-medium">{sku.stock}</div>
              </div>
              <div className="bg-muted/50 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">品类</div>
                <div className="text-sm font-medium">{sku.category || '-'}</div>
              </div>
            </div>
            
            {/* 销售数据 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-amber-500/10 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">销售金额</div>
                <div className="text-lg font-bold text-amber-500">¥{Math.round(sku.salesAmount)}</div>
              </div>
              <div className="bg-primary/10 rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">销售件数</div>
                <div className="text-lg font-bold text-primary">{sku.salesQuantity}</div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function OnlineSalesPage() {
  const { 
    loading, 
    refresh,
    getOnlineSkuTop10ByCategory,
    getOnlineSubCategoryGenderHourTable,
    getOnlineTotalStats,
  } = useSalesData();
  
  // 获取线上销售数据
  const onlineStats = useMemo(() => {
    return getOnlineTotalStats();
  }, [getOnlineTotalStats]);
  
  const top10ByCategory = useMemo(() => {
    return getOnlineSkuTop10ByCategory();
  }, [getOnlineSkuTop10ByCategory]);
  
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">正在加载线上销售数据...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between gap-2 mb-4 md:mb-6">
          <h1 className="text-lg md:text-2xl font-bold text-foreground shrink-0 flex items-center gap-2">
            <Wifi className="w-5 h-5 text-blue-500" />
            线上销售分析
          </h1>
          
          <div className="flex items-center gap-1 shrink-0">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => refresh()}
              disabled={loading}
              className="rounded-xl"
              title="刷新数据"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Link href="/">
              <Button variant="outline" size="sm" className="rounded-xl gap-1">
                <Building2 className="w-4 h-4" />
                <span className="hidden sm:inline">卖场分析</span>
              </Button>
            </Link>
          </div>
        </div>
        
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardContent className="p-3 md:pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm text-muted-foreground mb-0.5 md:mb-1">线上款号</p>
                  <p className="text-lg md:text-2xl font-bold text-foreground">{formatNumber(onlineStats.styleCodes)}</p>
                </div>
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-blue-500/10 flex items-center justify-center">
                  <Package className="w-4 h-4 md:w-6 md:h-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardContent className="p-3 md:pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm text-muted-foreground mb-0.5 md:mb-1">交易笔数</p>
                  <p className="text-lg md:text-2xl font-bold text-foreground">{formatNumber(onlineStats.count)}</p>
                </div>
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-green-500/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 md:w-6 md:h-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardContent className="p-3 md:pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm text-muted-foreground mb-0.5 md:mb-1">销售件数</p>
                  <p className="text-lg md:text-2xl font-bold text-foreground">{formatNumber(onlineStats.quantity)}</p>
                </div>
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Package className="w-4 h-4 md:w-6 md:h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardContent className="p-3 md:pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm text-muted-foreground mb-0.5 md:mb-1">销售金额</p>
                  <p className="text-lg md:text-2xl font-bold text-foreground">¥{formatNumber(onlineStats.amount)}</p>
                </div>
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-amber-500/10 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 md:w-6 md:h-6 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 鞋服配 TOP 10 - 按品类分组 */}
        <div className="grid md:grid-cols-3 gap-4 mb-4 md:mb-6">
          {/* 鞋类 TOP 10 */}
          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardHeader className="pb-1 md:pb-2 pt-3 md:pt-4 px-3 md:px-4">
              <CardTitle className="text-sm md:text-base flex items-center gap-2">
                <span className="text-lg">👟</span>
                鞋类 TOP 10
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 md:px-4 pb-3 md:pb-4">
              {top10ByCategory.shoes.length > 0 ? (
                <div className="space-y-2">
                  {top10ByCategory.shoes.map((sku, index) => (
                    <SkuCard key={sku.styleCode} sku={sku} rank={index + 1} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  暂无鞋类线上销售数据
                </div>
              )}
            </CardContent>
          </Card>

          {/* 服装 TOP 10 */}
          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardHeader className="pb-1 md:pb-2 pt-3 md:pt-4 px-3 md:px-4">
              <CardTitle className="text-sm md:text-base flex items-center gap-2">
                <span className="text-lg">👕</span>
                服装 TOP 10
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 md:px-4 pb-3 md:pb-4">
              {top10ByCategory.clothing.length > 0 ? (
                <div className="space-y-2">
                  {top10ByCategory.clothing.map((sku, index) => (
                    <SkuCard key={sku.styleCode} sku={sku} rank={index + 1} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  暂无服装线上销售数据
                </div>
              )}
            </CardContent>
          </Card>

          {/* 配件 TOP 10 */}
          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardHeader className="pb-1 md:pb-2 pt-3 md:pt-4 px-3 md:px-4">
              <CardTitle className="text-sm md:text-base flex items-center gap-2">
                <span className="text-lg">👜</span>
                配件 TOP 10
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 md:px-4 pb-3 md:pb-4">
              {top10ByCategory.accessories.length > 0 ? (
                <div className="space-y-2">
                  {top10ByCategory.accessories.map((sku, index) => (
                    <SkuCard key={sku.styleCode} sku={sku} rank={index + 1} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  暂无配件线上销售数据
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 中类交叉表 - 男装 */}
        <OnlineSubCategoryTable 
          gender="男" 
          getSubCategoryGenderHourTable={getOnlineSubCategoryGenderHourTable}
          loading={loading}
        />

        {/* 中类交叉表 - 女装 */}
        <OnlineSubCategoryTable 
          gender="女" 
          getSubCategoryGenderHourTable={getOnlineSubCategoryGenderHourTable}
          loading={loading}
        />
      </div>
    </div>
  );
}
