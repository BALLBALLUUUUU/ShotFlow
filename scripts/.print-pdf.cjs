/* 用 Electron 打印管线把分镜表 HTML 打成 PDF：node scripts -> electron .print-pdf.cjs <html> <pdf> */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Electron 会把 --no-sandbox 与脚本路径混进 argv，这里只取最后两个文件参数
const [htmlPath, pdfPath] = process.argv.filter((arg) => !arg.startsWith('--')).slice(-2);

app.whenReady().then(async () => {
  if (!htmlPath || !pdfPath) throw new Error('用法：electron .print-pdf.cjs <html> <pdf>');
  const win = new BrowserWindow({
    show: false,
    width: 1500,
    height: 1000,
    webPreferences: { offscreen: true, javascript: false },
  });
  await win.loadFile(path.resolve(htmlPath));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const data = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    landscape: true,
    margins: { marginType: 'default' },
  });
  fs.writeFileSync(path.resolve(pdfPath), data);
  console.log(`PDF_OK ${pdfPath} ${data.length} bytes header=${data.subarray(0, 5).toString('latin1')}`);
  app.exit(0);
}).catch((error) => {
  console.error('PDF_FAIL', error && error.message ? error.message : error);
  app.exit(1);
});
