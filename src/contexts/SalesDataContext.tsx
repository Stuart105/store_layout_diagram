'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface SalesData {
  area: string;
  skuCount: number;
  salesQuantity: number;
  salesAmount: number;
}

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
  category?: string;  // 大类：鞋/服装/配饰
}

// 库存数据接口（按款号汇总）
interface InventoryItem {
  styleCode: string;
  name: string;
  price: number;
  stock: number;  // 该款号所有尺码库存汇总
  imageUrl: string;
  category?: string;  // 大类：鞋/服装/配饰
}

interface SalesDataContextType {
  data: SalesData[];
  dataMap: Map<string, SalesData>;
  loading: boolean;
  lastFetchTime: number | null;
  refresh: () => Promise<void>;
  // 新增：获取区位SKU详情（从缓存中获取，速度极快）
  getLocationSkuDetails: (locationId: string) => SkuDetail[];
  // 新增：获取全局款号销售TOP10
  getGlobalSkuTop10: () => SkuDetail[];
  // 新增：按品类获取TOP10（鞋/服装/配件各10个）
  getGlobalSkuTop10ByCategory: () => { shoes: SkuDetail[]; clothing: SkuDetail[]; accessories: SkuDetail[] };
  // 新增：获取中类销售TOP10
  getSubCategoryTop10: () => { name: string; amount: number; quantity: number }[];
  // 新增：获取时段销售数据
  getHourlySales: () => { hour: number; amount: number; quantity: number }[];
  // 新增：获取中类+性别+时段三维数据表格
  getSubCategoryGenderHourTable: (gender: string) => { 
    subCategories: string[]; 
    hours: number[]; 
    data: Map<string, Map<number, { amount: number; quantity: number }>>; 
    totals: Map<string, { amount: number; quantity: number }>;
    hourTotals: Map<number, { amount: number; quantity: number }>;
    grandTotal: { amount: number; quantity: number };
  };
  // 新增：更新区位编号
  updateLocationId: (oldId: string, newId: string) => boolean;
  // ===== 线上销售数据 =====
  getOnlineSkuTop10ByCategory: () => { shoes: SkuDetail[]; clothing: SkuDetail[]; accessories: SkuDetail[] };
  getOnlineHourlySales: () => { hour: number; amount: number; quantity: number; count: number }[];
  getOnlineSubCategoryGenderHourTable: (gender: string) => { 
    subCategories: string[]; 
    hours: number[]; 
    data: Map<string, Map<number, { amount: number; quantity: number }>>; 
    totals: Map<string, { amount: number; quantity: number }>;
    hourTotals: Map<number, { amount: number; quantity: number }>;
    grandTotal: { amount: number; quantity: number };
  };
  getOnlineTotalStats: () => { amount: number; quantity: number; count: number; styleCodes: number };
}

const SalesDataContext = createContext<SalesDataContextType | null>(null);

// 缓存时间：5分钟
const CACHE_TTL = 5 * 60 * 1000;

// 清理字段值（去掉 ="xxx" 格式的前缀和引号）
const cleanFieldValue = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    // 去掉 ="xxx" 格式
    if (value.startsWith('="') && value.endsWith('"')) {
      return value.slice(2, -1);
    }
    return value;
  }
  return String(value);
};

export function SalesDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SalesData[]>([]);
  const [dataMap, setDataMap] = useState<Map<string, SalesData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  
  // 新增：缓存数据
  const [inventoryMap, setInventoryMap] = useState<Map<string, InventoryItem>>(new Map());
  const [locationStyleCodesMap, setLocationStyleCodesMap] = useState<Map<string, string[]>>(new Map());
  const [salesByStyleCode, setSalesByStyleCode] = useState<Map<string, { quantity: number; amount: number }>>(new Map());
  // 款号到品类的映射（从销售表获取）
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(new Map());
  // 款号出现的区位数量（用于计算平均销售）
  const [styleCodeLocationCount, setStyleCodeLocationCount] = useState<Record<string, number>>({});
  // 款号对应的区位列表
  const [styleCodeLocations, setStyleCodeLocations] = useState<Record<string, string[]>>({});
  // 中类销售数据
  const [subCategorySales, setSubCategorySales] = useState<Record<string, { quantity: number; amount: number; count: number }>>({});
  // 时段销售数据
  const [hourlySales, setHourlySales] = useState<Record<number, { quantity: number; amount: number; count: number }>>({});
  // 中类+性别+时段三维数据 key: "中类|性别|时段"
  const [subCategoryGenderHour, setSubCategoryGenderHour] = useState<Record<string, { quantity: number; amount: number }>>({});
  
  // ===== 线上销售数据 =====
  const [onlineSalesByStyleCode, setOnlineSalesByStyleCode] = useState<Record<string, { quantity: number; amount: number; count: number }>>({});
  const [onlineSalesBySubCategory, setOnlineSalesBySubCategory] = useState<Record<string, { quantity: number; amount: number; count: number }>>({});
  const [onlineSalesByHour, setOnlineSalesByHour] = useState<Record<number, { quantity: number; amount: number; count: number }>>({});
  const [onlineSubCategoryGenderHour, setOnlineSubCategoryGenderHour] = useState<Record<string, { quantity: number; amount: number }>>({});
  const [onlineCategoryMap, setOnlineCategoryMap] = useState<Map<string, string>>(new Map());

  const fetchData = async (forceRefresh = false) => {
    // 检查是否需要刷新（超过5分钟或强制刷新）
    const shouldRefresh = forceRefresh || 
      !lastFetchTime || 
      Date.now() - lastFetchTime > CACHE_TTL;
    
    // 尝试从 localStorage 恢复 locationStyleCodesMap
    if (!shouldRefresh && data.length > 0) {
      try {
        const savedMapStr = localStorage.getItem('locationStyleCodesMap');
        if (savedMapStr) {
          const savedMapObj = JSON.parse(savedMapStr) as Record<string, string[]>;
          const locMap = new Map<string, string[]>();
          Object.entries(savedMapObj).forEach(([key, value]) => {
            locMap.set(key, value);
          });
          setLocationStyleCodesMap(locMap);
        }
      } catch (e) {
        console.error('恢复区位款号映射失败:', e);
      }
      return;
    }

    try {
      // 并行获取所有需要的数据
      // 静态部署模式：始终从本地 /data/*.json 读取预取数据。
      // 部署到 EdgeOne 后是纯静态站，没有 /api/feishu 路由，因此即使点击刷新也只重载已烘焙的静态数据；
      // 最新数据由定时任务（fetch-data.ts + 重新构建部署）推送到 out/。
      // 注意：GitHub Pages 项目页位于 /store_layout_diagram/ 子路径，需把 basePath 拼到 fetch URL 前缀。
      const isStatic = process.env.NEXT_PUBLIC_STATIC_MODE === 'true';
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const dataUrl = (name: string) => `${basePath}/data/${name}.json`;
      const [matchRes, inventoryRes, locationRes, salesRes] = await Promise.all(
        isStatic
          ? [
              fetch(dataUrl('match')),
              fetch(dataUrl('inventory')),
              fetch(dataUrl('location')),
              fetch(dataUrl('sales')),
            ]
          : [
              fetch(`/api/feishu?action=match${forceRefresh ? '&force=true' : ''}`),
              fetch('/api/feishu?action=records&tableId=tbl9hrCakoLZfa7N'), // 库存表
              fetch('/api/feishu?action=records&tableId=tbl8f2AUadoiVnuL'), // 区位表
              fetch('/api/feishu?action=records&tableId=tbl6ACKuTrBFsBOP'), // 销售表
            ]
      );

      const matchResult = await matchRes.json();
      const inventoryResult = await inventoryRes.json();
      const locationResult = await locationRes.json();
      const salesResult = await salesRes.json();

      if (matchResult.code === 0 && matchResult.data?.locations) {
        const parsedData: SalesData[] = matchResult.data.locations.map((loc: any) => ({
          area: loc.id,
          skuCount: loc.styleCodes?.length || 0,
          salesQuantity: loc.salesQuantity || 0,
          salesAmount: loc.salesAmount || 0,
        }));
        
        const newDataMap = new Map<string, SalesData>();
        parsedData.forEach(item => {
          newDataMap.set(item.area, item);
        });
        
        setData(parsedData);
        setDataMap(newDataMap);
        
        // 从后端返回的 locations 数据中提取 styleCodes 填充到 locationStyleCodesMap
        const locStyleCodesMap = new Map<string, string[]>();
        matchResult.data.locations.forEach((loc: any) => {
          if (loc.styleCodes && loc.styleCodes.length > 0) {
            locStyleCodesMap.set(loc.id, loc.styleCodes);
          }
        });
        setLocationStyleCodesMap(locStyleCodesMap);
        // 持久化到 localStorage
        try {
          const locMapObj: Record<string, string[]> = {};
          locStyleCodesMap.forEach((value, key) => {
            locMapObj[key] = value;
          });
          localStorage.setItem('locationStyleCodesMap', JSON.stringify(locMapObj));
        } catch (e) {
          console.error('保存区位款号映射失败:', e);
        }
        
        // 保存款号区位数量和区位列表（用于计算平均销售和多区位标注）
        if (matchResult.data.styleCodeLocationCount) {
          setStyleCodeLocationCount(matchResult.data.styleCodeLocationCount);
        }
        if (matchResult.data.styleCodeLocations) {
          setStyleCodeLocations(matchResult.data.styleCodeLocations);
        }
        // 保存中类销售数据
        if (matchResult.data.subCategorySales) {
          setSubCategorySales(matchResult.data.subCategorySales);
        }
        // 保存时段销售数据
        if (matchResult.data.hourlySales) {
          setHourlySales(matchResult.data.hourlySales);
        }
        // 保存中类+性别+时段三维数据
        if (matchResult.data.subCategoryGenderHour) {
          setSubCategoryGenderHour(matchResult.data.subCategoryGenderHour);
        }
        // 保存款号到品类的映射
        if (matchResult.data.styleCodeCategory) {
          const catMap = new Map<string, string>();
          Object.entries(matchResult.data.styleCodeCategory).forEach(([styleCode, category]) => {
            catMap.set(styleCode, category as string);
          });
          setCategoryMap(catMap);
        }
        
        // 保存线上销售数据
        if (matchResult.data.onlineSales) {
          if (matchResult.data.onlineSales.byStyleCode) {
            setOnlineSalesByStyleCode(matchResult.data.onlineSales.byStyleCode);
          }
          if (matchResult.data.onlineSales.bySubCategory) {
            setOnlineSalesBySubCategory(matchResult.data.onlineSales.bySubCategory);
          }
          if (matchResult.data.onlineSales.byHour) {
            setOnlineSalesByHour(matchResult.data.onlineSales.byHour);
          }
          if (matchResult.data.onlineSales.bySubCategoryGenderHour) {
            setOnlineSubCategoryGenderHour(matchResult.data.onlineSales.bySubCategoryGenderHour);
          }
          if (matchResult.data.onlineSales.styleCodeCategory) {
            const onlineCatMap = new Map<string, string>();
            Object.entries(matchResult.data.onlineSales.styleCodeCategory).forEach(([styleCode, category]) => {
              onlineCatMap.set(styleCode, category as string);
            });
            setOnlineCategoryMap(onlineCatMap);
          }
        }
      }

      // 处理库存数据（以款号为键，汇总所有尺码的库存）
      if (inventoryResult.code === 0 && inventoryResult.data?.items) {
        const invMap = new Map<string, InventoryItem>();
        
        // 第一步：汇总所有库存
        const stockSumMap = new Map<string, number>();
        const firstRecordMap = new Map<string, any>(); // 存储第一条记录的信息
        
        inventoryResult.data.items.forEach((record: any) => {
          const fields = record.fields || {};
          const styleCode = cleanFieldValue(fields['款号']);
          const stock = parseInt(cleanFieldValue(fields['库存'])) || 0;
          
          if (styleCode) {
            // 汇总库存
            stockSumMap.set(styleCode, (stockSumMap.get(styleCode) || 0) + stock);
            
            // 记录第一条记录的信息（品名、价格、图片）
            if (!firstRecordMap.has(styleCode)) {
              firstRecordMap.set(styleCode, fields);
            }
          }
        });
        
        // 第二步：创建InventoryItem
        stockSumMap.forEach((totalStock, styleCode) => {
          const fields = firstRecordMap.get(styleCode);
          const imageUrl = cleanFieldValue(fields['图片链接']);
          invMap.set(styleCode, {
            styleCode,
            name: cleanFieldValue(fields['品名']),
            price: parseFloat(cleanFieldValue(fields['价格'])) || 0,
            stock: totalStock,
            imageUrl: imageUrl && !imageUrl.startsWith('http') 
              ? `https://ncnefidnowjl.feishu.cn${imageUrl}` 
              : imageUrl,
            category: '', // 品类从销售表获取
          });
        });
        
        setInventoryMap(invMap);
      }

      // 处理销售数据（款号 -> 销售汇总），同时获取品类信息）
      if (salesResult.code === 0 && salesResult.data?.items) {
        const salesMap = new Map<string, { quantity: number; amount: number }>();
        const categoryMap = new Map<string, string>();
        
        salesResult.data.items.forEach((record: any) => {
          const fields = record.fields || {};
          const styleCode = cleanFieldValue(fields['款号']);
          const quantity = parseInt(cleanFieldValue(fields['数量'])) || 0;
          // 尝试多个可能的金额字段名
          const amount = parseInt(cleanFieldValue(fields['成交金额 (1)'])) || 
                         parseInt(cleanFieldValue(fields['成交金额（1）'])) ||
                         parseInt(cleanFieldValue(fields['成交金额'])) || 0;
          // 获取品类信息（从销售表的"款号.大类.属性描述"字段）
          const category = cleanFieldValue(fields['款号.大类.属性描述']) || '';
          
          // 排除线上销售（手工改价/手动改价="Y"），与后端 /api/feishu?action=match 口径保持一致
          const manualChangePrice = cleanFieldValue(fields['手工改价']) || cleanFieldValue(fields['手动改价']);
          if (manualChangePrice === 'Y') return;
          
          if (styleCode) {
            const existing = salesMap.get(styleCode) || { quantity: 0, amount: 0 };
            existing.quantity += quantity;
            existing.amount += amount;
            salesMap.set(styleCode, existing);
            
            // 只保存第一个遇到的品类（避免重复）
            if (category && !categoryMap.has(styleCode)) {
              categoryMap.set(styleCode, category);
            }
          }
        });
        setSalesByStyleCode(salesMap);
        setCategoryMap(categoryMap);
        
        // 同时更新库存数据中的品类信息（从销售表获取）
        setInventoryMap(prev => {
          const newMap = new Map(prev);
          categoryMap.forEach((cat, styleCode) => {
            const existing = newMap.get(styleCode);
            if (existing) {
              newMap.set(styleCode, { ...existing, category: cat });
            }
          });
          return newMap;
        });
      }

      setLastFetchTime(Date.now());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // 从缓存中获取区位SKU详情
  const getLocationSkuDetails = (locationId: string): SkuDetail[] => {
    const styleCodes: string[] = [];
    
    // 查找匹配的区位（支持模糊匹配）
    for (const [locId, codes] of locationStyleCodesMap.entries()) {
      if (locId === locationId || locId.startsWith(locationId) || locationId.startsWith(locId)) {
        codes.forEach(code => {
          if (!styleCodes.includes(code)) {
            styleCodes.push(code);
          }
        });
      }
    }
    
    // 组装SKU详情并按销售数量倒序排列
    return styleCodes.map(styleCode => {
      const inventory = inventoryMap.get(styleCode) || { name: '', price: 0, stock: 0, imageUrl: '' };
      const sales = salesByStyleCode.get(styleCode) || { quantity: 0, amount: 0 };
      const locationCount = styleCodeLocationCount[styleCode] || 1;
      const allLocations = styleCodeLocations[styleCode] || [];
      
      // 只显示卖场区位（5或6开头）
      const storeLocations = allLocations.filter(loc => loc.startsWith('5') || loc.startsWith('6'));
      const storeLocationCount = storeLocations.length || 1;
      
      // 按卖场区位数量平均分摊销售数据，并取整
      const avgQuantity = Math.round(sales.quantity / storeLocationCount);
      const avgAmount = Math.round(sales.amount / storeLocationCount);
      
      return {
        styleCode,
        name: inventory.name,
        price: inventory.price,
        stock: inventory.stock,
        salesQuantity: avgQuantity,
        salesAmount: avgAmount,
        imageUrl: inventory.imageUrl,
        locationCount: storeLocationCount,
        locations: storeLocations,
      };
    }).sort((a, b) => b.salesQuantity - a.salesQuantity);
  };

  // 获取全局款号销售排行（按品类分别返回TOP10）
  const getGlobalSkuTop10ByCategory = (): { shoes: SkuDetail[]; clothing: SkuDetail[]; accessories: SkuDetail[] } => {
    const allItems: SkuDetail[] = [];
    
    // 遍历所有款号的销售数据
    salesByStyleCode.forEach((sales, styleCode) => {
      const inventory = inventoryMap.get(styleCode) || { name: '', price: 0, stock: 0, imageUrl: '', category: '' };
      const locationCount = styleCodeLocationCount[styleCode] || 1;
      const allLocations = styleCodeLocations[styleCode] || [];
      
      // 优先从 categoryMap 获取品类（销售表），其次从 inventory 获取（库存表）
      const category = categoryMap.get(styleCode) || inventory.category || '';
      
      // 只显示卖场区位（5或6开头）
      const storeLocations = allLocations.filter(loc => loc.startsWith('5') || loc.startsWith('6'));
      
      allItems.push({
        styleCode,
        name: inventory.name,
        price: inventory.price,
        stock: inventory.stock,
        salesQuantity: sales.quantity,
        salesAmount: sales.amount,
        imageUrl: inventory.imageUrl,
        locationCount: storeLocations.length,
        locations: storeLocations,
        category: category,
      });
    });
    
    // 按销售额降序排列
    const sortedItems = allItems
      .filter(item => item.salesAmount > 0 || item.salesQuantity > 0)
      .sort((a, b) => b.salesAmount - a.salesAmount);
    
    // 按品类分组，各取TOP10
    const shoes = sortedItems.filter(i => i.category === '鞋').slice(0, 10);
    const clothing = sortedItems.filter(i => i.category === '服装').slice(0, 10);
    const accessories = sortedItems.filter(i => i.category === '配件').slice(0, 10);
    
    return { shoes, clothing, accessories };
  };

  // 获取全局款号销售排行（按款号汇总，不按区位分摊）
  // 返回足够的数据量，由调用方按品类分组筛选各品类的TOP10
  const getGlobalSkuTop10 = (): SkuDetail[] => {
    const result: SkuDetail[] = [];
    const categories = new Set<string>();
    
    // 遍历所有款号的销售数据
    salesByStyleCode.forEach((sales, styleCode) => {
      const inventory = inventoryMap.get(styleCode) || { name: '', price: 0, stock: 0, imageUrl: '', category: '' };
      const locationCount = styleCodeLocationCount[styleCode] || 1;
      const allLocations = styleCodeLocations[styleCode] || [];
      
      // 优先从 categoryMap 获取品类（销售表），其次从 inventory 获取（库存表）
      const category = categoryMap.get(styleCode) || inventory.category || '';
      
      // 收集所有不重复的 category
      if (category) {
        categories.add(category);
      }
      
      // 只显示卖场区位（5或6开头）
      const storeLocations = allLocations.filter(loc => loc.startsWith('5') || loc.startsWith('6'));
      
      result.push({
        styleCode,
        name: inventory.name,
        price: inventory.price,
        stock: inventory.stock,
        salesQuantity: sales.quantity,
        salesAmount: sales.amount,
        imageUrl: inventory.imageUrl,
        locationCount: storeLocations.length,
        locations: storeLocations,
        category: category,
      });
    });
    
    // 按销售额降序排列，取足够多的数据（每个品类10个，3个品类共30个）
    const sortedResult = result
      .filter(item => item.salesAmount > 0 || item.salesQuantity > 0)
      .sort((a, b) => b.salesAmount - a.salesAmount);
    
    return sortedResult.slice(0, 50);
  };

  // 获取中类销售TOP10
  const getSubCategoryTop10 = (): { name: string; amount: number; quantity: number }[] => {
    const result: { name: string; amount: number; quantity: number }[] = [];
    
    Object.entries(subCategorySales).forEach(([name, data]) => {
      if (data.amount > 0) {
        result.push({
          name,
          amount: data.amount,
          quantity: data.quantity,
        });
      }
    });
    
    // 按销售额降序排列，取TOP10
    return result.sort((a, b) => b.amount - a.amount).slice(0, 10);
  };

  // 获取时段销售数据
  const getHourlySales = (): { hour: number; amount: number; quantity: number }[] => {
    const result: { hour: number; amount: number; quantity: number }[] = [];
    
    // 初始化所有时段（8点到22点）
    for (let h = 8; h <= 22; h++) {
      const data = hourlySales[h] || { quantity: 0, amount: 0 };
      result.push({
        hour: h,
        amount: data.amount,
        quantity: data.quantity,
      });
    }
    
    return result;
  };

  // 获取中类+性别+时段三维数据表格
  const getSubCategoryGenderHourTable = (gender: string): { 
    subCategories: string[]; 
    hours: number[]; 
    data: Map<string, Map<number, { amount: number; quantity: number }>>;
    totals: Map<string, { amount: number; quantity: number }>;
    hourTotals: Map<number, { amount: number; quantity: number }>;
    grandTotal: { amount: number; quantity: number };
  } => {
    const subCategories = new Set<string>();
    const hours = new Set<number>();
    const dataMap = new Map<string, Map<number, { amount: number; quantity: number }>>();
    
    // 解析三维数据
    Object.entries(subCategoryGenderHour).forEach(([key, value]) => {
      const [subCategory, g, hourStr] = key.split('|');
      if (g === gender) {
        subCategories.add(subCategory);
        hours.add(parseInt(hourStr, 10));
        
        if (!dataMap.has(subCategory)) {
          dataMap.set(subCategory, new Map());
        }
        dataMap.get(subCategory)!.set(parseInt(hourStr, 10), {
          amount: value.amount,
          quantity: value.quantity,
        });
      }
    });
    
    // 计算各中类累计
    const totals = new Map<string, { amount: number; quantity: number }>();
    dataMap.forEach((hourData, subCategory) => {
      let totalAmount = 0;
      let totalQuantity = 0;
      hourData.forEach(d => {
        totalAmount += d.amount;
        totalQuantity += d.quantity;
      });
      totals.set(subCategory, { amount: totalAmount, quantity: totalQuantity });
    });
    
    // 计算各时段累计
    const hourTotals = new Map<number, { amount: number; quantity: number }>();
    const sortedHours = Array.from(hours).sort((a, b) => a - b);
    sortedHours.forEach(h => {
      let totalAmount = 0;
      let totalQuantity = 0;
      dataMap.forEach(hourData => {
        const d = hourData.get(h);
        if (d) {
          totalAmount += d.amount;
          totalQuantity += d.quantity;
        }
      });
      hourTotals.set(h, { amount: totalAmount, quantity: totalQuantity });
    });
    
    // 计算总计
    let grandTotalAmount = 0;
    let grandTotalQuantity = 0;
    totals.forEach(t => {
      grandTotalAmount += t.amount;
      grandTotalQuantity += t.quantity;
    });
    
    return {
      subCategories: Array.from(subCategories).sort((a, b) => (totals.get(b)?.amount || 0) - (totals.get(a)?.amount || 0)),
      hours: sortedHours,
      data: dataMap,
      totals,
      hourTotals,
      grandTotal: { amount: grandTotalAmount, quantity: grandTotalQuantity },
    };
  };

  // 更新区位编号
  const updateLocationId = (oldId: string, newId: string): boolean => {
    if (!newId || newId === oldId) return false;
    
    // 检查新ID是否已存在
    if (dataMap.has(newId)) return false;
    
    // 更新 dataMap
    const locationData = dataMap.get(oldId);
    if (!locationData) return false;
    
    const newDataMap = new Map(dataMap);
    newDataMap.delete(oldId);
    newDataMap.set(newId, { ...locationData, area: newId });
    setDataMap(newDataMap);
    
    // 更新 data
    setData(prev => prev.map(item => 
      item.area === oldId ? { ...item, area: newId } : item
    ));
    
    // 更新 locationStyleCodesMap
    const styleCodes = locationStyleCodesMap.get(oldId);
    if (styleCodes) {
      const newLocationStyleCodesMap = new Map(locationStyleCodesMap);
      newLocationStyleCodesMap.delete(oldId);
      newLocationStyleCodesMap.set(newId, styleCodes);
      setLocationStyleCodesMap(newLocationStyleCodesMap);
    }
    
    // 同步更新布局图的localStorage
    try {
      const savedLocations = localStorage.getItem('storeLocations');
      if (savedLocations) {
        const locations = JSON.parse(savedLocations);
        const updatedLocations = locations.map((loc: any) => 
          loc.id === oldId ? { ...loc, id: newId } : loc
        );
        localStorage.setItem('storeLocations', JSON.stringify(updatedLocations));
      }
    } catch (e) {
      console.error('更新localStorage失败:', e);
    }
    
    return true;
  };

  // ===== 线上销售数据方法 =====
  
  // 获取线上款号TOP10（按品类）
  const getOnlineSkuTop10ByCategory = (): { shoes: SkuDetail[]; clothing: SkuDetail[]; accessories: SkuDetail[] } => {
    const allItems: SkuDetail[] = [];
    
    // 遍历所有线上款号销售数据
    Object.entries(onlineSalesByStyleCode).forEach(([styleCode, sales]) => {
      const inventory = inventoryMap.get(styleCode) || { name: '', price: 0, stock: 0, imageUrl: '', category: '' };
      
      // 从线上品类映射获取品类
      const category = onlineCategoryMap.get(styleCode) || inventory.category || '';
      
      allItems.push({
        styleCode,
        name: inventory.name,
        price: inventory.price,
        stock: inventory.stock,
        salesQuantity: sales.quantity,
        salesAmount: sales.amount,
        imageUrl: inventory.imageUrl,
        locationCount: 0, // 线上无区位概念
        locations: [],
        category,
      });
    });
    
    // 按品类分组并排序
    const shoes = allItems.filter(item => item.category === '鞋').sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 10);
    const clothing = allItems.filter(item => item.category === '服装').sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 10);
    const accessories = allItems.filter(item => item.category === '配件').sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 10);
    
    return { shoes, clothing, accessories };
  };

  // 获取线上时段销售数据
  const getOnlineHourlySales = (): { hour: number; amount: number; quantity: number; count: number }[] => {
    const result: { hour: number; amount: number; quantity: number; count: number }[] = [];
    
    // 初始化所有时段（8点到22点）
    for (let h = 8; h <= 22; h++) {
      const data = onlineSalesByHour[h] || { quantity: 0, amount: 0, count: 0 };
      result.push({
        hour: h,
        amount: data.amount,
        quantity: data.quantity,
        count: data.count,
      });
    }
    
    return result;
  };

  // 获取线上中类+性别+时段三维数据表格
  const getOnlineSubCategoryGenderHourTable = (gender: string): { 
    subCategories: string[]; 
    hours: number[]; 
    data: Map<string, Map<number, { amount: number; quantity: number }>>;
    totals: Map<string, { amount: number; quantity: number }>;
    hourTotals: Map<number, { amount: number; quantity: number }>;
    grandTotal: { amount: number; quantity: number };
  } => {
    const subCategories = new Set<string>();
    const hours = new Set<number>();
    const dataMap = new Map<string, Map<number, { amount: number; quantity: number }>>();
    
    // 解析三维数据
    Object.entries(onlineSubCategoryGenderHour).forEach(([key, value]) => {
      const [subCategory, g, hourStr] = key.split('|');
      if (g === gender) {
        subCategories.add(subCategory);
        hours.add(parseInt(hourStr, 10));
        
        if (!dataMap.has(subCategory)) {
          dataMap.set(subCategory, new Map());
        }
        dataMap.get(subCategory)!.set(parseInt(hourStr, 10), {
          amount: value.amount,
          quantity: value.quantity,
        });
      }
    });
    
    // 计算各中类累计
    const totals = new Map<string, { amount: number; quantity: number }>();
    dataMap.forEach((hourData, subCategory) => {
      let totalAmount = 0;
      let totalQuantity = 0;
      hourData.forEach(d => {
        totalAmount += d.amount;
        totalQuantity += d.quantity;
      });
      totals.set(subCategory, { amount: totalAmount, quantity: totalQuantity });
    });
    
    // 计算各时段累计
    const hourTotals = new Map<number, { amount: number; quantity: number }>();
    const sortedHours = Array.from(hours).sort((a, b) => a - b);
    sortedHours.forEach(h => {
      let totalAmount = 0;
      let totalQuantity = 0;
      dataMap.forEach(hourData => {
        const d = hourData.get(h);
        if (d) {
          totalAmount += d.amount;
          totalQuantity += d.quantity;
        }
      });
      hourTotals.set(h, { amount: totalAmount, quantity: totalQuantity });
    });
    
    // 计算总计
    let grandTotalAmount = 0;
    let grandTotalQuantity = 0;
    totals.forEach(t => {
      grandTotalAmount += t.amount;
      grandTotalQuantity += t.quantity;
    });
    
    return {
      subCategories: Array.from(subCategories).sort((a, b) => (totals.get(b)?.amount || 0) - (totals.get(a)?.amount || 0)),
      hours: sortedHours,
      data: dataMap,
      totals,
      hourTotals,
      grandTotal: { amount: grandTotalAmount, quantity: grandTotalQuantity },
    };
  };

  // 获取线上销售总计
  const getOnlineTotalStats = (): { amount: number; quantity: number; count: number; styleCodes: number } => {
    let totalAmount = 0;
    let totalQuantity = 0;
    let totalCount = 0;
    
    Object.values(onlineSalesByStyleCode).forEach(sales => {
      totalAmount += sales.amount;
      totalQuantity += sales.quantity;
      totalCount += sales.count;
    });
    
    return {
      amount: totalAmount,
      quantity: totalQuantity,
      count: totalCount,
      styleCodes: Object.keys(onlineSalesByStyleCode).length,
    };
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <SalesDataContext.Provider value={{ 
      data, 
      dataMap, 
      loading, 
      lastFetchTime,
      refresh: () => fetchData(true),
      getLocationSkuDetails,
      getGlobalSkuTop10,
      getGlobalSkuTop10ByCategory,
      getSubCategoryTop10,
      getHourlySales,
      getSubCategoryGenderHourTable,
      updateLocationId,
      // 线上销售数据
      getOnlineSkuTop10ByCategory,
      getOnlineHourlySales,
      getOnlineSubCategoryGenderHourTable,
      getOnlineTotalStats,
    }}>
      {children}
    </SalesDataContext.Provider>
  );
}

export function useSalesData() {
  const context = useContext(SalesDataContext);
  if (!context) {
    throw new Error('useSalesData must be used within a SalesDataProvider');
  }
  return context;
}
