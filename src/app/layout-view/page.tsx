'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Move,
  Edit3,
  Save,
  Grid3X3,
  Upload,
  Trash2,
  Magnet,
  Check,
  Loader2,
  ArrowLeft,
  Download,
  Package,
  Building2,
  Plus,
  Settings,
  RefreshCw,
  HardDrive,
  MapPin,
  ImageIcon,
  Maximize2,
  Wifi
} from 'lucide-react';
import Link from 'next/link';
import { useSalesData } from '@/contexts/SalesDataContext';

// 区位标记（基于背景图像素坐标）
interface LocationMarker {
  id: string;
  x: number;  // 相对于背景图左侧的像素
  y: number;  // 相对于背景图顶部的像素
  width: number;  // 宽度（像素）
  height: number; // 高度（像素）
  salesAmount: number;
  salesQuantity: number;
  skuCount: number;
  fontSize?: number; // 可选：自定义字体大小
  // 保存时记录背景图尺寸，用于坐标转换
  bgWidth?: number;
  bgHeight?: number;
}

// 销售数据接口
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
}

// 吸附阈值（百分比）
const SNAP_THRESHOLD = 1.5;
// 默认区位尺寸
const DEFAULT_WIDTH = 3;
const DEFAULT_HEIGHT = 4;

// 楼层配置
const FLOORS = [
  { id: '1', name: '1F仓库', type: 'warehouse' as const },
  { id: '2', name: '2F仓库', type: 'warehouse' as const },
  { id: '3', name: '3F仓库', type: 'warehouse' as const },
  { id: '4', name: '4F仓库', type: 'warehouse' as const },
  { id: '5', name: '5F卖场', type: 'store' as const },
  { id: '6', name: '6F卖场', type: 'store' as const },
];

export default function LayoutViewPage() {
  const { dataMap: contextDataMap, loading: contextLoading, getLocationSkuDetails, updateLocationId, refresh } = useSalesData();
  // 静态部署模式：飞书云端同步不可用，相关按钮会直接提示（布局仍保存在本机浏览器）
  const isStatic = process.env.NEXT_PUBLIC_STATIC_MODE === 'true';
  const [locations, setLocations] = useState<LocationMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [editMode, setEditMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved');
  
  // 楼层状态
  const [floors, setFloors] = useState(FLOORS);
  const [currentFloor, setCurrentFloor] = useState('5'); // 默认5F卖场
  const [showFloorDialog, setShowFloorDialog] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [draggingLocation, setDraggingLocation] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationMarker | null>(null);
  const [snapLines, setSnapLines] = useState<{ vertical: number[], horizontal: number[] }>({ vertical: [], horizontal: [] });
  const [backgroundImages, setBackgroundImages] = useState<Record<string, string>>({});
  const [backgroundRatios, setBackgroundRatios] = useState<Record<string, number>>({}); // 宽高比
  const [dataSource, setDataSource] = useState<'excel' | 'feishu'>('feishu');
  
  // SKU详情状态（从缓存获取，速度极快）
  const [skuDetails, setSkuDetails] = useState<SkuDetail[]>([]);
  
  // 自定义尺寸（默认与DEFAULT相同）
  const [customWidth, setCustomWidth] = useState(DEFAULT_WIDTH);
  const [customHeight, setCustomHeight] = useState(DEFAULT_HEIGHT);
  
  // 视图锚点（保存视图位置和缩放）
  const [viewAnchors, setViewAnchors] = useState<Record<string, { x: number; y: number; scale: number }>>({});
  const [anchorNameInput, setAnchorNameInput] = useState('');
  
  // 当前楼层的背景图
  const backgroundImage = backgroundImages[currentFloor] || '';
  
  // 当前背景图的实际尺寸
  const [bgImageSize, setBgImageSize] = useState<{ width: number; height: number } | null>(null);
  
  // 加载图片后自动获取尺寸
  const loadBgImageSize = useCallback((dataUrl: string) => {
    const img = new window.Image();
    img.onload = () => {
      setBgImageSize({ width: img.width, height: img.height });
    };
    img.src = dataUrl;
  }, []);

  // 加载本地存储的区位数据和楼层配置
  useEffect(() => {
    // 加载楼层配置
    const savedFloors = localStorage.getItem('storeFloors');
    if (savedFloors) {
      setFloors(JSON.parse(savedFloors));
    }
    
    // 加载所有楼层的背景图
    const savedBackgrounds = localStorage.getItem('storeBackgroundImages');
    if (savedBackgrounds) {
      setBackgroundImages(JSON.parse(savedBackgrounds));
    }
    
    // 加载背景图比例
    const savedRatios = localStorage.getItem('storeBackgroundRatios');
    if (savedRatios) {
      setBackgroundRatios(JSON.parse(savedRatios));
    }
    
    // 加载背景图尺寸
    const savedSizes = localStorage.getItem('storeBackgroundSizes');
    if (savedSizes) {
      const sizes = JSON.parse(savedSizes);
      if (sizes[currentFloor]) {
        setBgImageSize(sizes[currentFloor]);
      }
    }
    
    // 加载视图锚点
    const savedAnchors = localStorage.getItem('storeViewAnchors');
    if (savedAnchors) {
      setViewAnchors(JSON.parse(savedAnchors));
    }
  }, []);

  // 当楼层切换时，加载该楼层的区位数据
  useEffect(() => {
    const floorLocations = localStorage.getItem(`storeLocations_${currentFloor}`);
    if (floorLocations) {
      const parsedLocations: LocationMarker[] = JSON.parse(floorLocations);
      const uniqueLocations = parsedLocations.filter((loc, index, self) => 
        index === self.findIndex(l => l.id === loc.id)
      );
      setLocations(uniqueLocations);
    } else {
      // 如果没有保存的区位，自动创建该楼层的区位
      if (!contextLoading && contextDataMap.size > 0) {
        const autoLocations = createAutoLocations(contextDataMap, currentFloor);
        setLocations(autoLocations);
      }
    }
    
    // 加载该楼层的背景图尺寸
    const savedSizes = JSON.parse(localStorage.getItem('storeBackgroundSizes') || '{}');
    if (savedSizes[currentFloor]) {
      setBgImageSize(savedSizes[currentFloor]);
    } else {
      setBgImageSize(null);
    }
    
    setSaveStatus('saved');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFloor]);

  // 当 Context 数据加载完成后，更新销售数据（包括楼层切换和数据刷新两种情况）
  useEffect(() => {
    if (!contextLoading && contextDataMap.size > 0) {
      setLocations(prev => {
        // 如果没有区位数据，不更新
        if (prev.length === 0) return prev;
        
        return prev.map(loc => {
          let sales = contextDataMap.get(loc.id);
          if (!sales) {
            for (const [key, value] of contextDataMap.entries()) {
              if (key.startsWith(loc.id) || loc.id.startsWith(key)) {
                sales = value;
                break;
              }
            }
          }
          if (sales) {
            return {
              ...loc,
              salesAmount: sales.salesAmount,
              salesQuantity: sales.salesQuantity,
              skuCount: sales.skuCount,
            };
          }
          // 没有销售数据时清零，避免保留旧的缓存数据
          return {
            ...loc,
            salesAmount: 0,
            salesQuantity: 0,
            skuCount: 0,
          };
        });
      });
      setLoading(false);
    }
  }, [contextLoading, contextDataMap, currentFloor]);

  // 自动创建区位（按楼层筛选）
  const createAutoLocations = (dataMap: Map<string, SalesData>, floorId: string): LocationMarker[] => {
    // 筛选当前楼层的区位
    const floorLocationIds = Array.from(dataMap.keys()).filter(id => id.startsWith(floorId));
    
    // 6F使用更大的区位尺寸
    const isFloor6 = floorId === '6';
    const cols = isFloor6 ? 10 : 14;
    const startX = isFloor6 ? 3 : 2;
    const startY = isFloor6 ? 4 : 3;
    const gapX = isFloor6 ? 9 : 6.5;
    const gapY = isFloor6 ? 7 : 5.5;
    const defaultW = isFloor6 ? 5 : DEFAULT_WIDTH;
    const defaultH = isFloor6 ? 4.5 : DEFAULT_HEIGHT;
    
    return floorLocationIds.map((id, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const data = dataMap.get(id)!;
      
      return {
        id,
        x: startX + col * gapX,
        y: startY + row * gapY,
        width: defaultW,
        height: defaultH,
        salesAmount: data.salesAmount,
        salesQuantity: data.salesQuantity,
        skuCount: data.skuCount,
      };
    });
  };

  // 保存配置（按楼层保存）
  const saveToStorage = (data: LocationMarker[]) => {
    const uniqueData = data.filter((loc, index, self) => 
      index === self.findLastIndex(l => l.id === loc.id)
    );
    localStorage.setItem(`storeLocations_${currentFloor}`, JSON.stringify(uniqueData));
    setSaveStatus('saved');
  };

  // 保存楼层配置
  const saveFloorsToStorage = (newFloors: typeof floors) => {
    localStorage.setItem('storeFloors', JSON.stringify(newFloors));
  };

  // 保存背景图配置
  const saveBackgroundsToStorage = (newBackgrounds: Record<string, string>) => {
    localStorage.setItem('storeBackgroundImages', JSON.stringify(newBackgrounds));
    setBackgroundImages(newBackgrounds);
  };

  // 手动保存按钮
  const handleManualSave = () => {
    setSaveStatus('saving');
    setTimeout(() => {
      saveToStorage(locations);
    }, 300);
  };

  // 保存当前位置（用于拖拽结束后）
  const saveLocations = () => {
    saveToStorage(locations);
  };

  // 标记为未保存（当位置改变时）
  const markUnsaved = () => {
    setSaveStatus('unsaved');
  };

  // 计算吸附位置 - 只吸附最近的模块，避免混乱
  const calculateSnapPosition = useCallback((newX: number, newY: number, currentId: string, newWidth: number, newHeight: number) => {
    if (!snapEnabled) {
      return { x: newX, y: newY, snapLines: { vertical: [], horizontal: [] } };
    }

    // 当前区位的边界
    const currentLeft = newX - newWidth / 2;
    const currentRight = newX + newWidth / 2;
    const currentTop = newY - newHeight / 2;
    const currentBottom = newY + newHeight / 2;
    const currentCenterX = newX;
    const currentCenterY = newY;
    
    let snappedX = newX;
    let snappedY = newY;
    let bestVerticalLine: number | null = null;
    let bestHorizontalLine: number | null = null;
    let minVerticalDistance = SNAP_THRESHOLD;
    let minHorizontalDistance = SNAP_THRESHOLD;
    
    // 遍历其他区位，找到最近的吸附点
    locations.forEach(loc => {
      if (loc.id === currentId) return;
      
      const otherLeft = loc.x - loc.width / 2;
      const otherRight = loc.x + loc.width / 2;
      const otherTop = loc.y - loc.height / 2;
      const otherBottom = loc.y + loc.height / 2;
      const otherCenterX = loc.x;
      const otherCenterY = loc.y;
      
      // X方向吸附检测 - 找最近的
      const xSnapPoints = [
        { dist: Math.abs(currentLeft - otherLeft), newX: otherLeft + newWidth / 2, line: otherLeft },
        { dist: Math.abs(currentRight - otherRight), newX: otherRight - newWidth / 2, line: otherRight },
        { dist: Math.abs(currentLeft - otherRight), newX: otherRight + newWidth / 2, line: otherRight },
        { dist: Math.abs(currentRight - otherLeft), newX: otherLeft - newWidth / 2, line: otherLeft },
        { dist: Math.abs(currentCenterX - otherCenterX), newX: otherCenterX, line: otherCenterX },
      ];
      
      xSnapPoints.forEach(point => {
        if (point.dist < minVerticalDistance) {
          minVerticalDistance = point.dist;
          snappedX = point.newX;
          bestVerticalLine = point.line;
        }
      });
      
      // Y方向吸附检测 - 找最近的
      const ySnapPoints = [
        { dist: Math.abs(currentTop - otherTop), newY: otherTop + newHeight / 2, line: otherTop },
        { dist: Math.abs(currentBottom - otherBottom), newY: otherBottom - newHeight / 2, line: otherBottom },
        { dist: Math.abs(currentTop - otherBottom), newY: otherBottom + newHeight / 2, line: otherBottom },
        { dist: Math.abs(currentBottom - otherTop), newY: otherTop - newHeight / 2, line: otherTop },
        { dist: Math.abs(currentCenterY - otherCenterY), newY: otherCenterY, line: otherCenterY },
      ];
      
      ySnapPoints.forEach(point => {
        if (point.dist < minHorizontalDistance) {
          minHorizontalDistance = point.dist;
          snappedY = point.newY;
          bestHorizontalLine = point.line;
        }
      });
    });
    
    // 如果没有吸附到任何模块，则吸附到网格
    const gridSize = 0.5;
    if (bestVerticalLine === null) {
      snappedX = Math.round(snappedX / gridSize) * gridSize;
    }
    if (bestHorizontalLine === null) {
      snappedY = Math.round(snappedY / gridSize) * gridSize;
    }
    
    return { 
      x: Math.max(0, Math.min(100, snappedX)), 
      y: Math.max(0, Math.min(100, snappedY)), 
      snapLines: { 
        vertical: bestVerticalLine !== null ? [bestVerticalLine] : [], 
        horizontal: bestHorizontalLine !== null ? [bestHorizontalLine] : [] 
      } 
    };
  }, [locations, snapEnabled]);

  // 上传背景图
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      
      // 获取图片实际尺寸
      const img = new window.Image();
      img.onload = () => {
        // 保存背景图尺寸
        setBgImageSize({ width: img.width, height: img.height });
        
        // 保存到 localStorage
        const savedSizes = JSON.parse(localStorage.getItem('storeBackgroundSizes') || '{}');
        savedSizes[currentFloor] = { width: img.width, height: img.height };
        localStorage.setItem('storeBackgroundSizes', JSON.stringify(savedSizes));
        
        toast.success(`背景图已加载 (${img.width}×${img.height})`);
      };
      img.src = dataUrl;
      
      const newBackgrounds = { ...backgroundImages, [currentFloor]: dataUrl };
      saveBackgroundsToStorage(newBackgrounds);
    };
    reader.readAsDataURL(file);
  };

  // 缩放控制
  const handleZoomIn = () => setScale(Math.min(scale * 1.2, 3));
  const handleZoomOut = () => setScale(Math.max(scale / 1.2, 0.3));
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // 保存当前视图为锚点
  const handleSaveAnchor = () => {
    const name = prompt('输入锚点名称（如：入口、收银台、左侧）：');
    if (!name) return;
    
    const newAnchors = { ...viewAnchors, [name]: { x: position.x, y: position.y, scale } };
    setViewAnchors(newAnchors);
    localStorage.setItem('storeViewAnchors', JSON.stringify(newAnchors));
    toast.success(`锚点「${name}」已保存`);
  };

  // 恢复到锚点
  const handleGoToAnchor = (anchor: { x: number; y: number; scale: number }) => {
    setPosition({ x: anchor.x, y: anchor.y });
    setScale(anchor.scale);
  };

  // 删除锚点
  const handleDeleteAnchor = (name: string) => {
    const newAnchors = { ...viewAnchors };
    delete newAnchors[name];
    setViewAnchors(newAnchors);
    localStorage.setItem('storeViewAnchors', JSON.stringify(newAnchors));
    toast.success(`锚点「${name}」已删除`);
  };

  // 拖拽画布
  const handleMouseDown = (e: React.MouseEvent) => {
    if (editMode || draggingLocation) return;
    setIsDraggingCanvas(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingLocation && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left - position.x - dragOffset.x) / (rect.width * scale)) * 100;
      const y = ((e.clientY - rect.top - position.y - dragOffset.y) / (rect.height * scale)) * 100;
      
      const loc = locations.find(l => l.id === draggingLocation);
      if (loc) {
        const snapped = calculateSnapPosition(x, y, draggingLocation, loc.width, loc.height);
        
        setLocations(prev => prev.map(l => 
          l.id === draggingLocation 
            ? { ...l, x: snapped.x, y: snapped.y }
            : l
        ));
        setSnapLines(snapped.snapLines);
        markUnsaved(); // 标记为未保存
      }
      return;
    }
    
    if (!isDraggingCanvas || editMode) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    if (draggingLocation) {
      setDraggingLocation(null);
      setSnapLines({ vertical: [], horizontal: [] });
      // 使用 setTimeout 确保 state 已更新后再保存
      setTimeout(() => {
        const savedData = localStorage.getItem('storeLocations');
        if (savedData) {
          const parsed = JSON.parse(savedData);
          // 只有当数据确实变化时才保存
          if (JSON.stringify(parsed) !== JSON.stringify(locations)) {
            saveToStorage(locations);
          }
        } else {
          saveToStorage(locations);
        }
      }, 50);
    }
    setIsDraggingCanvas(false);
  };

  // 滚轮缩放
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (editMode) return;
      e.preventDefault();
      if (e.deltaY < 0) {
        setScale((s) => Math.min(s * 1.1, 3));
      } else {
        setScale((s) => Math.max(s / 1.1, 0.3));
      }
    },
    [editMode, setScale]
  );

  // React 的 onWheel 默认以 passive 方式挂载到根节点，preventDefault 无效且报警。
  // 这里手动挂载非 passive 的 wheel 监听器，使缩放时阻止页面默认滚动。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => handleWheel(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [handleWheel]);

  // 开始拖拽区位
  const handleLocationDragStart = (e: React.MouseEvent, loc: LocationMarker) => {
    if (!editMode) return;
    e.stopPropagation();
    setDraggingLocation(loc.id);
    
    // 计算鼠标在区位内的偏移
    const rect = containerRef.current!.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left - position.x) / (rect.width * scale)) * 100;
    const mouseY = ((e.clientY - rect.top - position.y) / (rect.height * scale)) * 100;
    setDragOffset({
      x: (mouseX - loc.x) * (rect.width * scale) / 100,
      y: (mouseY - loc.y) * (rect.height * scale) / 100,
    });
  };

  // 点击区位
  const handleLocationClick = (loc: LocationMarker) => {
    // 编辑模式下点击选中区位（拖拽结束后）
    if (editMode) {
      // 如果正在拖拽其他区位，忽略此次点击
      if (draggingLocation && draggingLocation !== loc.id) return;
      setSelectedLocation(loc.id);
      return;
    }
    // 非编辑模式下显示详情弹窗
    if (draggingLocation) return;
    setSelectedLocation(loc.id);
    
    // 找到与 contextDataMap 匹配的真实区位 ID（支持用户自定义的简化 ID）
    let matchedId = loc.id;
    let matchedSales = contextDataMap.get(loc.id);
    if (!matchedSales) {
      for (const [key, value] of contextDataMap.entries()) {
        if (key.startsWith(loc.id) || loc.id.startsWith(key)) {
          matchedId = key;
          matchedSales = value;
          break;
        }
      }
    }
    
    // 实时获取SKU详情，确保数据一致性
    const skuDetails = getLocationSkuDetails(matchedId);
    
    // 弹窗合计优先使用 contextDataMap 的口径（与区位图模块一致），
    // 避免前端重新分摊时因累加精度/线上数据过滤不同导致数值差异
    setEditingLocation({
      ...loc,
      salesAmount: matchedSales?.salesAmount ?? 0,
      salesQuantity: matchedSales?.salesQuantity ?? 0,
      skuCount: skuDetails.length
    });
    setShowLocationDialog(true);
    setSkuDetails(skuDetails);
  };

  // 更新区位
  const handleUpdateLocation = () => {
    if (!editingLocation) return;
    
    // 检查新ID是否与其他区位重复（排除当前编辑的区位）
    const isDuplicate = locations.some(
      loc => loc.id === editingLocation.id && loc.id !== selectedLocation
    );
    
    if (isDuplicate) {
      alert(`区位ID "${editingLocation.id}" 已存在，请使用不同的ID`);
      return;
    }
    
    if (editingLocation.id !== selectedLocation) {
      // 先尝试精确匹配
      let sales = contextDataMap.get(editingLocation.id);
      
      // 如果精确匹配失败，尝试模糊匹配（如 "5001" 匹配 "5001-1"）
      if (!sales) {
        for (const [key, value] of contextDataMap.entries()) {
          if (key.startsWith(editingLocation.id) || editingLocation.id.startsWith(key)) {
            sales = value;
            break;
          }
        }
      }
      
      if (sales) {
        editingLocation.salesAmount = sales.salesAmount;
        editingLocation.salesQuantity = sales.salesQuantity;
        editingLocation.skuCount = sales.skuCount;
      } else {
        // 没有匹配到销售数据，清零
        editingLocation.salesAmount = 0;
        editingLocation.salesQuantity = 0;
        editingLocation.skuCount = 0;
      }
    }
    
    setLocations(prev => {
      const updated = prev.map(loc => 
        loc.id === selectedLocation ? editingLocation : loc
      );
      saveToStorage(updated);
      return updated;
    });
    setShowLocationDialog(false);
  };

  // 添加区位
  const handleAddLocation = () => {
    const newLoc: LocationMarker = {
      id: `new-${Date.now()}`,
      x: 50,
      y: 50,
      width: customWidth,
      height: customHeight,
      salesAmount: 0,
      salesQuantity: 0,
      skuCount: 0,
    };
    setLocations(prev => {
      const updated = [...prev, newLoc];
      saveToStorage(updated);
      return updated;
    });
    setEditingLocation(newLoc);
    setSelectedLocation(newLoc.id);
    setShowLocationDialog(true);
  };

  // 删除选中的区位
  const handleDeleteSelectedLocation = () => {
    if (!selectedLocation) return;
    setLocations(prev => {
      const updated = prev.filter(loc => loc.id !== selectedLocation);
      saveToStorage(updated);
      return updated;
    });
    setSelectedLocation(null);
  };

  // 复制选中的区位
  const handleCopyLocation = () => {
    const loc = locations.find(l => l.id === selectedLocation);
    if (!loc) return;
    
    const newLoc: LocationMarker = {
      ...loc,
      id: `${loc.id}-copy-${Date.now()}`,
      x: loc.x + 3, // 稍微偏移位置
      y: loc.y + 3,
    };
    setLocations(prev => {
      const updated = [...prev, newLoc];
      saveToStorage(updated);
      return updated;
    });
    setSelectedLocation(newLoc.id);
  };

  // 清除所有区位
  const handleClearAllLocations = () => {
    if (confirm('确定要清除所有区位吗？此操作不可撤销！')) {
      setLocations([]);
      setSelectedLocation(null);
      saveToStorage([]);
    }
  };

  // 导出布局配置
  const handleExportLayout = () => {
    const layoutData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      locations: locations,
      backgroundImage: backgroundImage,
    };
    const dataStr = JSON.stringify(layoutData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `卖场布局_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 保存布局配置到飞书表格
  const handleSaveToFeishu = async () => {
    if (isStatic) {
      alert('当前为静态部署版本，不支持飞书云端同步。布局已保存在本机浏览器，可用“导出布局”备份。');
      return;
    }
    try {
      const response = await fetch('/api/feishu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveLayout',
          floor: currentFloor,
          locations: locations,
          backgroundImage: backgroundImages[currentFloor] || '',
        }),
      });

      const result = await response.json();
      
      if (result.code === 0) {
        alert(`✅ 布局已保存到飞书表格！\n\n保存时间：${new Date().toLocaleString('zh-CN')}\n提示：其他人点击"从飞书加载"即可看到您的布局。`);
      } else {
        alert(`保存失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      alert('保存失败，请检查网络连接');
    }
  };

  // 从飞书表格加载布局配置
  const handleLoadFromFeishu = async () => {
    if (isStatic) {
      alert('当前为静态部署版本，不支持飞书云端同步。可改用“导入布局”从本地 JSON 恢复。');
      return;
    }
    try {
      const response = await fetch(`/api/feishu?action=loadLayout&floor=${currentFloor}`);
      const result = await response.json();
      
      if (result.code === 0 && result.data) {
        const { locations: loadedLocations, backgroundImage } = result.data;
        
        if (loadedLocations && loadedLocations.length > 0) {
          // 重新计算每个区位的销售数据（基于最新的contextDataMap）
          const recalculatedLocations = loadedLocations.map((loc: LocationMarker) => {
            let sales = contextDataMap.get(loc.id);
            if (!sales) {
              // 尝试模糊匹配
              for (const [key, value] of contextDataMap.entries()) {
                if (key.startsWith(loc.id) || loc.id.startsWith(key)) {
                  sales = value;
                  break;
                }
              }
            }
            return {
              ...loc,
              salesAmount: sales?.salesAmount || 0,
              salesQuantity: sales?.salesQuantity || 0,
              skuCount: sales?.skuCount || 0,
            };
          });
          setLocations(recalculatedLocations);
          saveToStorage(recalculatedLocations);
          
          if (backgroundImage) {
            const newBackgrounds = { ...backgroundImages, [currentFloor]: backgroundImage };
            saveBackgroundsToStorage(newBackgrounds);
            
            // 计算背景图比例
            const img = new window.Image();
            img.onload = () => {
              const ratio = img.width / img.height;
              const newRatios = { ...backgroundRatios, [currentFloor]: ratio };
              setBackgroundRatios(newRatios);
              localStorage.setItem('storeBackgroundRatios', JSON.stringify(newRatios));
            };
            img.src = backgroundImage;
          }
          
          alert(`✅ 已从飞书加载 ${loadedLocations.length} 个区位${backgroundImage ? '（包含背景图）' : ''}`);
        } else {
          alert('该楼层暂无保存的布局配置');
        }
      } else {
        alert(`加载失败：${result.error || '该楼层暂无保存的布局配置'}`);
      }
    } catch (error) {
      alert('加载失败，请检查网络连接');
    }
  };

  // 导入布局配置
  const handleImportLayout = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (data.locations && Array.isArray(data.locations)) {
            setLocations(data.locations);
            saveToStorage(data.locations);
            if (data.backgroundImage) {
              const newBackgrounds = { ...backgroundImages, [currentFloor]: data.backgroundImage };
              saveBackgroundsToStorage(newBackgrounds);
              
              // 计算背景图比例
              const img = new window.Image();
              img.onload = () => {
                const ratio = img.width / img.height;
                const newRatios = { ...backgroundRatios, [currentFloor]: ratio };
                setBackgroundRatios(newRatios);
                localStorage.setItem('storeBackgroundRatios', JSON.stringify(newRatios));
              };
              img.src = data.backgroundImage;
            }
            alert(`成功导入 ${data.locations.length} 个区位`);
          } else {
            alert('无效的布局文件格式');
          }
        } catch {
          alert('解析文件失败，请确保是有效的JSON文件');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // 获取最近保存的云盘token列表（最多10个）
  interface DriveTokenItem {
    floor: string;
    token: string;
    fileName: string;
    savedAt: string;
  }
  
  const getRecentDriveTokens = (): DriveTokenItem[] => {
    const recentTokens = JSON.parse(localStorage.getItem('feishuDriveRecentTokens') || '[]');
    return recentTokens.slice(0, 10);
  };

  // 保存布局配置到飞书云盘
  const handleSaveToFeishuDrive = async () => {
    if (isStatic) {
      alert('当前为静态部署版本，不支持飞书云盘同步。布局已保存在本机浏览器，可用“导出布局”备份。');
      return;
    }
    try {
      const response = await fetch('/api/feishu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveLayoutToDrive',
          floor: currentFloor,
          locations: locations,
          backgroundImage: backgroundImages[currentFloor] || '',
        }),
      });

      const result = await response.json();
      
      if (result.code === 0) {
        const { file_token, file_name } = result.data || {};
        
        // 保存到最近token列表
        const recentTokens = JSON.parse(localStorage.getItem('feishuDriveRecentTokens') || '[]');
        const newEntry = { 
          floor: currentFloor, 
          token: file_token, 
          fileName: file_name,
          savedAt: new Date().toISOString()
        };
        
        // 移除同一楼层的旧记录
        const filtered = recentTokens.filter((t: any) => t.floor !== currentFloor);
        // 添加到最前面
        filtered.unshift(newEntry);
        // 最多保留10个
        const trimmed = filtered.slice(0, 10);
        
        localStorage.setItem('feishuDriveRecentTokens', JSON.stringify(trimmed));
        
        alert(`✅ 布局已保存到飞书云盘！\n\n文件名：${file_name}`);
      } else {
        alert(`保存失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      alert('保存失败，请检查网络连接');
    }
  };

  // 从飞书云盘加载布局配置
  const loadFromDrive = async (fileToken: string) => {
    if (isStatic) {
      alert('当前为静态部署版本，不支持飞书云盘同步。可改用“导入布局”从本地 JSON 恢复。');
      return;
    }
    try {
      const response = await fetch('/api/feishu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'loadLayoutFromDrive',
          fileToken,
        }),
      });

      const result = await response.json();
      
      if (result.code === 0 && result.data) {
        const { locations: loadedLocations, backgroundImage, floor } = result.data;
        
        if (loadedLocations && loadedLocations.length > 0) {
          // 重新计算每个区位的销售数据（优先使用 contextDataMap，与区位图模块口径一致）
          const recalculatedLocations = loadedLocations.map((loc: any) => {
            let sales = contextDataMap.get(loc.id);
            if (!sales) {
              for (const [key, value] of contextDataMap.entries()) {
                if (key.startsWith(loc.id) || loc.id.startsWith(key)) {
                  sales = value;
                  break;
                }
              }
            }
            return {
              ...loc,
              salesAmount: sales?.salesAmount || 0,
              salesQuantity: sales?.salesQuantity || 0,
              skuCount: sales?.skuCount || 0,
            };
          });
          setLocations(recalculatedLocations);
          
          if (backgroundImage) {
            const targetFloor = floor || currentFloor;
            const newBackgrounds = { ...backgroundImages, [targetFloor]: backgroundImage };
            saveBackgroundsToStorage(newBackgrounds);
            
            // 计算背景图比例并保存
            const img = new window.Image();
            img.onload = () => {
              const ratio = img.width / img.height;
              const newRatios = { ...backgroundRatios, [targetFloor]: ratio };
              setBackgroundRatios(newRatios);
              localStorage.setItem('storeBackgroundRatios', JSON.stringify(newRatios));
            };
            img.src = backgroundImage;
          }
          
          alert(`✅ 已从飞书云盘加载 ${loadedLocations.length} 个区位${backgroundImage ? '（包含背景图）' : ''}`);
        } else {
          alert('加载失败：配置文件中没有区位数据');
        }
      } else {
        alert(`加载失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      alert('加载失败，请检查网络连接和Token是否正确');
    }
  };

  // 从云盘直接加载文件
  const handleLoadFromCloud = async () => {
    if (isStatic) {
      alert('当前为静态部署版本，不支持飞书云盘同步。');
      return;
    }
    try {
      const response = await fetch('/api/feishu?action=listDriveFiles');
      const result = await response.json();
      
      if (result.code === 0 && result.data?.files) {
        const files = result.data.files;
        
        // 过滤布局配置文件
        const layoutFiles = files.filter((f: any) => 
          f.name && (f.name.includes('布局') || f.name.includes('layout') || f.name.endsWith('.json'))
        );
        
        if (layoutFiles.length === 0) {
          toast.error('云盘上没有找到布局配置文件');
          return;
        }
        
        // 构建文件选择对话框
        const fileList = layoutFiles.map((f: any, i: number) => 
          `${i + 1}. ${f.name}`
        ).join('\n');
        
        const choice = prompt(`云盘上找到 ${layoutFiles.length} 个布局配置文件：\n\n${fileList}\n\n请输入序号加载：`);
        
        if (!choice) return;
        
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < layoutFiles.length) {
          const selectedFile = layoutFiles[index];
          
          // 保存到本地记录
          const recentTokens = JSON.parse(localStorage.getItem('feishuDriveRecentTokens') || '[]');
          const floorMatch = selectedFile.name.match(/(\d+)F/);
          const floor = floorMatch ? floorMatch[1] : '5';
          
          // 移除同楼层旧记录
          const filtered = recentTokens.filter((t: any) => t.floor !== floor);
          filtered.unshift({
            floor,
            token: selectedFile.token,
            fileName: selectedFile.name,
            savedAt: new Date().toISOString()
          });
          const trimmed = filtered.slice(0, 10);
          localStorage.setItem('feishuDriveRecentTokens', JSON.stringify(trimmed));
          
          // 直接加载
          loadFromDrive(selectedFile.token);
        }
      } else {
        toast.error(`获取失败：${result.msg || '未知错误'}`);
      }
    } catch (error) {
      toast.error('加载失败，请检查网络连接');
    }
  };

  // 统计数据
  const stats = useMemo(() => {
    const totalAmount = locations.reduce((sum, loc) => sum + loc.salesAmount, 0);
    const totalQuantity = locations.reduce((sum, loc) => sum + loc.salesQuantity, 0);
    const activeLocations = locations.filter(loc => loc.salesAmount > 0).length;
    
    return { totalAmount, totalQuantity, totalLocations: locations.length, activeLocations };
  }, [locations]);

  // 获取热力颜色（按成交金额绝对挡位：每500元一档）
  const getHeatColor = useCallback((amount: number) => {
    // 处理无效值（undefined、NaN、null）
    if (amount === undefined || amount === null || isNaN(amount)) {
      return 'rgba(156, 163, 175, 0.9)'; // 灰色表示无数据
    }
    
    // 负数（退货）用蓝色表示
    if (amount < 0) return 'rgba(59, 130, 246, 0.9)'; // 蓝色
    
    // 0 销售表示无
    if (amount === 0) return 'rgba(156, 163, 175, 0.9)'; // 灰色
    
    // 按 500 元为绝对挡位
    if (amount >= 1500) return 'rgba(239, 68, 68, 0.9)';   // 高：≥1500
    if (amount >= 1000) return 'rgba(249, 115, 22, 0.9)';  // 中高：1000-1499
    if (amount >= 500) return 'rgba(234, 179, 8, 0.9)';    // 中：500-999
    return 'rgba(34, 197, 94, 0.9)';                        // 低：1-499
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">正在加载透视数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-2 md:p-4">
      <div className="max-w-full mx-auto">
        {/* 顶部工具栏 - 统一一行 */}
        <div className="flex items-center justify-between gap-2 mb-3 md:mb-4 flex-wrap">
          {/* 左侧：返回+标题+楼层 */}
          <div className="flex items-center gap-2 md:gap-3">
            <Link href="/">
              <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-xl w-8 h-8"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <h1 className="text-base md:text-xl font-bold text-foreground">卖场透视</h1>
            
            {/* 楼层选择器 */}
            <div className="flex items-center gap-1 bg-card/80 backdrop-blur border border-border/50 rounded-lg px-2 py-1">
              <Building2 className="w-3 h-3 md:w-4 md:h-4 text-muted-foreground" />
              <select
                value={currentFloor}
                onChange={(e) => setCurrentFloor(e.target.value)}
                className="bg-transparent text-xs md:text-sm font-medium outline-none cursor-pointer"
              >
                {floors.map(floor => (
                  <option key={floor.id} value={floor.id}>{floor.name}</option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFloorDialog(true)}
                className="rounded h-5 w-5 p-0"
              >
                <Settings className="w-3 h-3" />
              </Button>
            </div>
          </div>
          
          {/* 中间：统计信息 */}
          <div className="hidden sm:flex items-center gap-2 md:gap-3">
            <div className="flex items-center gap-1 bg-card/80 backdrop-blur border border-border/50 rounded-lg px-2 md:px-3 py-1">
              <span className="text-xs md:text-sm font-medium">{stats.activeLocations}/{stats.totalLocations}</span>
              <span className="text-xs text-muted-foreground hidden md:inline">活跃</span>
            </div>
            <div className="flex items-center gap-1 bg-card/80 backdrop-blur border border-border/50 rounded-lg px-2 md:px-3 py-1">
              <span className="text-xs md:text-sm font-medium">¥{stats.totalAmount.toLocaleString()}</span>
            </div>
          </div>
          
          {/* 右侧：功能按钮 */}
          <div className="flex items-center gap-1">
            {/* 刷新 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refresh()}
              disabled={contextLoading}
              className="rounded-lg w-8 h-8"
              title="刷新数据"
            >
              <RefreshCw className={`w-4 h-4 ${contextLoading ? 'animate-spin' : ''}`} />
            </Button>
            
            {/* 线上销售 */}
            <Link href="/online-sales">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-lg w-8 h-8 text-blue-500 hover:text-blue-600"
                title="线上销售分析"
              >
                <Wifi className="w-4 h-4" />
              </Button>
            </Link>
            
            {/* 编辑模式 */}
            <Button
              variant={editMode ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setEditMode(!editMode)}
              className="rounded-lg w-8 h-8"
              title={editMode ? '保存模式' : '编辑模式'}
            >
              {editMode ? <Save className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            </Button>
            
            {/* 吸附 */}
            <Button
              variant={snapEnabled ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setSnapEnabled(!snapEnabled)}
              className="rounded-lg w-8 h-8"
              title="吸附对齐"
            >
              <Magnet className="w-4 h-4" />
            </Button>
            
            {/* 显示网格 */}
            <Button
              variant={showGrid ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setShowGrid(!showGrid)}
              className="rounded-lg w-8 h-8"
              title={showGrid ? '隐藏网格' : '显示网格'}
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
            
            {/* 上传 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg w-8 h-8"
              title="上传背景图"
            >
              <ImageIcon className="w-4 h-4" />
            </Button>
            
            {/* 缩放控制 */}
            <div className="hidden md:flex items-center gap-1 bg-card/80 backdrop-blur border border-border/50 rounded-lg p-0.5">
              <Button variant="ghost" size="sm" onClick={handleZoomOut} className="rounded h-6 w-6 p-0">
                <ZoomOut className="w-3 h-3" />
              </Button>
              <span className="text-xs text-muted-foreground px-1 min-w-[36px] text-center">{Math.round(scale * 100)}%</span>
              <Button variant="ghost" size="sm" onClick={handleZoomIn} className="rounded h-6 w-6 p-0">
                <ZoomIn className="w-3 h-3" />
              </Button>
            </div>
            
            {/* 归中 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReset}
              className="rounded-lg w-8 h-8"
              title="归中"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>

            {/* 批量调整大小 */}
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-lg w-8 h-8"
                  title="调整区位大小"
                >
                  <Grid3X3 className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[280px]">
                <DialogHeader>
                  <DialogTitle>批量调整区位</DialogTitle>
                  <DialogDescription>设置宽度、高度和字体大小，应用到所有区位</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="flex items-center gap-3">
                    <label className="text-sm w-12">宽度</label>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      defaultValue="4"
                      className="w-20"
                      id="bulk-width"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-sm w-12">高度</label>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      defaultValue="3"
                      className="w-20"
                      id="bulk-height"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-sm w-12">字体</label>
                    <Input
                      type="number"
                      min="8"
                      max="32"
                      defaultValue="12"
                      className="w-20"
                      id="bulk-font"
                    />
                    <span className="text-sm text-muted-foreground">px</span>
                  </div>
                  <div className="border-t border-border pt-3 space-y-2">
                    <label className="text-sm font-medium">显示内容</label>
                    <div className="flex items-center gap-2">
                      <Checkbox id="bulk-show-id" defaultChecked />
                      <label htmlFor="bulk-show-id" className="text-sm">区位ID</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="bulk-show-amount" defaultChecked />
                      <label htmlFor="bulk-show-amount" className="text-sm">金额</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="bulk-show-qty" defaultChecked />
                      <label htmlFor="bulk-show-qty" className="text-sm">件数</label>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      const w = parseFloat((document.getElementById('bulk-width') as HTMLInputElement)?.value) || 4;
                      const h = parseFloat((document.getElementById('bulk-height') as HTMLInputElement)?.value) || 3;
                      const fontSize = parseFloat((document.getElementById('bulk-font') as HTMLInputElement)?.value) || 12;
                      const showId = (document.getElementById('bulk-show-id') as HTMLInputElement)?.checked ?? true;
                      const showAmount = (document.getElementById('bulk-show-amount') as HTMLInputElement)?.checked ?? true;
                      const showQty = (document.getElementById('bulk-show-qty') as HTMLInputElement)?.checked ?? true;
                      setLocations(prev => prev.map(loc => ({
                        ...loc,
                        width: w,
                        height: h,
                        fontSize: fontSize,
                        showId: showId,
                        showAmount: showAmount,
                        showQty: showQty,
                      })));
                      alert(`已应用: ${w}% × ${h}% 字体${fontSize}px`);
                    }}
                  >
                    应用到所有区位
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 云盘上传 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSaveToFeishuDrive}
              className="rounded-lg w-8 h-8"
              title="上传到云盘"
            >
              <Upload className="w-4 h-4" />
            </Button>

            {/* 云盘加载 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLoadFromCloud}
              className="rounded-lg w-8 h-8"
              title="从云盘加载"
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* 编辑模式提示条 */}
        {editMode && (
          <div className="mb-3 p-2 md:p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs md:text-sm text-amber-800">
              <strong>编辑模式：</strong>拖动区位调整位置，靠近其他区位时自动吸附对齐
            </p>
            <div className="flex gap-2 items-center flex-wrap">
              {/* 区位大小设置 */}
              <div className="flex items-center gap-1 bg-white/50 rounded-lg p-1">
                <span className="text-xs text-gray-500 px-1">尺寸:</span>
                <Input
                  type="number"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                  className="w-12 h-6 text-xs text-center rounded"
                  step="0.5"
                  min="0.5"
                  max="50"
                />
                <span className="text-xs text-gray-500">×</span>
                <Input
                  type="number"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                  className="w-12 h-6 text-xs text-center rounded"
                  step="0.5"
                  min="0.5"
                  max="50"
                />
                <span className="text-xs text-gray-400">%</span>
              </div>
              
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleManualSave} 
                className="rounded-lg bg-green-600 hover:bg-green-700 h-7"
                disabled={saveStatus === 'saved'}
              >
                <Save className="w-3 h-3 mr-1" />
                保存
              </Button>
              <Button variant="outline" size="sm" onClick={handleAddLocation} className="rounded-lg h-7 text-xs">
                + 添加区位
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleDeleteSelectedLocation} 
                className="rounded-lg text-red-500 h-7 text-xs"
                disabled={!selectedLocation}
              >
                删除选中
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportLayout} className="rounded-lg h-7 text-xs" title="导出布局配置">
                <Download className="w-3 h-3" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportLayout} className="rounded-lg h-7 text-xs" title="导入布局配置">
                <Upload className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        {/* 主布局区域 */}
        <Card className="bg-card/80 backdrop-blur border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div
              ref={containerRef}
              className="relative mx-auto overflow-hidden bg-muted/20 flex items-center justify-center"
              style={{ 
                cursor: editMode ? 'default' : 'move',
                height: 'calc(100vh - 200px)',
                maxHeight: 'calc(100vh - 200px)',
                aspectRatio: backgroundRatios[currentFloor] 
                  ? `${backgroundRatios[currentFloor]} / 1` 
                  : undefined,
                maxWidth: '100%',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: 'center',
                  transition: 'none',
                }}
                className="relative w-full h-full"
              >
                {/* 底层：布局图（锁定宽高比，完整显示） */}
                {backgroundImage && (
                  <div 
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                      backgroundImage: `url(${backgroundImage})`,
                      opacity: 0.5,
                    }}
                  />
                )}
                
                {/* 无背景图时显示上传提示 */}
                {!backgroundImage && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/50">
                    <Upload className="w-12 h-12 mb-2" />
                    <p className="text-sm">点击上按钮上传布局图</p>
                  </div>
                )}
                
                {/* 网格层 */}
                {showGrid && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <defs>
                      <pattern
                        id="grid"
                        width="0.01"
                        height="0.01"
                        patternUnits="objectBoundingBox"
                        patternContentUnits="objectBoundingBox"
                      >
                        <path
                          d="M 1 0 L 0 0 0 1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="0.003"
                          opacity="0.15"
                        />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                  </svg>
                )}
                
                {/* 吸附辅助线 */}
                {snapLines.vertical.length > 0 && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-50">
                    {snapLines.vertical.map((x, i) => (
                      <line key={`v-${i}`} x1={`${x}%`} y1="0" x2={`${x}%`} y2="100%" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4,4" opacity="0.8" />
                    ))}
                  </svg>
                )}
                {snapLines.horizontal.length > 0 && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-50">
                    {snapLines.horizontal.map((y, i) => (
                      <line key={`h-${i}`} x1="0" y1={`${y}%`} x2="100%" y2={`${y}%`} stroke="#3b82f6" strokeWidth="1" strokeDasharray="4,4" opacity="0.8" />
                    ))}
                  </svg>
                )}
                
                {/* 上层：方形区位标记 */}
                {locations.map((loc, index) => {
                  // 根据内容长度调整显示
                  const idLength = String(loc.id).length;
                  const amountText = `¥${Math.abs(Math.round(loc.salesAmount))}`;
                  const qtyText = `${Math.abs(Math.ceil(loc.salesQuantity)) || Math.abs(Math.round(loc.salesQuantity)) || 0}件`;
                  const showFullInfo = loc.width >= 4 && loc.height >= 3.5;
                  
                  return (
                    <div
                      key={loc.id}
                      className={`absolute transition-transform duration-75 ${
                        editMode ? 'cursor-move' : 'cursor-pointer'
                      }`}
                      style={{
                        left: `${loc.x - loc.width / 2}%`,
                        top: `${loc.y - loc.height / 2}%`,
                        width: `${loc.width}%`,
                        height: `${loc.height}%`,
                        zIndex: draggingLocation === loc.id ? 100 : 10,
                      }}
                      onMouseDown={(e) => handleLocationDragStart(e, loc)}
                      onClick={() => handleLocationClick(loc)}
                    >
                      {/* 方形标记 */}
                      <div
                        className={`w-full h-full rounded-lg flex flex-col items-center justify-center text-white shadow-lg transition-all overflow-hidden ${
                          editMode && draggingLocation === loc.id ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                        } ${selectedLocation === loc.id ? 'ring-2 ring-white' : ''}`}
                        style={{
                          backgroundColor: getHeatColor(loc.salesAmount),
                          fontSize: loc.fontSize ? `${loc.fontSize}px` : (loc.width >= 4 ? '11px' : loc.width >= 3 ? '10px' : '9px'),
                          padding: '2px',
                        }}
                        title={`区位: ${loc.id}\n销售金额: ¥${loc.salesAmount || 0}\n销售件数: ${loc.salesQuantity || 0}\nSKU数: ${loc.skuCount || 0}`}
                      >
                        {/* 金额/件数 - 上方，显示格式 ¥599/1件 */}
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <div className="font-semibold" style={{ fontSize: loc.fontSize ? `${loc.fontSize}px` : 'inherit' }}>
                            ¥{Math.abs(Math.round(loc.salesAmount || 0))}/{Math.abs(Math.ceil(loc.salesQuantity || 0)) || 0}
                          </div>
                        </div>
                        
                        {/* 区位ID - 下方 */}
                        <div 
                          className="font-bold leading-tight mt-auto pt-0.5" 
                          style={{ fontSize: loc.fontSize ? `${Math.max(8, loc.fontSize - 2)}px` : 'inherit' }}
                        >
                          {loc.id}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
          
          {/* 销售热力图例 - 移到布局图外部 */}
          <div className="px-4 pb-4 bg-background/50">
            <div className="flex items-center justify-center gap-6 text-xs flex-wrap">
              <span className="text-muted-foreground font-medium">销售热力：</span>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-red-500"></div>
                <span>高（≥1500）</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-orange-500"></div>
                <span>中高（1000-1499）</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-yellow-500"></div>
                <span>中（500-999）</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-green-500"></div>
                <span>低（1-499）</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-blue-500"></div>
                <span>退货（&lt;0）</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-gray-400"></div>
                <span>无（0）</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* 区位详情弹窗 - 只读查看 */}
      <Dialog open={showLocationDialog} onOpenChange={setShowLocationDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              区位详情 - {editingLocation?.id}
            </DialogTitle>
          </DialogHeader>
          {editingLocation && (
            <div className="space-y-4 pt-4 overflow-y-auto max-h-[60vh]">
              {/* 销售统计 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">SKU数</div>
                  <div className="text-lg font-semibold">{editingLocation.skuCount}</div>
                </div>
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">销售件数</div>
                  <div className={`text-lg font-semibold ${editingLocation.salesQuantity < 0 ? 'text-blue-500' : ''}`}>
                    {Math.ceil(editingLocation.salesQuantity) || Math.round(editingLocation.salesQuantity) || 0}
                  </div>
                </div>
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">销售金额</div>
                  <div className={`text-lg font-semibold ${editingLocation.salesAmount < 0 ? 'text-blue-500' : 'text-amber-500'}`}>
                    ¥{Math.round(editingLocation.salesAmount)}
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
                            ¥{Math.round(sku.salesAmount)}
                          </div>
                          <div className={`text-xs ${sku.salesQuantity < 0 ? 'text-blue-500' : 'text-muted-foreground'}`}>
                            {Math.ceil(sku.salesQuantity) || Math.round(sku.salesQuantity) || 0}件
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
      
      {/* 楼层编辑对话框 */}
      <Dialog open={showFloorDialog} onOpenChange={setShowFloorDialog}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              楼层管理
            </DialogTitle>
            <DialogDescription>
              添加、删除或编辑楼层信息。每个楼层可以有独立的背景图和区位配置。
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* 楼层列表 */}
            <div className="space-y-2">
              {floors.map((floor, index) => (
                <div key={floor.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded-xl">
                  <Input
                    value={floor.name}
                    onChange={(e) => {
                      const newFloors = [...floors];
                      newFloors[index] = { ...floor, name: e.target.value };
                      setFloors(newFloors);
                      saveFloorsToStorage(newFloors);
                    }}
                    className="flex-1 rounded-lg h-8"
                  />
                  <span className="text-xs text-muted-foreground w-16">ID: {floor.id}</span>
                  {floors.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const newFloors = floors.filter((_, i) => i !== index);
                        setFloors(newFloors);
                        saveFloorsToStorage(newFloors);
                        // 删除该楼层的区位数据和背景图
                        localStorage.removeItem(`storeLocations_${floor.id}`);
                        const newBackgrounds = { ...backgroundImages };
                        delete newBackgrounds[floor.id];
                        saveBackgroundsToStorage(newBackgrounds);
                        // 如果删除的是当前楼层，切换到第一个楼层
                        if (currentFloor === floor.id) {
                          setCurrentFloor(newFloors[0].id);
                        }
                      }}
                      className="rounded-lg h-8 px-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            
            {/* 添加楼层 */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="新楼层名称"
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                className="flex-1 rounded-lg"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newFloorName.trim()) {
                    const newFloorId = `${Math.max(...floors.map(f => parseInt(f.id))) + 1}`;
                    const newFloors = [...floors, { id: newFloorId, name: newFloorName.trim(), type: 'store' as const }];
                    setFloors(newFloors);
                    saveFloorsToStorage(newFloors);
                    setNewFloorName('');
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (newFloorName.trim()) {
                    const newFloorId = `${Math.max(...floors.map(f => parseInt(f.id))) + 1}`;
                    const newFloors = [...floors, { id: newFloorId, name: newFloorName.trim(), type: 'store' as const }];
                    setFloors(newFloors);
                    saveFloorsToStorage(newFloors);
                    setNewFloorName('');
                  }
                }}
                disabled={!newFloorName.trim()}
                className="rounded-lg"
              >
                <Plus className="w-4 h-4 mr-1" />
                添加
              </Button>
            </div>
          </div>
          
          <DialogFooter>
            <Button onClick={() => setShowFloorDialog(false)} className="rounded-xl">
              完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
