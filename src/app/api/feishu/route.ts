import { NextRequest, NextResponse } from 'next/server';

// 飞书多维表格配置（从环境变量读取）
const FEISHU_CONFIG = {
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  appToken: process.env.FEISHU_APP_TOKEN || '',
  baseUrl: 'https://open.feishu.cn/open-apis',
};

// 数据表ID（从环境变量读取）
const INVENTORY_TABLE_ID = process.env.FEISHU_INVENTORY_TABLE_ID || 'tbl9hrCakoLZfa7N';
const LOCATION_TABLE_ID = process.env.FEISHU_LOCATION_TABLE_ID || 'tbl8f2AUadoiVnuL';
const SALES_TABLE_ID = process.env.FEISHU_SALES_TABLE_ID || 'tbl6ACKuTrBFsBOP';
const LAYOUT_CONFIG_TABLE_ID = process.env.FEISHU_LAYOUT_CONFIG_TABLE_ID || 'tblSCuhCIfNmZe1o';

// 缓存 access_token
let cachedToken: { token: string; expiresAt: number } | null = null;

// 缓存 match 数据（5分钟过期）
let cachedMatchData: { data: any; expiresAt: number } | null = null;
const MATCH_CACHE_TTL = 5 * 60 * 1000; // 5分钟

// 获取 tenant_access_token
async function getAccessToken(): Promise<string> {
  // 如果有缓存且未过期，直接返回
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  console.log('Fetching new access token...');
  
  // 使用重试机制获取token
  const data = await retryWithBackoff(async () => {
    const response = await fetch(
      `${FEISHU_CONFIG.baseUrl}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: FEISHU_CONFIG.appId,
          app_secret: FEISHU_CONFIG.appSecret,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HTTP error: ${response.status} - ${errorText}`);
      throw new Error(`HTTP error: ${response.status}`);
    }

    return await response.json();
  }, 3, 1000); // 最多重试3次

  if (data.code !== 0) {
    console.error(`Failed to get access token: ${data.code} - ${data.msg}`);
    throw new Error(`获取访问令牌失败: ${data.msg}`);
  }

  // 缓存 token，提前 5 分钟过期
  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 300) * 1000,
  };

  console.log('Access token refreshed successfully');
  return data.tenant_access_token;
}

// 获取多维表格的所有数据表
async function getTables(accessToken: string) {
  const response = await fetch(
    `${FEISHU_CONFIG.baseUrl}/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.json();
}

// 获取数据表的所有字段
async function getFields(accessToken: string, tableId: string) {
  const response = await fetch(
    `${FEISHU_CONFIG.baseUrl}/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${tableId}/fields`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.json();
}

// 获取数据表的所有记录（带重试）
async function getRecords(accessToken: string, tableId: string, pageSize: number = 500) {
  const allRecords: any[] = [];
  let pageToken: string | undefined;
  let hasMore = true;
  let attempt = 0;
  
  while (hasMore) {
    const url = new URL(
      `${FEISHU_CONFIG.baseUrl}/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${tableId}/records`
    );
    url.searchParams.set('page_size', String(pageSize));
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }
    
    console.log(`Fetching records (attempt ${++attempt})...`);
    
    // 使用重试机制包装API调用
    const data = await retryWithBackoff(async () => {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP error: ${response.status} - ${errorText}`);
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      return await response.json();
    }, 3, 2000); // 最多重试3次，每次间隔2秒、4秒、8秒
    
    if (data.code !== 0) {
      console.error(`Feishu API error: ${data.code} - ${data.msg}`);
      throw new Error(`获取记录失败: ${data.msg}`);
    }
    
    if (data.data?.items) {
      const itemCount = data.data.items.length;
      console.log(`Fetched ${itemCount} records, total so far: ${allRecords.length + itemCount}`);
      allRecords.push(...data.data.items);
    }
    
    pageToken = data.data?.page_token;
    hasMore = data.data?.has_more || false;
  }
  
  console.log(`Total records fetched: ${allRecords.length}`);
  return allRecords;
}

// 延迟函数
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 重试包装器（支持指数退避）
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt + 1}/${maxRetries + 1} failed:`, error);
      
      // 如果是最后一次尝试，抛出错误
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      // 计算指数退避延迟
      const delayMs = baseDelay * Math.pow(2, attempt);
      console.log(`Retrying after ${delayMs}ms...`);
      await delay(delayMs);
    }
  }
  
  throw lastError;
}

// 创建记录（带重试）
async function createRecord(accessToken: string, tableId: string, fields: any, retries: number = 3) {
  console.log('createRecord called:', tableId);
  console.log('fields:', JSON.stringify(fields, null, 2));
  
  return retryWithBackoff(async () => {
    const response = await fetch(
      `${FEISHU_CONFIG.baseUrl}/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${tableId}/records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    );
    
    console.log('createRecord response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('createRecord error response:', errorText);
      throw new Error(`createRecord failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('createRecord result:', JSON.stringify(result));
    
    if (result.code !== 0) {
      throw new Error(`createRecord failed: ${result.msg}`);
    }
    
    return result;
  }, retries);
}

// 删除记录
async function deleteRecord(accessToken: string, tableId: string, recordId: string) {
  console.log('deleteRecord called:', tableId, recordId);
  
  return retryWithBackoff(async () => {
    const response = await fetch(
      `${FEISHU_CONFIG.baseUrl}/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${tableId}/records/${recordId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('deleteRecord error response:', errorText);
      throw new Error(`deleteRecord failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('deleteRecord result:', JSON.stringify(result));
    
    if (result.code !== 0 && result.code !== 99991663) { // 99991663 表示记录不存在，可以忽略
      throw new Error(`deleteRecord failed: ${result.msg}`);
    }
    
    return result;
  }, 3);
}

// 更新记录
async function updateRecord(accessToken: string, tableId: string, recordId: string, fields: any) {
  console.log('updateRecord called:', tableId, recordId);
  console.log('fields:', JSON.stringify(fields, null, 2));
  const response = await fetch(
    `${FEISHU_CONFIG.baseUrl}/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${tableId}/records/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  );
  console.log('updateRecord response status:', response.status, response.statusText);
  console.log('updateRecord response ok:', response.ok);
  console.log('updateRecord response headers:', Object.fromEntries(response.headers.entries()));

  if (!response.ok) {
    const errorText = await response.text();
    console.error('updateRecord error response:', errorText);
    throw new Error(`Update failed: ${response.status} - ${errorText}`);
  }

  const text = await response.text();
  console.log('updateRecord response text length:', text.length);
  console.log('updateRecord response text:', text);

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('Failed to parse updateRecord response:', error);
    console.error('Response text:', text);
    throw error;
  }
}

// 上传图片到飞书云文档（带重试）
async function uploadFeishuImage(accessToken: string, imageBuffer: Buffer, fileName: string): Promise<string> {
  console.log('Uploading image to Feishu:', fileName);
  
  return retryWithBackoff(async () => {
    const formData = new FormData();
    // 将 Buffer 转换为 Uint8Array 再转为 Blob
    const uint8Array = new Uint8Array(imageBuffer);
    const blob = new Blob([uint8Array]);
    formData.append('file', blob, fileName);
    formData.append('file_name', fileName);
    formData.append('parent_type', 'bitable_image');
    formData.append('parent_id', FEISHU_CONFIG.appToken);
    
    const response = await fetch(
      `${FEISHU_CONFIG.baseUrl}/drive/v1/medias/upload_all`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        body: formData,
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('uploadFeishuImage error:', errorText);
      throw new Error(`Upload failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.code !== 0) {
      console.error('uploadFeishuImage failed:', result);
      throw new Error(`Upload failed: ${result.msg}`);
    }
    
    console.log('Image uploaded successfully, file_token:', result.data.file_token);
    return result.data.file_token;
  }, 3, 1000);
}

// 上传文件到飞书云盘（带重试）
async function uploadFileToFeishuDrive(accessToken: string, fileContent: Buffer, fileName: string, parentToken: string = ''): Promise<{ file_token: string; rev: string }> {
  console.log('Uploading file to Feishu Drive:', fileName, 'size:', fileContent.length);
  
  return retryWithBackoff(async () => {
    const formData = new FormData();
    const uint8Array = new Uint8Array(fileContent);
    const blob = new Blob([uint8Array]);
    
    // 添加文件
    formData.append('file', blob, fileName);
    // 文件名
    formData.append('file_name', fileName);
    // 文件大小（飞书API需要）
    formData.append('size', String(fileContent.length));
    // 父文件夹类型 - explorer 表示上传到云盘
    formData.append('parent_type', 'drive');
    // 父文件夹token - 指定文件夹
    formData.append('parent_node', 'LTHPfSY4WlI3tEdoCYkcQ5Wyn5g');
    
    console.log('Uploading to Feishu Drive with params:', {
      file_name: fileName,
      size: fileContent.length,
      parent_type: 'drive_file',
      parent_node: '(root)',
    });
    
    const response = await fetch(
      `${FEISHU_CONFIG.baseUrl}/drive/v1/files/upload_all`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        body: formData,
      }
    );
    
    const responseText = await response.text();
    console.log('uploadFileToFeishuDrive response status:', response.status);
    console.log('uploadFileToFeishuDrive response body:', responseText);
    
    if (!response.ok) {
      console.error('uploadFileToFeishuDrive HTTP error:', responseText);
      throw new Error(`Upload failed: ${response.status}`);
    }
    
    const result = JSON.parse(responseText);
    
    if (result.code !== 0) {
      console.error('uploadFileToFeishuDrive failed:', result);
      throw new Error(`Upload failed: ${result.msg}`);
    }
    
    console.log('File uploaded to Drive successfully, file_token:', result.data.file_token);
    return {
      file_token: result.data.file_token,
      rev: result.data.rev,
    };
  }, 3, 1000);
}

// 下载飞书云盘文件
async function downloadFileFromFeishuDrive(accessToken: string, fileToken: string): Promise<Buffer> {
  console.log('Downloading file from Feishu Drive:', fileToken);
  
  // 飞书云盘文件下载API
  const response = await fetch(
    `${FEISHU_CONFIG.baseUrl}/drive/v1/files/${fileToken}/download`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('downloadFileFromFeishuDrive error:', response.status, errorText);
    throw new Error(`Download failed: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  console.log('File downloaded from Drive successfully, size:', arrayBuffer.byteLength);
  return Buffer.from(arrayBuffer);
}

// 获取飞书图片并转为base64（用于前端直接使用）
async function getFeishuImageAsBase64(accessToken: string, fileToken: string): Promise<string> {
  console.log('Downloading Feishu image as base64, token:', fileToken);
  
  // 飞书图片下载API
  const response = await fetch(
    `${FEISHU_CONFIG.baseUrl}/drive/v1/medias/${fileToken}/download`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to download Feishu image:', errorText);
    throw new Error(`Download failed: ${response.status}`);
  }
  
  const contentType = response.headers.get('Content-Type') || 'image/jpeg';
  const imageBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString('base64');
  
  console.log('Image converted to base64 successfully');
  return `data:${contentType};base64,${base64}`;
}

// 批量处理函数（带并发限制）
async function processBatch<T, R>(
  items: T[],
  processFn: (item: T) => Promise<R>,
  concurrency: number = 10
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = processFn(item).then(result => {
      results.push(result);
    }).catch(error => {
      console.error('Batch processing error:', error);
      throw error;
    });
    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // 移除已完成的promise
      executing.splice(
        executing.findIndex(p => {
          const s = p as any;
          return s._settled;
        }),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

// 将长字符串拆分到多个部分（每个部分不超过指定长度）
function splitStringToParts(str: string, maxLength: number = 2500): string[] {
  const parts: string[] = [];
  for (let i = 0; i < str.length; i += maxLength) {
    parts.push(str.slice(i, i + maxLength));
  }
  return parts;
}

// 从多个部分合并字符串
function mergeStringParts(parts: string[]): string {
  return parts.filter(p => p && p.trim() !== '').join('');
}

// 清理字段值（去掉 ="xxx" 格式的前缀和引号）
function cleanFieldValue(value: any): any {
  if (typeof value === 'string') {
    // 去掉 ="xxx" 格式
    if (value.startsWith('="') && value.endsWith('"')) {
      return value.slice(2, -1);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(v => cleanFieldValue(v));
  }
  return value;
}

// 处理不同类型的字段值
function getFieldValue(fieldValue: any): any {
  if (!fieldValue) return null;
  
  // 如果是字符串，直接返回（可能是已经解析过的值）
  if (typeof fieldValue === 'string') {
    return cleanFieldValue(fieldValue);
  }
  
  const type = Object.keys(fieldValue)[0];
  const value = cleanFieldValue(fieldValue[type]);
  
  switch (type) {
    case 'text':
    case 'singleSelect':
    case 'email':
    case 'phone':
    case 'url':
    case 'barcode':
      return value || '';
    case 'number':
    case 'currency':
    case 'progress':
    case 'rating':
      return value ?? 0;
    case 'multipleSelect':
      return Array.isArray(value) ? value.join(', ') : '';
    case 'dateTime':
      return value ? new Date(value).toLocaleString('zh-CN') : '';
    case 'checkbox':
      return value ? '是' : '否';
    case 'user':
      return Array.isArray(value) ? value.map((u: any) => u.name || u.id).join(', ') : '';
    case 'attachment':
      return Array.isArray(value) ? value.map((a: any) => a.name).join(', ') : '';
    case 'link':
      return Array.isArray(value) ? value.join(', ') : '';
    case 'location':
      return value?.address || '';
    case 'group':
      return value?.group_name || '';
    default:
      return cleanFieldValue(value);
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'tables';
    
    const accessToken = await getAccessToken();
    
    if (action === 'tables') {
      // 获取所有数据表
      const data = await getTables(accessToken);
      return NextResponse.json(data);
    }
    
    if (action === 'fields') {
      // 获取指定表的字段
      const tableId = searchParams.get('tableId');
      if (!tableId) {
        return NextResponse.json({ error: '缺少 tableId 参数' }, { status: 400 });
      }
      const data = await getFields(accessToken, tableId);
      return NextResponse.json(data);
    }
    
    if (action === 'records') {
      // 获取指定表的记录
      const tableId = searchParams.get('tableId');
      if (!tableId) {
        return NextResponse.json({ error: '缺少 tableId 参数' }, { status: 400 });
      }
      const records = await getRecords(accessToken, tableId);
      return NextResponse.json({ code: 0, data: { items: records, total: records.length } });
    }
    
    if (action === 'listDriveFiles') {
      // 列出云盘中的文件（测试用）
      console.log('Listing Drive files...');
      const response = await fetch(
        `${FEISHU_CONFIG.baseUrl}/drive/v1/files?page_size=50`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      const result = await response.json();
      console.log('Drive files result:', JSON.stringify(result));
      return NextResponse.json(result);
    }
    
    if (action === 'match') {
      // 检查缓存（除非强制刷新）
      const forceRefresh = searchParams.get('force') === 'true';
      if (!forceRefresh && cachedMatchData && cachedMatchData.expiresAt > Date.now()) {
        return NextResponse.json(cachedMatchData.data);
      }
      
      // 匹配销售表和区位表数据（同时拉取库存表用于条形码->款号归一化）
      const [salesRecords, locationRecords, inventoryRecords] = await Promise.all([
        getRecords(accessToken, SALES_TABLE_ID),
        getRecords(accessToken, LOCATION_TABLE_ID),
        getRecords(accessToken, INVENTORY_TABLE_ID),
      ]);
      
      // 建立 国标码 -> 款号 映射：区位表有时用条形码当"款号"，库存表是两者桥梁
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
      
      // 以款号为键汇总销售数据（排除线上数据）
      const salesByStyleCode = new Map<string, { quantity: number; amount: number; count: number }>();
      // 中类销售汇总
      const salesBySubCategory = new Map<string, { quantity: number; amount: number; count: number }>();
      // 时段销售汇总
      const salesByHour = new Map<number, { quantity: number; amount: number; count: number }>();
      // 款号到品类的映射（从销售表获取）
      const styleCodeToCategory = new Map<string, string>();
      // 中类+性别+时段三维汇总 (用于表格展示)
      // key格式: "中类|性别|时段"
      const salesBySubCategoryGenderHour = new Map<string, { quantity: number; amount: number }>();
      
      // ===== 线上销售数据统计（手动改价="Y"）=====
      const onlineSalesByStyleCode = new Map<string, { quantity: number; amount: number; count: number }>();
      const onlineSalesBySubCategory = new Map<string, { quantity: number; amount: number; count: number }>();
      const onlineSalesByHour = new Map<number, { quantity: number; amount: number; count: number }>();
      const onlineSalesBySubCategoryGenderHour = new Map<string, { quantity: number; amount: number }>();
      const onlineStyleCodeToCategory = new Map<string, string>();
      
      salesRecords.forEach((record: any) => {
        const fields = record.fields || {};
        // 字段值已经是字符串格式，直接清理
        const styleCode = cleanFieldValue(fields['款号']);
        const quantity = parseInt(cleanFieldValue(fields['数量'])) || 0;
        // 尝试多个可能的金额字段名
        const amount = parseInt(cleanFieldValue(fields['成交金额 (1)'])) || 
                       parseInt(cleanFieldValue(fields['成交金额（1）'])) ||
                       parseInt(cleanFieldValue(fields['成交金额'])) || 0;
        
        // 检查是否为线上数据（手工改价/手动改价="Y"）
        const manualChangePrice = cleanFieldValue(fields['手工改价']) || cleanFieldValue(fields['手动改价']);
        const isOnline = manualChangePrice === 'Y';
        
        if (styleCode) {
          // 获取品类（大类）
          const category = cleanFieldValue(fields['款号.大类.属性描述']);
          // 中类
          const subCategory = cleanFieldValue(fields['PS中类']);
          // 性别
          const gender = cleanFieldValue(fields['款号性别']);
          // 时段（从创建时间提取小时）
          const createdAt = fields['创建时间'];
          let hour = -1;
          if (createdAt) {
            const date = new Date(createdAt);
            hour = date.getHours();
          }
          
          if (isOnline) {
            // 线上数据单独统计
            const onlineExisting = onlineSalesByStyleCode.get(styleCode) || { quantity: 0, amount: 0, count: 0 };
            onlineExisting.quantity += quantity;
            onlineExisting.amount += amount;
            onlineExisting.count += 1;
            onlineSalesByStyleCode.set(styleCode, onlineExisting);
            
            if (category) {
              onlineStyleCodeToCategory.set(styleCode, category);
            }
            
            if (subCategory) {
              const onlineSubCatExisting = onlineSalesBySubCategory.get(subCategory) || { quantity: 0, amount: 0, count: 0 };
              onlineSubCatExisting.quantity += quantity;
              onlineSubCatExisting.amount += amount;
              onlineSubCatExisting.count += 1;
              onlineSalesBySubCategory.set(subCategory, onlineSubCatExisting);
            }
            
            if (hour >= 0) {
              const onlineHourExisting = onlineSalesByHour.get(hour) || { quantity: 0, amount: 0, count: 0 };
              onlineHourExisting.quantity += quantity;
              onlineHourExisting.amount += amount;
              onlineHourExisting.count += 1;
              onlineSalesByHour.set(hour, onlineHourExisting);
            }
            
            if (subCategory && gender && hour >= 0) {
              const key = `${subCategory}|${gender}|${hour}`;
              const existing = onlineSalesBySubCategoryGenderHour.get(key) || { quantity: 0, amount: 0 };
              existing.quantity += quantity;
              existing.amount += amount;
              onlineSalesBySubCategoryGenderHour.set(key, existing);
            }
          } else {
            // 卖场数据统计（排除线上）
            const existing = salesByStyleCode.get(styleCode) || { quantity: 0, amount: 0, count: 0 };
            existing.quantity += quantity;
            existing.amount += amount;
            existing.count += 1;
            salesByStyleCode.set(styleCode, existing);
            
            if (category) {
              styleCodeToCategory.set(styleCode, category);
            }
            
            if (subCategory) {
              const subCatExisting = salesBySubCategory.get(subCategory) || { quantity: 0, amount: 0, count: 0 };
              subCatExisting.quantity += quantity;
              subCatExisting.amount += amount;
              subCatExisting.count += 1;
              salesBySubCategory.set(subCategory, subCatExisting);
            }
            
            if (hour >= 0) {
              const hourExisting = salesByHour.get(hour) || { quantity: 0, amount: 0, count: 0 };
              hourExisting.quantity += quantity;
              hourExisting.amount += amount;
              hourExisting.count += 1;
              salesByHour.set(hour, hourExisting);
            }
            
            if (subCategory && gender && hour >= 0) {
              const key = `${subCategory}|${gender}|${hour}`;
              const existing = salesBySubCategoryGenderHour.get(key) || { quantity: 0, amount: 0 };
              existing.quantity += quantity;
              existing.amount += amount;
              salesBySubCategoryGenderHour.set(key, existing);
            }
          }
        }
      });
      
      // 第一步：统计每个款号出现在多少个卖场区位（5或6开头，去重）
      const styleCodeStoreLocationCount = new Map<string, number>();
      const styleCodeStoreLocationMap = new Map<string, Set<string>>();
      // 保存所有区位（用于显示）
      const styleCodeAllLocationMap = new Map<string, Set<string>>();
      
      locationRecords.forEach((record: any) => {
        const fields = record.fields || {};
        const locationId = cleanFieldValue(fields['货架号']);
        const rawStyleCode = cleanFieldValue(fields['款号']);
        const styleCode = normalizeStyleCode(rawStyleCode);
        
        if (locationId && styleCode) {
          // 保存所有区位
          if (!styleCodeAllLocationMap.has(styleCode)) {
            styleCodeAllLocationMap.set(styleCode, new Set());
          }
          styleCodeAllLocationMap.get(styleCode)!.add(locationId);
          
          // 只统计卖场区位（5或6开头）
          if (locationId.startsWith('5') || locationId.startsWith('6')) {
            if (!styleCodeStoreLocationMap.has(styleCode)) {
              styleCodeStoreLocationMap.set(styleCode, new Set());
            }
            styleCodeStoreLocationMap.get(styleCode)!.add(locationId);
          }
        }
      });
      
      // 计算每个款号的卖场区位数量
      styleCodeStoreLocationMap.forEach((locations, styleCode) => {
        styleCodeStoreLocationCount.set(styleCode, locations.size);
      });
      
      // 第二步：以货架号为键汇总区位销售数据（只对卖场区位分摊销售数据）
      const locationSales = new Map<string, { styleCodes: string[]; quantity: number; amount: number; count: number }>();
      
      locationRecords.forEach((record: any) => {
        const fields = record.fields || {};
        const locationId = cleanFieldValue(fields['货架号']);
        const rawStyleCode = cleanFieldValue(fields['款号']);
        const styleCode = normalizeStyleCode(rawStyleCode);
        
        if (locationId && styleCode) {
          const existing = locationSales.get(locationId) || { styleCodes: [], quantity: 0, amount: 0, count: 0 };
          
          // 只有当款号第一次出现时才添加款号，避免重复
          if (!existing.styleCodes.includes(styleCode)) {
            existing.styleCodes.push(styleCode);
            
            // 只有卖场区位（5或6开头）才分摊销售数据
            const isStoreLocation = locationId.startsWith('5') || locationId.startsWith('6');
            
            if (isStoreLocation) {
              const sales = salesByStyleCode.get(styleCode);
              // 使用卖场区位数量计算平均值
              const storeLocationCount = styleCodeStoreLocationCount.get(styleCode) || 1;
              
              if (sales && storeLocationCount > 0) {
                // 按卖场区位数量平均分摊销售数据
                existing.quantity += sales.quantity / storeLocationCount;
                existing.amount += sales.amount / storeLocationCount;
                existing.count += sales.count / storeLocationCount;
              }
            }
            // 仓库区位不分配销售数据，保持为0
          }
          
          locationSales.set(locationId, existing);
        }
      });
      
      // 转换为数组格式（销售数据取整）
      const result = Array.from(locationSales.entries()).map(([locationId, data]) => ({
        id: locationId,
        styleCodes: data.styleCodes,
        salesQuantity: Math.round(data.quantity),
        salesAmount: Math.round(data.amount),
        transactionCount: Math.round(data.count),
      }));
      
      // 将卖场区位数量转换为普通对象，方便JSON序列化
      const styleCodeLocationCountObj: Record<string, number> = {};
      styleCodeStoreLocationCount.forEach((count, styleCode) => {
        styleCodeLocationCountObj[styleCode] = count;
      });
      
      // 将款号对应的卖场区位列表转换为普通对象（只保留5或6开头的卖场区位）
      const styleCodeLocationsObj: Record<string, string[]> = {};
      styleCodeStoreLocationMap.forEach((locations, styleCode) => {
        styleCodeLocationsObj[styleCode] = Array.from(locations);
      });
      
      const responseData = {
        code: 0,
        data: {
          locations: result,
          styleCodeLocationCount: styleCodeLocationCountObj,
          styleCodeLocations: styleCodeLocationsObj,
          // 中类销售数据
          subCategorySales: Object.fromEntries(
            Array.from(salesBySubCategory.entries()).map(([name, data]) => [
              name,
              { quantity: data.quantity, amount: data.amount, count: data.count }
            ])
          ),
          // 时段销售数据
          hourlySales: Object.fromEntries(
            Array.from(salesByHour.entries()).map(([hour, data]) => [
              hour,
              { quantity: data.quantity, amount: data.amount, count: data.count }
            ])
          ),
          // 款号到品类的映射
          styleCodeCategory: Object.fromEntries(styleCodeToCategory),
          // 中类+性别+时段三维数据
          subCategoryGenderHour: Object.fromEntries(salesBySubCategoryGenderHour),
          // ===== 线上销售数据 =====
          onlineSales: {
            // 线上款号销售
            byStyleCode: Object.fromEntries(onlineSalesByStyleCode),
            // 线上中类销售
            bySubCategory: Object.fromEntries(
              Array.from(onlineSalesBySubCategory.entries()).map(([name, data]) => [
                name,
                { quantity: data.quantity, amount: data.amount, count: data.count }
              ])
            ),
            // 线上时段销售
            byHour: Object.fromEntries(
              Array.from(onlineSalesByHour.entries()).map(([hour, data]) => [
                hour,
                { quantity: data.quantity, amount: data.amount, count: data.count }
              ])
            ),
            // 线上中类+性别+时段三维数据
            bySubCategoryGenderHour: Object.fromEntries(onlineSalesBySubCategoryGenderHour),
            // 线上款号到品类的映射
            styleCodeCategory: Object.fromEntries(onlineStyleCodeToCategory),
          },
          stats: {
            totalLocations: locationSales.size,
            totalSales: salesRecords.length,
            totalStyleCodes: salesByStyleCode.size,
            // 线上统计
            onlineTransactions: Array.from(onlineSalesByStyleCode.values()).reduce((sum, d) => sum + d.count, 0),
            onlineStyleCodes: onlineSalesByStyleCode.size,
          },
        },
      };
      
      // 缓存结果
      cachedMatchData = {
        data: responseData,
        expiresAt: Date.now() + MATCH_CACHE_TTL,
      };
      
      return NextResponse.json(responseData);
    }
    
    if (action === 'location-skus') {
      // 获取指定区位的SKU详情列表
      const locationId = searchParams.get('locationId');
      if (!locationId) {
        return NextResponse.json({ error: '缺少 locationId 参数' }, { status: 400 });
      }
      
      // 并行获取区位表、销售表、库存表数据
      const [locationRecords, salesRecords, inventoryRecords] = await Promise.all([
        getRecords(accessToken, LOCATION_TABLE_ID),
        getRecords(accessToken, SALES_TABLE_ID),
        getRecords(accessToken, INVENTORY_TABLE_ID),
      ]);
      
      // 建立 国标码 -> 款号 映射（区位表有时用条形码当"款号"）
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
      
      // 找到该区位下的所有款号（支持模糊匹配）
      const styleCodesInLocation: string[] = [];
      locationRecords.forEach((record: any) => {
        const fields = record.fields || {};
        const locId = cleanFieldValue(fields['货架号']);
        const rawStyleCode = cleanFieldValue(fields['款号']);
        const styleCode = normalizeStyleCode(rawStyleCode);
        
        // 模糊匹配：区位ID前缀匹配或精确匹配
        if (locId && styleCode && (locId === locationId || locId.startsWith(locationId) || locationId.startsWith(locId))) {
          if (!styleCodesInLocation.includes(styleCode)) {
            styleCodesInLocation.push(styleCode);
          }
        }
      });
      
      // 汇总销售数据
      const salesByStyleCode = new Map<string, { quantity: number; amount: number }>();
      salesRecords.forEach((record: any) => {
        const fields = record.fields || {};
        const styleCode = cleanFieldValue(fields['款号']);
        const quantity = parseInt(cleanFieldValue(fields['数量'])) || 0;
        // 尝试多个可能的金额字段名
        const amount = parseInt(cleanFieldValue(fields['成交金额 (1)'])) || 
                       parseInt(cleanFieldValue(fields['成交金额（1）'])) ||
                       parseInt(cleanFieldValue(fields['成交金额'])) || 0;
        
        if (styleCode) {
          const existing = salesByStyleCode.get(styleCode) || { quantity: 0, amount: 0 };
          existing.quantity += quantity;
          existing.amount += amount;
          salesByStyleCode.set(styleCode, existing);
        }
      });
      
      // 建立库存数据映射（以款号为键，取第一条记录）
      const inventoryByStyleCode = new Map<string, any>();
      inventoryRecords.forEach((record: any) => {
        const fields = record.fields || {};
        const styleCode = cleanFieldValue(fields['款号']);
        
        if (styleCode && !inventoryByStyleCode.has(styleCode)) {
          inventoryByStyleCode.set(styleCode, {
            name: cleanFieldValue(fields['品名']) || '',
            size: cleanFieldValue(fields['尺寸']) || '',
            price: parseFloat(cleanFieldValue(fields['价格'])) || 0,
            stock: parseInt(cleanFieldValue(fields['库存'])) || 0,
            imageUrl: cleanFieldValue(fields['图片链接']) || '',
          });
        }
      });
      
      // 组装SKU详情列表
      const skuDetails = styleCodesInLocation.map(styleCode => {
        const sales = salesByStyleCode.get(styleCode) || { quantity: 0, amount: 0 };
        const inventory = inventoryByStyleCode.get(styleCode) || { name: '', size: '', price: 0, stock: 0, imageUrl: '' };
        
        // 处理图片URL：如果已经是完整URL则直接使用，否则拼接飞书域名
        let imageUrl = inventory.imageUrl;
        if (imageUrl && !imageUrl.startsWith('http')) {
          imageUrl = `https://ncnefidnowjl.feishu.cn${imageUrl}`;
        }
        
        return {
          styleCode,
          name: inventory.name,
          size: inventory.size,
          price: inventory.price,
          stock: inventory.stock,
          salesQuantity: sales.quantity,
          salesAmount: sales.amount,
          imageUrl,
        };
      });
      
      return NextResponse.json({
        code: 0,
        data: {
          locationId,
          skuCount: skuDetails.length,
          skus: skuDetails,
        },
      });
    }
    
    if (action === 'loadLayout') {
      // 从飞书表格加载布局配置
      const floor = searchParams.get('floor') || '5';
      
      console.log(`Loading layout for floor ${floor}...`);
      
      // 从布局配置表读取所有记录
      const layoutRecords = await getRecords(accessToken, LAYOUT_CONFIG_TABLE_ID);
      
      // 查找该楼层的所有记录
      const floorRecords = layoutRecords.filter((record: any) => {
        const fields = record.fields || {};
        const floorId = cleanFieldValue(fields['楼层ID']);
        return floorId === floor || floorId === `__META_${floor}F__`;
      });
      
      if (floorRecords.length === 0) {
        return NextResponse.json({ code: 1, error: '该楼层暂无保存的布局配置' });
      }
      
      console.log(`Found ${floorRecords.length} layout records for floor ${floor}`);
      
      // 提取所有区位和背景图
      const locations: any[] = [];
      let backgroundImage = '';
      let updatedAt = 0;
      
      for (const record of floorRecords) {
        const fields = record.fields || {};
        
        // 解析区位布局
        const locationLayoutField = fields['区位布局'] || {};
        const locationLayoutStr = cleanFieldValue(locationLayoutField);
        if (locationLayoutStr) {
          try {
            const location = JSON.parse(locationLayoutStr);
            
            // 判断是否为元数据记录
            if (location.type === 'meta') {
              updatedAt = location.updatedAt || 0;
            } else {
              // 这是区位记录
              locations.push(location);
            }
          } catch {
            console.error('Failed to parse location layout:', locationLayoutStr);
          }
        }
        
        // 尝试从元数据记录读取背景图
        const floorId = cleanFieldValue(fields['楼层ID']);
        if (floorId === `__META_${floor}F__`) {
          // 从飞书云文档图片Token读取
          const feishuImageToken = cleanFieldValue(fields['飞书图片Token']);
          if (feishuImageToken) {
            try {
              console.log('Downloading Feishu cloud image for token:', feishuImageToken);
              backgroundImage = await getFeishuImageAsBase64(accessToken, feishuImageToken);
              console.log('Got Feishu cloud image as base64 successfully');
            } catch (error) {
              console.error('Failed to get Feishu image:', error);
            }
          }
          
          // 尝试从拆分的背景图列读取（多单元格存储）
          if (!backgroundImage) {
            const chunks: string[] = [];
            let chunkIndex = 1;
            while (true) {
              const chunkValue = cleanFieldValue(fields[`背景图_${chunkIndex}`]);
              if (chunkValue) {
                chunks.push(chunkValue);
                chunkIndex++;
              } else {
                break;
              }
            }
            if (chunks.length > 0) {
              backgroundImage = mergeStringParts(chunks);
              console.log(`Merged ${chunks.length} chunks for multi-cell background image`);
            }
          }
        }
      }
      
      console.log(`Loaded ${locations.length} locations and ${backgroundImage ? 'has' : 'no'} background image for floor ${floor}`);
      
      if (locations.length === 0) {
        return NextResponse.json({ code: 1, error: '布局配置为空' });
      }
      
      // 组装完整的布局数据
      const layoutData = {
        version: 1,
        floor,
        locations,
        backgroundImage,
        updatedAt,
      };
      
      return NextResponse.json({ code: 0, data: layoutData });
    }
    
    return NextResponse.json({ error: '未知的 action 参数' }, { status: 400 });
  } catch (error) {
    console.error('飞书API调用错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('POST request body:', JSON.stringify(body));
    
    // 保存布局配置到飞书表格
    if (body.action === 'saveLayout') {
      console.log('Processing saveLayout action');
      const { floor, locations, backgroundImage } = body;
      
      if (!floor || !locations) {
        return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
      }
      
      const accessToken = await getAccessToken();
      
      // 读取布局配置表所有记录
      const layoutRecords = await getRecords(accessToken, LAYOUT_CONFIG_TABLE_ID);
      console.log('layoutRecords count:', layoutRecords.length);
      
      // 查找该楼层的所有旧记录（包括区位记录和元数据记录）
      const floorRecords = layoutRecords.filter((record: any) => {
        const fields = record.fields || {};
        const floorId = cleanFieldValue(fields['楼层ID']);
        return floorId === floor || floorId === `__META_${floor}F__`;
      });
      
      console.log('floorRecords found:', floorRecords.length);
      
      // 并行删除该楼层的所有旧记录（使用并发限制防止触发限流）
      if (floorRecords.length > 0) {
        console.log('Deleting old records in parallel...');
        await processBatch(
          floorRecords.filter(r => r.id),
          async (record) => {
            console.log('Deleting old record:', record.id);
            await deleteRecord(accessToken, LAYOUT_CONFIG_TABLE_ID, record.id);
          },
          5 // 降低并发限制为5，避免触发限流
        );
        console.log('All old records deleted');
        
        // 删除后等待一段时间，确保飞书服务器处理完成
        console.log('Waiting for deletion to propagate...');
        await delay(1000); // 等待1秒
      }
      
      // 1. 先保存区位配置到布局配置表
      const updatedAt = Math.floor(new Date().getTime() / 1000); // 秒级时间戳
      
      // 处理背景图（优先使用飞书云文档，失败则使用多单元格存储）
      let backgroundImageKey = '';
      let storageType = 'feishu-cloud'; // 改用飞书云文档存储
      const backgroundImageChunks: Record<string, string> = {};
      
      if (backgroundImage) {
        const isBase64Image = backgroundImage?.startsWith('data:image/');
        
        if (isBase64Image) {
          // 尝试上传到飞书云文档
          try {
            console.log('Uploading background image to Feishu cloud...');
            
            const matches = backgroundImage.match(/^data:image\/(\w+);base64,(.+)$/);
            if (!matches) {
              throw new Error('Invalid base64 image format');
            }
            
            const imageType = matches[1];
            const base64Data = matches[2];
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            const timestamp = Date.now();
            const fileName = `layout_bg_${floor}_${timestamp}.${imageType}`;
            
            backgroundImageKey = await uploadFeishuImage(accessToken, imageBuffer, fileName);
            
            storageType = 'feishu-cloud';
            console.log('Background image uploaded to Feishu successfully, file_token:', backgroundImageKey);
          } catch (error) {
            console.error('Failed to upload to Feishu cloud, using multi-cell storage:', error);
            storageType = 'multi-cell';
            const chunks = splitStringToParts(backgroundImage, 2500);
            chunks.forEach((chunk, index) => {
              backgroundImageChunks[`背景图_${index + 1}`] = chunk;
            });
            console.log(`Split background image into ${chunks.length} chunks`);
          }
        } else if (backgroundImage && !backgroundImage.startsWith('http')) {
          // 已经是存储的file_token
          backgroundImageKey = backgroundImage;
          storageType = 'feishu-cloud';
          console.log('Using existing Feishu file_token:', backgroundImageKey);
        } else if (backgroundImage) {
          // 外部URL，尝试下载后上传到飞书
          try {
            console.log('Downloading external background image...');
            const response = await fetch(backgroundImage);
            if (!response.ok) {
              throw new Error(`Failed to download image: ${response.statusText}`);
            }
            
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            const imageType = contentType.split('/')[1] || 'jpg';
            
            const timestamp = Date.now();
            const fileName = `layout_bg_${floor}_${timestamp}.${imageType}`;
            
            backgroundImageKey = await uploadFeishuImage(accessToken, imageBuffer, fileName);
            
            storageType = 'feishu-cloud';
            console.log('External image uploaded to Feishu successfully, file_token:', backgroundImageKey);
          } catch (error) {
            console.error('Failed to download/upload external image, using multi-cell storage:', error);
            storageType = 'multi-cell';
            const chunks = splitStringToParts(backgroundImage, 2500);
            chunks.forEach((chunk, index) => {
              backgroundImageChunks[`背景图_${index + 1}`] = chunk;
            });
            console.log(`Split background image into ${chunks.length} chunks`);
          }
        }
      }
      
      // 创建元数据记录（存储更新时间、背景图Key和存储方式）
      const metadataFields: any = {
        '楼层ID': `__META_${floor}F__`,
        '区位布局': JSON.stringify({
          type: 'meta',
          updatedAt,
          storageType,
        }),
      };
      
      // 如果使用飞书云文档存储，添加背景图file_token
      if (storageType === 'feishu-cloud' && backgroundImageKey) {
        metadataFields['飞书图片Token'] = backgroundImageKey;
      }
      
      // 如果使用多单元格存储，添加拆分后的背景图列
      if (storageType === 'multi-cell' && Object.keys(backgroundImageChunks).length > 0) {
        Object.assign(metadataFields, backgroundImageChunks);
      }
      
      const metadataRecord = await createRecord(accessToken, LAYOUT_CONFIG_TABLE_ID, metadataFields);
      
      if (metadataRecord.code !== 0) {
        console.error('Failed to create metadata record:', metadataRecord.msg);
        return NextResponse.json({ code: 1, error: `保存失败: ${metadataRecord.msg}` });
      }
      
      console.log('Created metadata record for floor', floor);
      
      // 并行创建所有区位记录（使用并发限制防止触发限流）
      console.log(`Creating ${locations.length} location records in parallel...`);
      
      const createResults = await processBatch(
        locations,
        async (location) => {
          const fields: any = {
            '楼层ID': floor,
            '区位布局': JSON.stringify(location),
          };
          
          const result = await createRecord(accessToken, LAYOUT_CONFIG_TABLE_ID, fields);
          return result;
        },
        5 // 降低并发限制为5，避免触发限流
      );
      
      // 检查是否有失败的创建操作
      const failedResults = createResults.filter((r: any) => r.code !== 0);
      if (failedResults.length > 0) {
        console.error('Failed to create some location records:', failedResults);
        return NextResponse.json({ 
          code: 1, 
          error: `保存失败: ${failedResults[0].msg}`,
          details: failedResults
        });
      }
      
      console.log(`Successfully saved ${locations.length} location records for floor ${floor}`);
      console.log(`Background image storage: ${storageType}`);
      
      return NextResponse.json({ code: 0, message: '布局已保存' });
    }
    
    // 保存布局配置到飞书云盘（背景图和区位合并保存）
    if (body.action === 'saveLayoutToDrive') {
      console.log('Processing saveLayoutToDrive action');
      const { floor, locations, backgroundImage } = body;
      
      if (!floor || !locations) {
        return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
      }
      
      const accessToken = await getAccessToken();
      const updatedAt = Math.floor(new Date().getTime() / 1000);
      
      // 直接合并背景图和区位到同一个JSON文件中
      const layoutData = {
        version: 1,
        floor,
        locations,
        backgroundImage, // 直接保存 base64 或空字符串
        updatedAt,
      };
      
      // 上传布局配置文件到飞书云盘
      const configFileName = `布局配置_${floor}F_${updatedAt}.json`;
      const configContent = Buffer.from(JSON.stringify(layoutData, null, 2), 'utf-8');
      
      console.log('Uploading layout config to Feishu Drive...');
      console.log('Config size:', configContent.length, 'bytes');
      
      try {
        const uploadResult = await uploadFileToFeishuDrive(
          accessToken,
          configContent,
          configFileName
        );
        
        console.log('Layout config uploaded to Drive successfully');
        console.log('file_token:', uploadResult.file_token);
        
        return NextResponse.json({
          code: 0,
          message: '布局已保存到飞书云盘',
          data: {
            file_token: uploadResult.file_token,
            file_name: configFileName,
          }
        });
      } catch (error) {
        console.error('Failed to upload layout config to Drive:', error);
        return NextResponse.json({
          code: 1,
          error: `保存到云盘失败: ${error instanceof Error ? error.message : '未知错误'}`
        }, { status: 500 });
      }
    }
    
    // 从飞书云盘加载布局配置（背景图和区位已在同一个文件中）
    if (body.action === 'loadLayoutFromDrive') {
      console.log('Processing loadLayoutFromDrive action');
      const { fileToken } = body;
      
      if (!fileToken) {
        return NextResponse.json({ error: '缺少文件Token' }, { status: 400 });
      }
      
      const accessToken = await getAccessToken();
      
      try {
        // 下载布局配置文件（包含背景图和区位）
        console.log('Downloading layout config from Drive, token:', fileToken);
        const configBuffer = await downloadFileFromFeishuDrive(accessToken, fileToken);
        const configContent = configBuffer.toString('utf-8');
        const layoutData = JSON.parse(configContent);
        
        console.log('Layout config downloaded and parsed successfully');
        console.log('Locations count:', layoutData.locations?.length);
        console.log('Has background image:', !!layoutData.backgroundImage);
        
        return NextResponse.json({
          code: 0,
          data: layoutData
        });
      } catch (error) {
        console.error('Failed to load layout from Drive:', error);
        return NextResponse.json({
          code: 1,
          error: `从云盘加载失败: ${error instanceof Error ? error.message : '未知错误'}`
        }, { status: 500 });
      }
    }
    
    // 如果不是saveLayout，执行原有的数据匹配逻辑
    const { salesTableId, locationTableId, styleCodeField } = body;
    
    if (!salesTableId || !locationTableId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }
    
    const accessToken = await getAccessToken();
    
    // 并行获取销售表和区位表数据
    const [salesRecords, locationRecords] = await Promise.all([
      getRecords(accessToken, salesTableId),
      getRecords(accessToken, locationTableId),
    ]);
    
    // 以款号为键建立映射
    const styleCodeKey = styleCodeField || '款号';
    const salesMap = new Map<string, any>();
    const locationMap = new Map<string, any>();
    
    // 处理销售表数据
    salesRecords.forEach((record: any) => {
      const fields = record.fields || {};
      const styleCode = fields[styleCodeKey];
      if (styleCode) {
        const value = getFieldValue(styleCode);
        if (value) {
          salesMap.set(String(value), fields);
        }
      }
    });
    
    // 处理区位表数据
    locationRecords.forEach((record: any) => {
      const fields = record.fields || {};
      const styleCode = fields[styleCodeKey];
      if (styleCode) {
        const value = getFieldValue(styleCode);
        if (value) {
          locationMap.set(String(value), {
            ...fields,
            recordId: record.record_id,
          });
        }
      }
    });
    
    // 匹配数据
    const matchedData: any[] = [];
    const unmatchedSales: string[] = [];
    const unmatchedLocations: string[] = [];
    
    salesMap.forEach((salesFields, styleCode) => {
      const locationData = locationMap.get(styleCode);
      if (locationData) {
        matchedData.push({
          styleCode,
          sales: salesFields,
          location: locationData,
        });
      } else {
        unmatchedSales.push(styleCode);
      }
    });
    
    locationMap.forEach((locationFields, styleCode) => {
      if (!salesMap.has(styleCode)) {
        unmatchedLocations.push(styleCode);
      }
    });
    
    return NextResponse.json({
      code: 0,
      data: {
        matched: matchedData,
        unmatchedSales,
        unmatchedLocations,
        stats: {
          totalSales: salesMap.size,
          totalLocations: locationMap.size,
          matchedCount: matchedData.length,
        },
      },
    });
  } catch (error) {
    console.error('数据匹配错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
