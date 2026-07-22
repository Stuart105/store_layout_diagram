/**
 * 构建时数据预取脚本
 * 从飞书多维表格获取数据，保存为静态 JSON 文件供静态导出使用
 *
 * 用法: npx tsx scripts/fetch-data.ts
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// 加载 .env 文件
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_CONFIG = {
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  appToken: process.env.FEISHU_APP_TOKEN || '',
  baseUrl: 'https://open.feishu.cn/open-apis',
};

const INVENTORY_TABLE_ID = process.env.FEISHU_INVENTORY_TABLE_ID || 'tbl9hrCakoLZfa7N';
const LOCATION_TABLE_ID = process.env.FEISHU_LOCATION_TABLE_ID || 'tbl8f2AUadoiVnuL';
const SALES_TABLE_ID = process.env.FEISHU_SALES_TABLE_ID || 'tbl6ACKuTrBFsBOP';

// ====== 工具函数 ======

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); } catch (error) {
      lastError = error as Error;
      console.log(`  Attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`);
      if (attempt === maxRetries) throw lastError;
      await delay(baseDelay * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

function cleanFieldValue(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') {
    if (value.startsWith('="') && value.endsWith('"')) return value.slice(2, -1);
    return value;
  }
  return String(value);
}

// ====== 飞书 API ======

async function getAccessToken(): Promise<string> {
  console.log('Fetching access token...');
  const response = await fetch(`${FEISHU_CONFIG.baseUrl}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_CONFIG.appId, app_secret: FEISHU_CONFIG.appSecret }),
  });
  if (!response.ok) throw new Error(`Token HTTP ${response.status}`);
  const data = await response.json() as any;
  if (data.code !== 0) throw new Error(`Token error: ${data.msg}`);
  console.log('Token obtained successfully');
  return data.tenant_access_token;
}

async function getRecords(accessToken: string, tableId: string, pageSize: number = 500): Promise<any[]> {
  const allRecords: any[] = [];
  let pageToken: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const url = new URL(`${FEISHU_CONFIG.baseUrl}/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${tableId}/records`);
    url.searchParams.set('page_size', String(pageSize));
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const data = await retryWithBackoff(async () => {
      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Records HTTP ${response.status}`);
      return await response.json() as any;
    }, 3, 2000);

    if (data.code !== 0) throw new Error(`Records error: ${data.msg}`);
    if (data.data?.items) {
      allRecords.push(...data.data.items);
      console.log(`  Fetched ${data.data.items.length} records (total: ${allRecords.length})`);
    }
    pageToken = data.data?.page_token;
    hasMore = data.data?.has_more || false;
  }
  return allRecords;
}

// ====== Match 数据处理（精确复制 route.ts 逻辑） ======

function processMatchData(salesRecords: any[], locationRecords: any[], inventoryRecords: any[]) {
  // 建立 国标码 -> 款号 映射：区位表的"款号"有时是条形码，销售表的"款号"是真实款号，
  // 库存表的 国标码/款号 是两者之间的桥梁
  const barcodeToStyleMap = new Map<string, string>();
  inventoryRecords.forEach((record: any) => {
    const fields = record.fields || {};
    const barcode = cleanFieldValue(fields['国标码']);
    const styleCode = cleanFieldValue(fields['款号']);
    if (barcode && styleCode && !barcodeToStyleMap.has(barcode)) {
      barcodeToStyleMap.set(barcode, styleCode);
    }
  });
  const normalizeStyleCode = (raw: string): string => barcodeToStyleMap.get(raw) || raw;
  const salesByStyleCode = new Map<string, { quantity: number; amount: number; count: number }>();
  const salesBySubCategory = new Map<string, { quantity: number; amount: number; count: number }>();
  const salesByHour = new Map<number, { quantity: number; amount: number; count: number }>();
  const styleCodeToCategory = new Map<string, string>();
  const salesBySubCategoryGenderHour = new Map<string, { quantity: number; amount: number }>();

  const onlineSalesByStyleCode = new Map<string, { quantity: number; amount: number; count: number }>();
  const onlineSalesBySubCategory = new Map<string, { quantity: number; amount: number; count: number }>();
  const onlineSalesByHour = new Map<number, { quantity: number; amount: number; count: number }>();
  const onlineSalesBySubCategoryGenderHour = new Map<string, { quantity: number; amount: number }>();
  const onlineStyleCodeToCategory = new Map<string, string>();

  salesRecords.forEach((record: any) => {
    const fields = record.fields || {};
    const styleCode = cleanFieldValue(fields['款号']);
    const quantity = parseInt(cleanFieldValue(fields['数量'])) || 0;
    const amount = parseInt(cleanFieldValue(fields['成交金额 (1)'])) ||
                   parseInt(cleanFieldValue(fields['成交金额（1）'])) ||
                   parseInt(cleanFieldValue(fields['成交金额'])) || 0;
    const manualChangePrice = cleanFieldValue(fields['手工改价']) || cleanFieldValue(fields['手动改价']);
    const isOnline = manualChangePrice === 'Y';
    if (!styleCode) return;

    const category = cleanFieldValue(fields['款号.大类.属性描述']);
    const subCategory = cleanFieldValue(fields['PS中类']);
    const gender = cleanFieldValue(fields['款号性别']);
    const createdAt = fields['创建时间'];
    let hour = -1;
    if (createdAt) hour = new Date(createdAt).getHours();

    if (isOnline) {
      const oe = onlineSalesByStyleCode.get(styleCode) || { quantity: 0, amount: 0, count: 0 };
      oe.quantity += quantity; oe.amount += amount; oe.count += 1;
      onlineSalesByStyleCode.set(styleCode, oe);
      if (category) onlineStyleCodeToCategory.set(styleCode, category);
      if (subCategory) {
        const osc = onlineSalesBySubCategory.get(subCategory) || { quantity: 0, amount: 0, count: 0 };
        osc.quantity += quantity; osc.amount += amount; osc.count += 1;
        onlineSalesBySubCategory.set(subCategory, osc);
      }
      if (hour >= 0) {
        const oh = onlineSalesByHour.get(hour) || { quantity: 0, amount: 0, count: 0 };
        oh.quantity += quantity; oh.amount += amount; oh.count += 1;
        onlineSalesByHour.set(hour, oh);
      }
      if (subCategory && gender && hour >= 0) {
        const key = `${subCategory}|${gender}|${hour}`;
        const ok = onlineSalesBySubCategoryGenderHour.get(key) || { quantity: 0, amount: 0 };
        ok.quantity += quantity; ok.amount += amount;
        onlineSalesBySubCategoryGenderHour.set(key, ok);
      }
    } else {
      const se = salesByStyleCode.get(styleCode) || { quantity: 0, amount: 0, count: 0 };
      se.quantity += quantity; se.amount += amount; se.count += 1;
      salesByStyleCode.set(styleCode, se);
      if (category) styleCodeToCategory.set(styleCode, category);
      if (subCategory) {
        const sc = salesBySubCategory.get(subCategory) || { quantity: 0, amount: 0, count: 0 };
        sc.quantity += quantity; sc.amount += amount; sc.count += 1;
        salesBySubCategory.set(subCategory, sc);
      }
      if (hour >= 0) {
        const sh = salesByHour.get(hour) || { quantity: 0, amount: 0, count: 0 };
        sh.quantity += quantity; sh.amount += amount; sh.count += 1;
        salesByHour.set(hour, sh);
      }
      if (subCategory && gender && hour >= 0) {
        const key = `${subCategory}|${gender}|${hour}`;
        const sk = salesBySubCategoryGenderHour.get(key) || { quantity: 0, amount: 0 };
        sk.quantity += quantity; sk.amount += amount;
        salesBySubCategoryGenderHour.set(key, sk);
      }
    }
  });

  // 区位-款号映射（只统计卖场区位 5/6 开头）
  const styleCodeStoreLocationCount = new Map<string, number>();
  const styleCodeStoreLocationMap = new Map<string, Set<string>>();

  locationRecords.forEach((record: any) => {
    const fields = record.fields || {};
    const locationId = cleanFieldValue(fields['货架号']);
    const rawStyleCode = cleanFieldValue(fields['款号']);
    const styleCode = normalizeStyleCode(rawStyleCode);
    if (!locationId || !styleCode) return;
    if (locationId.startsWith('5') || locationId.startsWith('6')) {
      if (!styleCodeStoreLocationMap.has(styleCode)) styleCodeStoreLocationMap.set(styleCode, new Set());
      styleCodeStoreLocationMap.get(styleCode)!.add(locationId);
    }
  });
  styleCodeStoreLocationMap.forEach((locations, styleCode) => {
    styleCodeStoreLocationCount.set(styleCode, locations.size);
  });

  // 区位销售汇总
  const locationSales = new Map<string, { styleCodes: string[]; quantity: number; amount: number; count: number }>();
  locationRecords.forEach((record: any) => {
    const fields = record.fields || {};
    const locationId = cleanFieldValue(fields['货架号']);
    const rawStyleCode = cleanFieldValue(fields['款号']);
    const styleCode = normalizeStyleCode(rawStyleCode);
    if (!locationId || !styleCode) return;
    const existing = locationSales.get(locationId) || { styleCodes: [], quantity: 0, amount: 0, count: 0 };
    if (!existing.styleCodes.includes(styleCode)) {
      existing.styleCodes.push(styleCode);
      const isStore = locationId.startsWith('5') || locationId.startsWith('6');
      if (isStore) {
        const sales = salesByStyleCode.get(styleCode);
        const storeCount = styleCodeStoreLocationCount.get(styleCode) || 1;
        if (sales && storeCount > 0) {
          existing.quantity += sales.quantity / storeCount;
          existing.amount += sales.amount / storeCount;
        }
        existing.count += 1;
      }
    }
    locationSales.set(locationId, existing);
  });

  // 构建 locations 数组
  const locations: any[] = [];
  locationSales.forEach((data, id) => {
    locations.push({
      id,
      styleCodes: data.styleCodes,
      salesQuantity: Math.round(data.quantity),
      salesAmount: Math.round(data.amount),
      transactionCount: Math.round(data.count),
    });
  });

  // 转换 Map 为普通对象
  const styleCodeLocationCountObj: Record<string, number> = {};
  styleCodeStoreLocationCount.forEach((v, k) => { styleCodeLocationCountObj[k] = v; });

  const styleCodeLocationsObj: Record<string, string[]> = {};
  styleCodeStoreLocationMap.forEach((v, k) => { styleCodeLocationsObj[k] = [...v]; });

  // ✅ 与 route.ts 完全一致的返回格式
  return {
    code: 0,
    data: {
      locations,
      styleCodeLocationCount: styleCodeLocationCountObj,
      styleCodeLocations: styleCodeLocationsObj,
      subCategorySales: Object.fromEntries(
        [...salesBySubCategory.entries()].map(([name, d]) => [name, { quantity: d.quantity, amount: d.amount, count: d.count }])
      ),
      hourlySales: Object.fromEntries(
        [...salesByHour.entries()].map(([hour, d]) => [hour, { quantity: d.quantity, amount: d.amount, count: d.count }])
      ),
      styleCodeCategory: Object.fromEntries(styleCodeToCategory),
      subCategoryGenderHour: Object.fromEntries(salesBySubCategoryGenderHour),
      onlineSales: {
        byStyleCode: Object.fromEntries(onlineSalesByStyleCode),
        bySubCategory: Object.fromEntries(
          [...onlineSalesBySubCategory.entries()].map(([name, d]) => [name, { quantity: d.quantity, amount: d.amount, count: d.count }])
        ),
        byHour: Object.fromEntries(
          [...onlineSalesByHour.entries()].map(([hour, d]) => [hour, { quantity: d.quantity, amount: d.amount, count: d.count }])
        ),
        bySubCategoryGenderHour: Object.fromEntries(onlineSalesBySubCategoryGenderHour),
        styleCodeCategory: Object.fromEntries(onlineStyleCodeToCategory),
      },
      stats: {
        totalLocations: locationSales.size,
        totalRecords: salesRecords.length,
      },
    },
  };
}

// ====== 主流程 ======

async function main() {
  console.log('========================================');
  console.log('  飞书数据预取 (Build-time Data Fetcher)');
  console.log('========================================\n');

  const dataDir = path.resolve(__dirname, '..', 'public', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // 1. 获取 access token
  const accessToken = await getAccessToken();

  // 2. 并行获取三个表的数据
  console.log('\nFetching data from Feishu...');
  const [salesRecords, locationRecords, inventoryRecords] = await Promise.all([
    getRecords(accessToken, SALES_TABLE_ID).then(r => { console.log(`  Sales records: ${r.length}`); return r; }),
    getRecords(accessToken, LOCATION_TABLE_ID).then(r => { console.log(`  Location records: ${r.length}`); return r; }),
    getRecords(accessToken, INVENTORY_TABLE_ID).then(r => { console.log(`  Inventory records: ${r.length}`); return r; }),
  ]);

  // 3. 处理 match 数据
  console.log('\nProcessing match data...');
  const matchData = processMatchData(salesRecords, locationRecords, inventoryRecords);

  // 4. 保存 JSON 文件 (格式与 API 路由完全一致)
  const files: { name: string; data: any }[] = [
    { name: 'match.json', data: matchData },
    { name: 'inventory.json', data: { code: 0, data: { items: inventoryRecords, total: inventoryRecords.length } } },
    { name: 'sales.json', data: { code: 0, data: { items: salesRecords, total: salesRecords.length } } },
    { name: 'location.json', data: { code: 0, data: { items: locationRecords, total: locationRecords.length } } },
  ];

  let totalSize = 0;
  for (const file of files) {
    const filePath = path.join(dataDir, file.name);
    const json = JSON.stringify(file.data);
    fs.writeFileSync(filePath, json, 'utf-8');
    const kb = json.length / 1024;
    totalSize += kb;
    console.log(`  ✅ ${file.name} (${kb.toFixed(1)} KB)`);
  }

  console.log(`\n========================================`);
  console.log(`  Done! Total: ${totalSize.toFixed(1)} KB`);
  console.log(`  Files in: public/data/`);
  console.log(`========================================`);
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
