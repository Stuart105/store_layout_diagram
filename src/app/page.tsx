'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Search, TrendingUp, Package, DollarSign, BarChart3, Map, Warehouse, Store, Trophy, ArrowUpRight, ArrowDownRight, Minus, Save, Check, Layers, Building2, RefreshCw, Clock, Wifi } from 'lucide-react';
import Link from 'next/link';
import { useSalesData } from '@/contexts/SalesDataContext';

type SortField = 'area' | 'skuCount' | 'salesQuantity' | 'salesAmount';
type SortOrder = 'asc' | 'desc';

// SKU详情接口（按款号汇总，不显示尺码）
interface SkuDetail {
  styleCode: string;
  name: string;
  price: number;
  stock: number;  // 该款号所有尺码库存汇总
  salesQuantity: number;
  salesAmount: number;
  imageUrl: string;
  locationCount: number;  // 该款号出现在多少个区位
  locations: string[];  // 该款号出现在哪些区位
}

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
  const { data: contextData, loading, getLocationSkuDetails, getGlobalSkuTop10, getGlobalSkuTop10ByCategory, getSubCategoryTop10, getHourlySales, getSubCategoryGenderHourTable, updateLocationId, refresh } = useSalesData();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('salesAmount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentFloor, setCurrentFloor] = useState<string>('all'); // 当前选中楼层
  
  // 区位详情弹窗状态
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationData | null>(null);
  const [skuDetails, setSkuDetails] = useState<SkuDetail[]>([]);
  const [editingAreaId, setEditingAreaId] = useState(''); // 编辑中的区位编号
  
  // 全局款号销售TOP10（按大类分组）
  const globalSkuTop10ByCategory = useMemo(() => {
    // 数据加载完成后再计算
    if (loading || contextData.length === 0) {
      return { shoes: [], clothing: [], accessories: [] };
    }
    // 直接调用按品类分组的方法
    return getGlobalSkuTop10ByCategory();
  }, [getGlobalSkuTop10ByCategory, contextData, loading]);
  
  // 时段销售数据
  const hourlySalesData = useMemo(() => {
    if (loading) return [];
    return getHourlySales();
  }, [getHourlySales, loading]);
  
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

  // 区位分类（基于当前楼层）
  const { warehouseData, storeData } = useMemo(() => {
    const warehouse = currentFloorData.filter(item => /^[1-4]/.test(item.area));
    const store = currentFloorData.filter(item => /^[5-6]/.test(item.area));
    return { warehouseData: warehouse, storeData: store };
  }, [currentFloorData]);

  // 当前楼层统计
  const floorStats = useMemo(() => {
    const totalSku = currentFloorData.reduce((sum, item) => sum + item.skuCount, 0);
    const totalQuantity = currentFloorData.reduce((sum, item) => sum + item.salesQuantity, 0);
    const totalAmount = currentFloorData.reduce((sum, item) => sum + item.salesAmount, 0);
    const activeAreas = currentFloorData.filter(item => item.salesQuantity > 0 || item.salesAmount > 0).length;
    const avgAmount = currentFloorData.length > 0 ? totalAmount / currentFloorData.length : 0;
    
    return { totalSku, totalQuantity, totalAmount, activeAreas, totalAreas: currentFloorData.length, avgAmount };
  }, [currentFloorData]);

  // 销售排行榜（基于当前楼层）
  const topSellingAreas = useMemo(() => {
    return [...currentFloorData]
      .filter(item => item.salesAmount > 0)
      .sort((a, b) => b.salesAmount - a.salesAmount)
      .slice(0, 5);
  }, [currentFloorData]);

  // 高效区位（基于当前楼层）
  const efficientAreas = useMemo(() => {
    return [...currentFloorData]
      .filter(item => item.skuCount > 0 && item.salesAmount > 0)
      .map(item => ({ ...item, efficiency: item.salesAmount / item.skuCount }))
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 5);
  }, [currentFloorData]);

  // 仓库统计
  const warehouseStats = useMemo(() => {
    const totalSku = warehouseData.reduce((sum, item) => sum + item.skuCount, 0);
    return { totalAreas: warehouseData.length, totalSku };
  }, [warehouseData]);

  // 筛选和排序后的卖场数据
  const filteredStoreData = useMemo(() => {
    let result = [...storeData];
    
    if (searchTerm) {
      result = result.filter(item => 
        item.area.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    result.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      
      if (typeof aValue === 'string') {
        return sortOrder === 'asc' 
          ? aValue.localeCompare(bValue as string)
          : (bValue as string).localeCompare(aValue);
      }
      
      return sortOrder === 'asc' 
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });
    
    return result;
  }, [storeData, searchTerm, sortField, sortOrder]);

  // 筛选后的仓库数据
  const filteredWarehouseData = useMemo(() => {
    if (!searchTerm) return warehouseData;
    return warehouseData.filter(item => 
      item.area.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [warehouseData, searchTerm]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const formatNumber = (num: number) => {
    // 取整显示
    return Math.round(num);
  };

  // 获取销售趋势图标
  const getTrendIcon = (amount: number, avg: number) => {
    if (amount > avg * 1.2) return <ArrowUpRight className="w-4 h-4 text-green-500" />;
    if (amount < avg * 0.8) return <ArrowDownRight className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-muted-foreground" />;
  };
  
  // 点击区位打开详情
  const handleLocationClick = (item: LocationData) => {
    setSelectedLocation(item);
    setEditingAreaId(item.area);
    setShowLocationDialog(true);
    // 直接从缓存获取SKU详情，速度极快
    setSkuDetails(getLocationSkuDetails(item.area));
  };
  
  // 保存区位编号修改
  const handleSaveAreaId = () => {
    if (!selectedLocation || !editingAreaId) return;
    
    if (editingAreaId === selectedLocation.area) {
      // 没有修改，直接关闭
      setShowLocationDialog(false);
      return;
    }
    
    // 调用Context的更新方法
    const success = updateLocationId(selectedLocation.area, editingAreaId);
    
    if (success) {
      // 更新本地状态
      setSelectedLocation({ ...selectedLocation, area: editingAreaId });
      // 重新获取SKU详情
      setSkuDetails(getLocationSkuDetails(editingAreaId));
    } else {
      alert('区位编号已存在或修改失败');
    }
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

        {/* 时段产出 */}
        <Card className="bg-card/80 backdrop-blur border-border/50">
          <CardHeader className="pb-2 px-4 pt-4">
            <CardTitle className="text-base md:text-lg flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              时段产出
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {hourlySalesData.length > 0 && (
              <div className="mb-3 text-xs text-muted-foreground">
                总销售: ¥{hourlySalesData.reduce((sum, item) => sum + item.amount, 0).toLocaleString()}
              </div>
            )}
            <div className="space-y-1.5">
              {hourlySalesData.map((item) => {
                const totalAmount = hourlySalesData.reduce((sum, i) => sum + i.amount, 0);
                const percentage = totalAmount > 0 ? (item.amount / totalAmount * 100).toFixed(1) : '0';
                const maxAmount = Math.max(...hourlySalesData.map(i => i.amount), 1);
                return (
                  <div key={item.hour} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-10">{item.hour}:00</span>
                    <div className="flex-1 bg-muted/30 rounded-full h-5 overflow-hidden relative">
                      <div 
                        className="h-full bg-primary/70 rounded-full transition-all flex items-center justify-end pr-2"
                        style={{ width: `${Math.min(100, (item.amount / maxAmount) * 100)}%` }}
                      >
                        {parseFloat(percentage) >= 5 && (
                          <span className="text-[10px] font-medium text-primary-foreground">{percentage}%</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 w-20 justify-end">
                      <span className="text-xs font-mono">¥{item.amount.toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground">({percentage}%)</span>
                    </div>
                  </div>
                );
              })}
              {hourlySalesData.length === 0 && (
                <div className="text-center py-4 text-muted-foreground text-xs">
                  暂无销售数据
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 搜索栏 */}
        <Card className="bg-card/80 backdrop-blur border-border/50 mb-4 md:mb-6">
          <CardContent className="p-3 md:pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索区位编号..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 rounded-xl border-border/50 bg-background"
              />
            </div>
          </CardContent>
        </Card>

        {/* 区位分类Tab */}
        <Tabs defaultValue="store" className="space-y-3 md:space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2 h-9 md:h-10">
            <TabsTrigger value="store" className="gap-1 md:gap-2 text-xs md:text-sm">
              <Store className="w-3 h-3 md:w-4 md:h-4" />
              卖场区位 (5-6)
            </TabsTrigger>
            <TabsTrigger value="warehouse" className="gap-1 md:gap-2 text-xs md:text-sm">
              <Warehouse className="w-3 h-3 md:w-4 md:h-4" />
              仓库区位 (1-4)
            </TabsTrigger>
          </TabsList>

          {/* 卖场区位 */}
          <TabsContent value="store">
            <Card className="bg-card/80 backdrop-blur border-border/50">
              <CardContent className="p-0">
                <ScrollArea className="h-[60vh] md:h-[500px]">
                  {/* 移动端卡片列表 */}
                  <div className="md:hidden">
                    {filteredStoreData.map((item) => {
                      const efficiency = item.skuCount > 0 ? Math.round(item.salesAmount / item.skuCount) : 0;
                      return (
                        <div 
                          key={item.area}
                          className="flex items-center justify-between p-3 border-b border-border/30 active:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => handleLocationClick(item)}
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="rounded-lg font-mono text-xs">
                              {item.area}
                            </Badge>
                            {item.salesAmount > 0 && (
                              <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-xs text-muted-foreground">{item.skuCount} SKU</span>
                              <span className={`font-semibold text-sm ${item.salesQuantity < 0 ? 'text-blue-500' : ''}`}>
                                {formatNumber(item.salesQuantity)}件
                              </span>
                            </div>
                            <span className={`font-semibold ${item.salesAmount < 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                              ¥{formatNumber(item.salesAmount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* 桌面端表格 */}
                  <Table className="hidden md:table">
                    <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead 
                          className="font-semibold cursor-pointer hover:text-primary transition-colors"
                          onClick={() => handleSort('area')}
                        >
                          <div className="flex items-center gap-2">
                            区位
                            {sortField === 'area' && (
                              <span className="text-xs">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="font-semibold cursor-pointer hover:text-primary transition-colors"
                          onClick={() => handleSort('skuCount')}
                        >
                          <div className="flex items-center gap-2">
                            SKU数
                            {sortField === 'skuCount' && (
                              <span className="text-xs">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="font-semibold cursor-pointer hover:text-primary transition-colors"
                          onClick={() => handleSort('salesQuantity')}
                        >
                          <div className="flex items-center gap-2">
                            销售件数
                            {sortField === 'salesQuantity' && (
                              <span className="text-xs">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="font-semibold cursor-pointer hover:text-primary transition-colors text-right"
                          onClick={() => handleSort('salesAmount')}
                        >
                          <div className="flex items-center justify-end gap-2">
                            销售金额
                            {sortField === 'salesAmount' && (
                              <span className="text-xs">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </TableHead>
                        <TableHead className="font-semibold text-right">产出效率</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStoreData.map((item) => {
                        const efficiency = item.skuCount > 0 ? Math.round(item.salesAmount / item.skuCount) : 0;
                        return (
                          <TableRow 
                            key={item.area}
                            className="border-border/30 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => handleLocationClick(item)}
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="rounded-lg font-mono">
                                  {item.area}
                                </Badge>
                                {item.salesAmount > 0 && (
                                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="font-semibold text-foreground">{item.skuCount}</span>
                            </TableCell>
                            <TableCell>
                              <span className={`font-semibold ${item.salesQuantity < 0 ? 'text-blue-500' : 'text-foreground'}`}>
                                {formatNumber(item.salesQuantity)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={`font-semibold ${item.salesAmount < 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                                ¥{formatNumber(item.salesAmount)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm text-muted-foreground">
                                ¥{formatNumber(efficiency)}/SKU
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
            <div className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground text-right px-2">
              共 {filteredStoreData.length} 个卖场区位
            </div>
          </TabsContent>

          {/* 仓库区位 */}
          <TabsContent value="warehouse">
            <Card className="bg-card/80 backdrop-blur border-border/50">
              <CardHeader className="pb-1 md:pb-2 pt-3 md:pt-6 px-3 md:px-6">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm md:text-base">仓库区位概览</CardTitle>
                  <Badge variant="secondary" className="rounded-lg text-xs">
                    共 {warehouseStats.totalAreas} 个区位 · {formatNumber(warehouseStats.totalSku)} SKU
                  </Badge>
                </div>
                <p className="text-xs md:text-sm text-muted-foreground">仓库区位主要用于库存管理，不参与销售数据分析</p>
              </CardHeader>
              <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-3">
                  {filteredWarehouseData.map((item) => (
                    <div 
                      key={item.area}
                      className="flex flex-col items-center justify-center p-2 md:p-3 rounded-xl bg-muted/50 border border-border/30 cursor-pointer hover:bg-muted/70 transition-colors"
                      onClick={() => handleLocationClick(item)}
                    >
                      <Badge variant="outline" className="rounded-lg font-mono text-xs mb-1">
                        {item.area}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{item.skuCount} SKU</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <div className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground text-right px-2">
              共 {filteredWarehouseData.length} 个仓库区位
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* 区位详情弹窗 */}
      <Dialog open={showLocationDialog} onOpenChange={setShowLocationDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              区位详情
            </DialogTitle>
          </DialogHeader>
          {selectedLocation && (
            <div className="space-y-4 pt-4 overflow-y-auto max-h-[60vh]">
              {/* 区位编号编辑 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-sm text-muted-foreground mb-1 block">区位编号</label>
                  <Input
                    value={editingAreaId}
                    onChange={(e) => setEditingAreaId(e.target.value)}
                    placeholder="输入区位编号"
                    className="rounded-xl"
                  />
                </div>
                <Button 
                  onClick={handleSaveAreaId}
                  className="rounded-xl mt-5"
                  disabled={editingAreaId === selectedLocation.area}
                >
                  <Save className="w-4 h-4 mr-1" />
                  保存
                </Button>
              </div>
              
              {/* 销售统计 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">SKU数</div>
                  <div className="text-lg font-semibold">{selectedLocation.skuCount}</div>
                </div>
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">销售件数</div>
                  <div className={`text-lg font-semibold ${selectedLocation.salesQuantity < 0 ? 'text-blue-500' : ''}`}>
                    {formatNumber(selectedLocation.salesQuantity)}
                  </div>
                </div>
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">销售金额</div>
                  <div className={`text-lg font-semibold ${selectedLocation.salesAmount < 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                    ¥{formatNumber(selectedLocation.salesAmount)}
                  </div>
                </div>
              </div>
              
              {/* SKU列表 */}
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  SKU明细
                </h3>
                
                {skuDetails.length > 0 ? (
                  <div className="space-y-2">
                    {skuDetails.map((sku, index) => (
                      <div 
                        key={sku.styleCode || index}
                        className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors"
                      >
                        {/* 图片 */}
                        <div className="w-16 h-16 bg-muted rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
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
                            <Package className="w-8 h-8 text-muted-foreground" />
                          )}
                        </div>
                        
                        {/* 信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm mb-1">{sku.styleCode}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {sku.name || '暂无品名'}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs">
                            {sku.price > 0 && (
                              <span className="text-muted-foreground">价格: ¥{sku.price}</span>
                            )}
                            <span className="text-muted-foreground">库存: {sku.stock}</span>
                          </div>
                          {sku.locationCount > 1 && sku.locations.length > 0 && (
                            <div className="text-xs text-amber-600 mt-1">
                              多区位: {sku.locations.join('、')}
                            </div>
                          )}
                        </div>
                        
                        {/* 销售数据 */}
                        <div className="text-right flex-shrink-0">
                          <div className={`text-sm font-semibold ${sku.salesAmount < 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                            ¥{formatNumber(sku.salesAmount)}
                          </div>
                          <div className={`text-xs ${sku.salesQuantity < 0 ? 'text-blue-500' : 'text-muted-foreground'}`}>
                            {formatNumber(sku.salesQuantity)}件
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无SKU数据
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
