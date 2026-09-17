'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Package, DollarSign, Map, Layers, Building2, RefreshCw, Wifi } from 'lucide-react';
import Link from 'next/link';
import { useSalesData } from '@/contexts/SalesDataContext';

// 区位数据接口
interface LocationData {
  area: string;
  skuCount: number;
  salesQuantity: number;
  salesAmount: number;
}

// 楼层数据接口
interface FloorData {
  name: string;
  type: 'warehouse' | 'store';
  locations: LocationData[];
}

// 中类按性别时段表格组件
function SubCategoryTable({ gender, getSubCategoryGenderHourTable, loading }: { 
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
  // 获取数据，如果正在加载则返回 null
  const tableData = !loading ? getSubCategoryGenderHourTable(gender) : null;
  
  // 如果正在加载或没有数据，不渲染
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

export default function Home() {
  const { data: contextData, loading, getGlobalSkuTop10ByCategory, getSubCategoryGenderHourTable, refresh } = useSalesData();
  const [currentFloor, setCurrentFloor] = useState<string>('all'); // 当前选中楼层
  
  // 全局款号销售TOP10（按大类分组）
  const globalSkuTop10ByCategory = useMemo(() => {
    // 数据加载完成后再计算
    if (loading || contextData.length === 0) {
      return { shoes: [], clothing: [], accessories: [] };
    }
    // 直接调用按品类分组的方法
    return getGlobalSkuTop10ByCategory();
  }, [getGlobalSkuTop10ByCategory, contextData, loading]);
  
  // 将 context 数据转换为页面需要的格式
  const data = useMemo(() => contextData.map(item => ({ ...item, extra: '' })), [contextData]);

  // 楼层配置
  const floors = useMemo(() => {
    const floorData: Record<string, FloorData> = {};
    
    data.forEach((item: LocationData) => {
      const firstChar = item.area.charAt(0);
      let floorKey = firstChar;
      let floorName = '';
      let floorType: 'warehouse' | 'store' = 'warehouse';
      
      // 判断楼层
      if (/^[1-4]$/.test(firstChar)) {
        floorName = `${firstChar}F 仓库`;
        floorType = 'warehouse';
      } else if (/^[5-6]$/.test(firstChar)) {
        floorName = `${firstChar}F 卖场`;
        floorType = 'store';
      } else {
        // 其他开头归类到"其他"
        floorKey = 'other';
        floorName = '其他区域';
        floorType = 'warehouse';
      }
      
      if (!floorData[floorKey]) {
        floorData[floorKey] = { name: floorName, type: floorType, locations: [] };
      }
      floorData[floorKey].locations.push(item);
    });
    
    // 按楼层排序并返回数组
    const order = ['1', '2', '3', '4', '5', '6', 'other'];
    return order
      .filter(key => floorData[key])
      .map(key => [key, floorData[key]] as [string, FloorData]);
  }, [data]);

  // 当前楼层数据
  const currentFloorData = useMemo(() => {
    if (currentFloor === 'all') return data;
    const floor = floors.find(([key]) => key === currentFloor);
    return floor ? floor[1].locations : data;
  }, [currentFloor, floors, data]);

  // 当前楼层统计
  const floorStats = useMemo(() => {
    const totalSku = currentFloorData.reduce((sum, item) => sum + item.skuCount, 0);
    const totalQuantity = currentFloorData.reduce((sum, item) => sum + item.salesQuantity, 0);
    const totalAmount = currentFloorData.reduce((sum, item) => sum + item.salesAmount, 0);
    const activeAreas = currentFloorData.filter(item => item.salesQuantity > 0 || item.salesAmount > 0).length;
    const avgAmount = currentFloorData.length > 0 ? totalAmount / currentFloorData.length : 0;
    
    return { totalSku, totalQuantity, totalAmount, activeAreas, totalAreas: currentFloorData.length, avgAmount };
  }, [currentFloorData]);

  const formatNumber = (num: number) => {
    // 取整显示
    return Math.round(num);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">正在加载数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* 顶部工具栏 - 统一一行 */}
        <div className="flex items-center justify-between gap-2 mb-4 md:mb-6">
          {/* 左侧：标题 */}
          <h1 className="text-lg md:text-2xl font-bold text-foreground shrink-0">卖场区域透视表</h1>
          
          {/* 中间：楼层选择器 */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide flex-1 justify-center md:justify-start mx-2">
            <Button
              variant={currentFloor === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setCurrentFloor('all')}
              className="rounded-lg h-8 shrink-0 text-xs"
            >
              全部
            </Button>
            {floors.map(([key, floor]) => (
              <Button
                key={key}
                variant={currentFloor === key ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentFloor(key)}
                className="rounded-lg h-8 shrink-0 text-xs"
              >
                {floor.name.replace('F ', 'F')}
              </Button>
            ))}
          </div>
          
          {/* 右侧：功能按钮 */}
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
            <Link href="/online-sales">
              <Button variant="ghost" size="sm" className="rounded-xl gap-1 text-blue-500 hover:text-blue-600">
                <Wifi className="w-4 h-4" />
                <span className="hidden sm:inline">线上</span>
              </Button>
            </Link>
            <Link href="/layout-view">
              <Button variant="outline" size="sm" className="rounded-xl gap-1">
                <Map className="w-4 h-4" />
                <span className="hidden sm:inline">布局图</span>
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
                  <p className="text-xs md:text-sm text-muted-foreground mb-0.5 md:mb-1">区位总数</p>
                  <p className="text-lg md:text-2xl font-bold text-foreground">{formatNumber(floorStats.totalAreas)}</p>
                </div>
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-4 h-4 md:w-6 md:h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/80 backdrop-blur border-border/50">
            <CardContent className="p-3 md:pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm text-muted-foreground mb-0.5 md:mb-1">活跃区位</p>
                  <p className="text-lg md:text-2xl font-bold text-foreground">{formatNumber(floorStats.activeAreas)}</p>
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
                  <p className="text-lg md:text-2xl font-bold text-foreground">{formatNumber(floorStats.totalQuantity)}</p>
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
                  <p className="text-xs md:text-sm text-muted-foreground mb-0.5 md:mb-1">销售金额</p>
                  <p className="text-lg md:text-2xl font-bold text-foreground">¥{formatNumber(floorStats.totalAmount)}</p>
                </div>
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-amber-500/10 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 md:w-6 md:h-6 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 一二楼产出对比 */}
        <Card className="bg-card/80 backdrop-blur border-border/50 mb-4 md:mb-6">
          <CardHeader className="pb-1 md:pb-2 pt-3 md:pt-6 px-3 md:px-6">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              一二楼产出对比
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
            {(() => {
              // 计算一楼（5开头）和二楼（6开头）的销售数据
              const floor1Data = data.filter(item => item.area.startsWith('5'));
              const floor2Data = data.filter(item => item.area.startsWith('6'));
              
              const floor1Amount = floor1Data.reduce((sum, item) => sum + item.salesAmount, 0);
              const floor2Amount = floor2Data.reduce((sum, item) => sum + item.salesAmount, 0);
              const totalAmount = floor1Amount + floor2Amount;
              
              const floor1Quantity = floor1Data.reduce((sum, item) => sum + item.salesQuantity, 0);
              const floor2Quantity = floor2Data.reduce((sum, item) => sum + item.salesQuantity, 0);
              
              const floor1Percent = totalAmount > 0 ? (floor1Amount / totalAmount * 100).toFixed(1) : '0';
              const floor2Percent = totalAmount > 0 ? (floor2Amount / totalAmount * 100).toFixed(1) : '0';
              
              return (
                <div className="grid grid-cols-2 gap-4">
                  {/* 一楼 */}
                  <div className="bg-muted/30 rounded-xl p-3 md:p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs md:text-sm text-muted-foreground">一楼 (5开头)</span>
                      <Badge variant="outline" className="text-xs">{floor1Data.length} 区位</Badge>
                    </div>
                    <div className="text-lg md:text-2xl font-bold text-primary">¥{formatNumber(floor1Amount)}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{formatNumber(floor1Quantity)}件</span>
                      <Badge className="bg-primary/20 text-primary text-xs">{floor1Percent}%</Badge>
                    </div>
                    {/* 进度条 */}
                    <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${floor1Percent}%` }}
                      />
                    </div>
                  </div>
                  
                  {/* 二楼 */}
                  <div className="bg-muted/30 rounded-xl p-3 md:p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs md:text-sm text-muted-foreground">二楼 (6开头)</span>
                      <Badge variant="outline" className="text-xs">{floor2Data.length} 区位</Badge>
                    </div>
                    <div className="text-lg md:text-2xl font-bold text-blue-500">¥{formatNumber(floor2Amount)}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{formatNumber(floor2Quantity)}件</span>
                      <Badge className="bg-blue-500/20 text-blue-500 text-xs">{floor2Percent}%</Badge>
                    </div>
                    {/* 进度条 */}
                    <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${floor2Percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

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
              <div className="grid grid-cols-2 gap-2">
                {globalSkuTop10ByCategory.shoes.map((item, index) => (
                  <div 
                    key={item.styleCode}
                    className="bg-muted/30 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                  >
                    {/* 排名 */}
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mb-1 ${
                      index === 0 ? 'bg-amber-500 text-white' :
                      index === 1 ? 'bg-gray-400 text-white' :
                      index === 2 ? 'bg-amber-700 text-white' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {index + 1}
                    </div>
                    
                    {/* 图片 */}
                    <div className="aspect-square rounded-md overflow-hidden bg-muted mb-1.5 flex items-center justify-center relative">
                      {item.imageUrl ? (
                        <img 
                          src={item.imageUrl} 
                          alt={item.name || item.styleCode}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Package className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    
                    {/* 款号和品名 */}
                    <div className="font-mono text-[10px] text-muted-foreground truncate">
                      {item.styleCode}
                    </div>
                    <div className="text-[10px] font-medium truncate mb-1" title={item.name}>
                      {item.name || '-'}
                    </div>
                    
                    {/* 销售数据 */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-500">
                        ¥{formatNumber(item.salesAmount)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {Math.ceil(item.salesQuantity) || Math.round(item.salesQuantity) || 0}件
                      </span>
                    </div>
                    
                    {/* 区位 */}
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {item.locations.slice(0, 3).map(loc => (
                        <Badge key={loc} variant="outline" className="text-[8px] px-1 py-0 h-3 font-mono">
                          {loc}
                        </Badge>
                      ))}
                      {item.locations.length > 3 && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3">
                          +{item.locations.length - 3}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                {globalSkuTop10ByCategory.shoes.length === 0 && (
                  <div className="col-span-full text-center py-4 text-muted-foreground text-xs">
                    暂无销售数据
                  </div>
                )}
              </div>
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
              <div className="grid grid-cols-2 gap-2">
                {globalSkuTop10ByCategory.clothing.map((item, index) => (
                  <div 
                    key={item.styleCode}
                    className="bg-muted/30 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                  >
                    {/* 排名 */}
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mb-1 ${
                      index === 0 ? 'bg-amber-500 text-white' :
                      index === 1 ? 'bg-gray-400 text-white' :
                      index === 2 ? 'bg-amber-700 text-white' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {index + 1}
                    </div>
                    
                    {/* 图片 */}
                    <div className="aspect-square rounded-md overflow-hidden bg-muted mb-1.5 flex items-center justify-center relative">
                      {item.imageUrl ? (
                        <img 
                          src={item.imageUrl} 
                          alt={item.name || item.styleCode}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Package className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    
                    {/* 款号和品名 */}
                    <div className="font-mono text-[10px] text-muted-foreground truncate">
                      {item.styleCode}
                    </div>
                    <div className="text-[10px] font-medium truncate mb-1" title={item.name}>
                      {item.name || '-'}
                    </div>
                    
                    {/* 销售数据 */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-500">
                        ¥{formatNumber(item.salesAmount)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {Math.ceil(item.salesQuantity) || Math.round(item.salesQuantity) || 0}件
                      </span>
                    </div>
                    
                    {/* 区位 */}
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {item.locations.slice(0, 3).map(loc => (
                        <Badge key={loc} variant="outline" className="text-[8px] px-1 py-0 h-3 font-mono">
                          {loc}
                        </Badge>
                      ))}
                      {item.locations.length > 3 && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3">
                          +{item.locations.length - 3}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                {globalSkuTop10ByCategory.clothing.length === 0 && (
                  <div className="col-span-full text-center py-4 text-muted-foreground text-xs">
                    暂无销售数据
                  </div>
                )}
              </div>
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
              <div className="grid grid-cols-2 gap-2">
                {globalSkuTop10ByCategory.accessories.map((item, index) => (
                  <div 
                    key={item.styleCode}
                    className="bg-muted/30 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                  >
                    {/* 排名 */}
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mb-1 ${
                      index === 0 ? 'bg-amber-500 text-white' :
                      index === 1 ? 'bg-gray-400 text-white' :
                      index === 2 ? 'bg-amber-700 text-white' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {index + 1}
                    </div>
                    
                    {/* 图片 */}
                    <div className="aspect-square rounded-md overflow-hidden bg-muted mb-1.5 flex items-center justify-center relative">
                      {item.imageUrl ? (
                        <img 
                          src={item.imageUrl} 
                          alt={item.name || item.styleCode}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Package className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    
                    {/* 款号和品名 */}
                    <div className="font-mono text-[10px] text-muted-foreground truncate">
                      {item.styleCode}
                    </div>
                    <div className="text-[10px] font-medium truncate mb-1" title={item.name}>
                      {item.name || '-'}
                    </div>
                    
                    {/* 销售数据 */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-500">
                        ¥{formatNumber(item.salesAmount)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {Math.ceil(item.salesQuantity) || Math.round(item.salesQuantity) || 0}件
                      </span>
                    </div>
                    
                    {/* 区位 */}
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {item.locations.slice(0, 3).map(loc => (
                        <Badge key={loc} variant="outline" className="text-[8px] px-1 py-0 h-3 font-mono">
                          {loc}
                        </Badge>
                      ))}
                      {item.locations.length > 3 && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3">
                          +{item.locations.length - 3}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                {globalSkuTop10ByCategory.accessories.length === 0 && (
                  <div className="col-span-full text-center py-4 text-muted-foreground text-xs">
                    暂无销售数据
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 中类表格（男装/女装） */}
        <div className="grid grid-cols-1 gap-3 md:gap-4">
          {/* 男装中类 */}
          <SubCategoryTable 
            gender="男" 
            getSubCategoryGenderHourTable={getSubCategoryGenderHourTable}
            loading={loading}
          />
          
          {/* 女装中类 */}
          <SubCategoryTable 
            gender="女" 
            getSubCategoryGenderHourTable={getSubCategoryGenderHourTable}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
