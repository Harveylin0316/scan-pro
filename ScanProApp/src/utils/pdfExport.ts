import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { ScanPage } from '../store/scanStore';

export async function exportToPdf(pages: ScanPage[]): Promise<void> {
  const validPages = pages.filter((p) => p.processedBase64);
  if (validPages.length === 0) throw new Error('No pages to export');

  const imagesHtml = validPages
    .map(
      (p) => `
      <div style="page-break-after:always;margin:0;padding:0;width:100%;height:100vh;
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

export async function exportImages(pages: ScanPage[]): Promise<void> {
  const validPages = pages.filter((p) => p.processedBase64);
  if (validPages.length === 0) throw new Error('No pages to export');

  const dateStr = new Date().toISOString().slice(0, 10);

  if (validPages.length === 1) {
    // Single page: share directly
    const base64 = validPages[0].processedBase64.split(',')[1];
    const filename = `${FileSystem.cacheDirectory}ScanPro_${dateStr}.jpg`;
    await FileSystem.writeAsStringAsync(filename, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(filename, {
      mimeType: 'image/jpeg',
      dialogTitle: 'ScanPro 圖片',
      UTI: 'public.jpeg',
    });
  } else {
    // Multiple pages: share each one (iOS supports multi-file share)
    const fileUris: string[] = [];
    for (let i = 0; i < validPages.length; i++) {
      const base64 = validPages[i].processedBase64.split(',')[1];
      const filename = `${FileSystem.cacheDirectory}ScanPro_${dateStr}_p${i + 1}.jpg`;
      await FileSystem.writeAsStringAsync(filename, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      fileUris.push(filename);
    }
    // Share the first file; iOS will show all if sharing folder is not available
    // Best UX: share files one by one or use a zip (we keep it simple here)
    for (const uri of fileUris) {
      await Sharing.shareAsync(uri, {
        mimeType: 'image/jpeg',
        dialogTitle: 'ScanPro 圖片',
        UTI: 'public.jpeg',
      });
    }
  }
}
