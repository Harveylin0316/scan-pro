# ScanPro

高清文件掃描 Web App — 把照片變成專業掃描 PDF。

## 功能

- 拍照或上傳圖片（支援 JPG、PNG、iPhone HEIC）
- 自動偵測文件邊框 + 透視校正
- 手動四角裁切微調
- 掃描模式濾鏡（掃描 / 黑白 / 灰階 / 原色）
- 亮度、對比度調整
- 批次多頁管理（拖拽排序）
- 高品質 PDF 輸出
- 行動端相機支援 + Web Share API

## 使用方式

直接用瀏覽器開啟 `scan-app.html` 即可使用，無需安裝。

## 技術棧

- 純前端，單一 HTML 檔案
- Canvas API 影像處理（邊緣偵測、透視變換、濾鏡）
- pdf-lib 生成 PDF
- 原生 HEIC 支援（macOS）+ heic2any fallback

## License

MIT
