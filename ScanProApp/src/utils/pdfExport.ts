import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { ScanPage } from '../store/scanStore';

export async function exportToPdf(pages: ScanPage[]): Promise<void> {
  const validPages = pages.filter((p) => p.processedBase64);
  if (validPages.length === 0) throw new Error('沒有可輸出的頁面');

  const imagesHtml = validPages
    .map(
      (p, i) => `
      <div style="page-break-after:${i < validPages.length - 1 ? 'always' : 'auto'};
                  margin:0;padding:0;width:100%;height:100vh;
                  display:flex;align-items:center;justify-content:center;background:#fff;">
        <img src="${p.processedBase64}"
             style="max-width:100%;max-height:100%;object-fit:contain;display:block;">
      </div>`
    )
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>*{margin:0;padding:0;}body{background:#fff;}@page{margin:0;}</style>
    </head><body>${imagesHtml}</body></html>`;

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'ScanPro PDF',
    UTI: 'com.adobe.pdf',
  });
}

export async function exportImages(pages: ScanPage[]): Promise<number> {
  const validPages = pages.filter((p) => p.processedBase64);
  if (validPages.length === 0) throw new Error('沒有可輸出的頁面');

  // Request permission
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('需要相簿寫入權限才能儲存圖片，請在設定中開啟');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  let savedCount = 0;

  for (let i = 0; i < validPages.length; i++) {
    const base64 = validPages[i].processedBase64.split(',')[1];
    const filename = `${FileSystem.cacheDirectory}ScanPro_${dateStr}_p${i + 1}.jpg`;
    await FileSystem.writeAsStringAsync(filename, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await MediaLibrary.saveToLibraryAsync(filename);
    savedCount++;
  }

  return savedCount;
}
