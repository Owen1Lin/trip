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

## 公開連結擷取與模型

GitHub Pages 無法安全保管模型金鑰，也不能直接跨來源擷取這些網站。請在同一個 Supabase 專案部署 `supabase/functions/link-import/`：

```sh
supabase functions deploy link-import --use-api --project-ref lezobidxashxirzijveb
```

函式使用 Edge Function 內建 `SUPABASE_URL`、`SUPABASE_ANON_KEY`，將登入者 JWT 傳至 `is_private_trip_member()` RPC 驗證 Google OAuth 與會員；不使用 service role 繞過 RLS。若專案的新 JWT 簽署方式與平台 legacy JWT gate 不相容，可使用 `--no-verify-jwt` 部署；函式內仍須以 RPC 驗證，不能移除會員檢查。

可於 Supabase Edge Function secrets 設定以下伺服器變數，勿填入 `cloud-config.js`、聊天或公開 GitHub：

| 模型 | HTTPS OpenAI-compatible chat/completions 完整端點 | API 金鑰 | 實際模型名稱 |
| --- | --- | --- | --- |
| Qwen | `QWEN_MODEL_URL` | `QWEN_MODEL_KEY` | `QWEN_MODEL_NAME` |
| Llama | `LLAMA_MODEL_URL` | `LLAMA_MODEL_KEY` | `LLAMA_MODEL_NAME` |

端點由部署者指定，瀏覽器不能指定模型伺服器；TLS 驗證保留，模型請求不跟隨重新導向。可選 `LINK_IMPORT_ORIGINS` 設定逗號分隔的精確網站 origin；預設允許 GitHub Pages origin 與 localhost／127.0.0.1 的 3000 埠。若採用其他部署網域，需增列 origin。

擷取僅接受白名單的 Google Maps、Threads 與 Instagram HTTPS URL，逐次檢查重新導向，限制下載大小與逾時。僅整理公開頁面提供的標題與描述，不登入來源、不讀私人貼文。短網址只有重新導向至允許的同平台網址才會繼續。來源可能因反爬蟲、登入頁或缺少 metadata 而無法取得資料；此時使用者須自行查閱來源並填寫空白草稿。

Maps 短網址解析成功且地點頁只回傳通用 metadata 時，可使用最後的 `/maps/place/<名稱>/` 路徑文字預填名稱，保留公開來源網址並標示「待確認」。只採網址明示的名稱，不以座標推測地址，也不產生電話、評分或營業時間。沒有名稱的 Maps 通用頁面與社群登入頁仍拒收。

模型只接收公開 metadata；其輸出必須符合原始來源文字才能採用。未設定模型或模型失敗時保留公開資料草稿並提示，不能宣稱模型成功。日期、時段與起訖時間不由模型產生，使用者須自行填寫及確認。名稱若無法從來源核實也留空。

前端與函式部署是兩個步驟。GitHub main 推送不會部署 Edge Function 或設定模型金鑰。部署後需以授權會員驗證三個真實公開來源、模型連線、非會員拒絕與無法讀取時的手動流程；fixtures 與模擬瀏覽器測試不能取代這些檢查。

匯入提示「前端版本不一致」時，表示載入的登入腳本沒有匯入方法，請先確認 Pages 部署成功，再重新整理；不是來源已讀取失敗。HTML 的 CSS／JavaScript URL 帶有共同版本參數，修改前端資源時應同步更新此版本，避免瀏覽器混用快取。匯入 API 的 404 表示尚未部署函式，422 表示來源限制或沒有可讀取公開資料；401／403 會鎖定私人頁面，不繼續提供登入中的手動草稿。

雲端環境的 Node.js 唯讀連線檢查需使用既有 HTTPS 代理：`NODE_USE_ENV_PROXY=1 node tests/supabase.test.cjs`。不要關閉 TLS 驗證。此設定只影響雲端測試程序，不會替瀏覽器登入或部署函式。

## GitHub 驗收與部署

`main` 更新會執行瀏覽器操作與登入／同步模擬驗收；通過後發布登入保護的頁面。獨立的 `cloud-readiness` job 檢查真實 Google Provider 與匿名資料庫防護，未設定完成會顯示失敗。這項失敗不會阻擋先發布登入保護畫面，以免舊版公開操作介面繼續在線。

實際 Google 授權、兩會員存取及跨帳號共享，需要上面的帳號設定與真實登入驗證；模擬測試及匿名檢查不能取代這項驗證。匿名權限拒絕也不足以單獨證明全部會員 RLS 規則。
