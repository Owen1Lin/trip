# 旅途 Trip

繁體中文旅遊行程規劃工具，以 HTML、CSS 與原生 JavaScript 製作，無需安裝應用程式依賴或建置。

## 本機開發與部署

```sh
cd /workspace/trip
python3 -m http.server 3000 --bind 0.0.0.0
```

以瀏覽器開啟 `http://localhost:3000`。可部署至 GitHub Pages、Cloudflare Pages 或其他靜態網站服務；發布目錄為專案根目錄，無建置指令。

## 規劃功能

- 設定旅程名稱、目的地、出發日期與天數。
- 按天編排行程，記錄活動時間、地點與備註。
- 編輯與刪除活動，依活動時間排序。
- 在目前瀏覽器自動儲存規劃，支援 JSON 匯出備份與匯入。
- 探索目的地、收藏旅行靈感與閱讀旅遊文章。

資料存放在目前網站網域的瀏覽器 `localStorage`，未設定雲端模式時沒有帳號或雲端資料庫，不會跨裝置同步。清除網站資料、更換瀏覽器或開啟不同網域，可能無法取得原有規劃；請定期匯出備份。私人瀏覽或儲存空間不足時，依畫面提示保留備份。

雲端模式使用 Supabase 電子郵件驗證與資料庫，需要使用者提供專案設定並完成資料表與資料列存取規則；GitHub Pages 也需要在 repository 設定開啟部署。未接上真實專案前，雲端登入與跨裝置同步尚未驗證。`chatgpt.site` 的網域託管與資料儲存整合尚未設定，目前不聲稱可發布至該網域。

旅遊內容為參考示例；景點開放、交通、價格及入境規定請以官方資訊為準。照片來源為 Unsplash，以 repository 內的本地圖片提供；使用系統字體，核心網站瀏覽不需要外部圖片或字體服務。主要內容與互動位於 `app.js`，外觀位於 `styles.css`。

## 開發、審查與 GitHub 同步

三位 AI 協作角色與驗收規則見 [TEAM.md](TEAM.md)。完成開發後先審查、修正及驗收，再於已獲授權的工作階段提交並推送 GitHub；不代表常駐或即時逐字同步服務。

`main` 推送會觸發 GitHub Actions 瀏覽器驗收；測試通過後才部署至 Pages。工作流程已建立，遠端執行與實際上線仍需確認。啟用方法與跨裝置設定見 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 驗收

啟動上述靜態服務後，若環境已提供 Playwright 與 Chromium，可執行：

```sh
node tests/planner.test.cjs
```

可用 `TEST_URL` 指定網站網址、`CHROMIUM_PATH` 指定 Chromium 路徑。此測試涵蓋本機行程流程、資料備份與輸入安全、鍵盤及手機尺寸，不代表 Supabase 或正式部署已驗證。

部署與跨裝置設定請見 [DEPLOYMENT.md](DEPLOYMENT.md)。

`node tests/cloud.test.cjs` 使用模擬的 Supabase API 驗證前端登入與快照流程，不能替代真實專案的 email、RLS 與跨裝置驗收。
