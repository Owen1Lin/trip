# 網站上線與跨裝置同步

## 已準備與尚待啟用

網站是可直接部署的靜態網站。GitHub Actions 工作流程會在 `main` 更新時部署至 GitHub Pages，但必須先在 GitHub 儲存庫的 **Settings → Pages → Source** 選擇 **GitHub Actions**。工作流程成功前，不能視為已上線。

雲端同步使用你自己的 Supabase 專案。未設定時只保存到目前瀏覽器；本機收藏不參與雲端行程同步。同步採用明確的「上傳」和「下載」動作，沒有背景自動合併。下載前請匯出本機行程備份；同一帳號的行程快照可能被其他裝置更新，衝突時需要重新下載後再調整。

## Supabase 設定

1. 建立 Supabase 專案，在 SQL Editor 執行 `supabase/schema.sql`。這會啟用 Row Level Security，登入者只能存取自己的行程快照。不要停用 RLS。
2. 在 Authentication 啟用 Email 登入。於 URL Configuration 設定實際 Pages 網站網址為 Site URL，並將完整網址（含 `/trip/`）加入 Redirect URLs。
3. 將專案 URL 與 **publishable key**（舊版可使用 anon key）填入 `cloud-config.js`。這兩者是公開的前端設定；安全邊界是登入與 RLS。**不要填入 secret 或 service_role key，不要將私人金鑰提交到 GitHub。**
4. 推送設定後，等待 Pages workflow 成功。輸入 email 取得登入連結，在同一瀏覽器開啟。若要使用六位驗證碼，可將 Supabase Email Template 加入 `{{ .Token }}`，再在網站輸入驗證碼登入。
5. 在裝置 A 建立行程並「上傳行程」，以相同 email 在裝置 B 登入並「下載行程」。驗證活動內容與日期一致。這項真實跨裝置驗收需要你的 Supabase 專案，尚未執行。

## 安全與限制

- 網站不需要 Supabase 管理員金鑰；只需公開 publishable/anon key。
- email 登入可能受發信額度、寄信設定與 Supabase 新專案限制影響。正式使用請設定適當 SMTP 與登入速率限制。
- 使用公共裝置後請登出，並自行移除本機行程；登出不會自動刪除本機旅遊資料。
- JSON 檔可備份與搬移行程，請勿匯入不可信或包含他人個資的檔案。
- 圖片來源為 Unsplash，已隨網站儲存在 `assets/`；字體使用系統字體。瀏覽網站不需要外部圖片或字體服務。雲端模式仍需要連線至設定的 Supabase 專案。
- GitHub 推送與公開部署權限是不同能力。無法讀取 GitHub API 或工作流程結果時，只能確認程式已推送，不能聲稱網站已上線。
