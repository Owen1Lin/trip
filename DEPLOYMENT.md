# 歐文＆溫妮私人空間設定

網站： https://owen1lin.github.io/trip/

網站使用 Google 登入，只有資料庫會員名單中的兩個 Gmail 帳號能讀寫同一份福岡＆九州五日手帳。前端登入畫面與程式碼由 GitHub Pages 公開提供；私人行程與會員名單放在 Supabase，受資料庫 RLS 保護。

## 1. 套用新的私人空間 SQL

在 Supabase 專案的 SQL Editor 執行已填入兩個帳號的私人設定檔。這個副本在 onboarding 工作區的 `/workspace/trip-setup/owen-winnie-private-space.sql`，不會提交至公開 GitHub。

若從 GitHub 的 `supabase/private-space.sql` 建立副本，先將兩個 `replace-…@gmail.com` placeholder 全部替換為邀請帳號；未替換的模板會明確拒絕執行。不要更動 scope。

新腳本建立：

- `private_trip_members`：只有管理員能修改，登入者只能讀自己的會員資料。
- `shared_trip_snapshots`：兩個會員讀寫同一份手帳；其他登入者及匿名角色皆不能存取。
- `is_private_trip_member()`：核實 Google 身份、已驗證信箱及名單。
- 寫入觸發器：從真實登入者設定更新者 UUID 與時間，支援版本衝突偵測。

舊 `trip_snapshots` 及既有行程不會刪除，會加上私人會員限制。新版不會自動讀取或改寫舊版瀏覽器資料；使用者可登入後匯入合適的舊備份。

## 2. 設定 Google 登入

先在 Google Cloud Console 建立或選擇你自己的專案： https://console.cloud.google.com/

1. 打開 **Google Auth Platform**，完成 Branding、Audience 與 Data Access 設定。
2. 兩個帳號是一般 Gmail，Audience 選 **External**。開發期間保留 **Testing**，把兩個 Gmail 加入 **Test users**。
3. 建立 **OAuth Client → Web application**。
4. **Authorized JavaScript origins** 填 `https://owen1lin.github.io`。
5. **Authorized redirect URIs** 填 Supabase Google Provider 面板顯示的 Callback URL，本專案為 `https://lezobidxashxirzijveb.supabase.co/auth/v1/callback`。
6. 取得 Client ID 及 Client Secret。

接著回到 Supabase：

1. 打開 **Authentication → Sign In / Providers → Google**（部分介面標為 Providers）。
2. 啟用 Google，填入 Google Client ID、Client Secret，儲存。
3. **Authentication → URL Configuration** 的 Site URL 填 `https://owen1lin.github.io/trip/`。
4. Redirect URLs 加入完全相同的 `https://owen1lin.github.io/trip/`，避免重新導向到原本 localhost。

此空間只啟用 Google OAuth；其他 OAuth Providers 保持關閉。既有 Email 帳號可以自動連結同信箱的 Google 身份，但網站及權限規則不接受 Email OTP 作為登入方式。

Client Secret 只填在 Supabase 後台，不要放進程式碼、GitHub 或聊天。`cloud-config.js` 繼續使用既有的 Supabase Project URL 和公開 Publishable key。

網站不提供 Email OTP 登入。資料庫會員驗證同時核實 Google 身份；任何 Gmail 並非都能登入。

## 3. 驗證共享行程

1. 歐文以自己的 Gmail 按「使用 Google 帳號登入」。登入身份是藍色。
2. 在任一天的上午、中午或晚上新增活動，填開始／結束時間、地點、購物清單與自訂欄位，按「儲存到雲端」。
3. 溫妮在另一個瀏覽器或裝置登入，她的身份是粉色，登入時載入同一份行程。
4. 修改後儲存，歐文按「載入共同手帳」看到更新。活動會顯示建立者及更新者姓名。
5. 嘗試其他 Google 帳號，必須停留在登入畫面且不能讀寫共享資料。

同步是明確的儲存／載入操作，不是即時共同編輯。兩人同時修改會檢查版本；落後版本不能覆蓋另一位更新，請先匯出備份、載入最新行程，再合併修改。

## 私人資料及登入暫存

私人行程只在核實會員後載入。頁面以每個使用者的 `sessionStorage` 暫存當次編輯，登出清除內容、表單及暫存；未儲存的修改請先保存到雲端或匯出。舊版本 localStorage 不會被讀取，也不會被移除。

姓名色彩標記方便協作，不是不可竄改的活動稽核。資料庫記錄的最後寫入者 UUID 由後端觸發器產生。

## GitHub 驗收與部署

`main` 更新會執行瀏覽器操作與登入／同步模擬驗收；通過後發布登入保護的頁面。獨立的 `cloud-readiness` job 檢查真實 Google Provider 與匿名資料庫防護，未設定完成會顯示失敗。這項失敗不會阻擋先發布登入保護畫面，以免舊版公開操作介面繼續在線。

實際 Google 授權、兩會員存取及跨帳號共享，需要上面的帳號設定與真實登入驗證；模擬測試及匿名檢查不能取代這項驗證。匿名權限拒絕也不足以單獨證明全部會員 RLS 規則。
