# Modbux MCP 使用說明

Modbux 內嵌 MCP server，讓本機的 AI agent 操作 Client 與 Server。設計細節見 `docs/design/json-config-and-mcp.md`。

## 啟用

1. 在首頁右上角點擊 **Settings** 齒輪按鈕，開啟 MCP 設定頁。
2. 開啟「Enable MCP」。當 **Status** 顯示 `Running`，即表示正在監聽。
3. 「Allow writes to devices」為另一個獨立開關（預設關閉），關閉時所有會寫入裝置的工具一律拒絕執行。
4. MCP 僅在主視窗開啟期間運作。

## URL 與 token

- URL：`http://127.0.0.1:15502/mcp`（僅綁定 `127.0.0.1`，連接埠固定為 `15502`）。
- 每個請求皆須帶入 `Authorization: Bearer <token>`。Token 顯示於設定頁，點擊 **Regenerate token** 會立即產生新 Token，舊的隨即失效。
- Token 儲存於 `<userData>/mcp.json`（權限 `0600`）。`<userData>` 路徑依平台而異：
  - Linux：`~/.config/Modbux`（從原始碼執行時為 `~/.config/modbux`）
  - macOS：`~/Library/Application Support/Modbux`
  - Windows：`%APPDATA%\Modbux`

## Claude Code（HTTP）

設定頁的「Claude Code」欄位已帶入目前 Token，可直接複製完整指令：

```sh
claude mcp add --transport http modbux http://127.0.0.1:15502/mcp --header "Authorization: Bearer <token>"
```

## stdio shim

供僅支援 stdio 的 MCP client 使用。Shim 本身不宣告任何工具，僅將訊息轉送至上方的 HTTP 端點，因此端點提供什麼，Client 就會看到什麼。

- 建置輸出：`out/main/mcpStdio.js`（由 `electron-vite build` 產生）。
- 從原始碼執行：`node out/main/mcpStdio.js`。
- 打包後的應用程式：`ELECTRON_RUN_AS_NODE=1 <Modbux 執行檔> <resources>/app.asar/out/main/mcpStdio.js`。
- 設定頁會顯示本機實際路徑與完整的 `claude mcp add modbux ... -- ...` 指令。
- Token 取得順序：優先讀取環境變數 `MODBUX_MCP_TOKEN`，若未設定則讀取 `<userData>/mcp.json`。若以 `--user-data-dir` 啟動 Modbux，請透過 `MODBUX_USER_DATA` 指定該目錄。
- 端點網址預設為 `http://127.0.0.1:15502/mcp`，可透過 `MODBUX_MCP_URL` 覆寫。
- Modbux 未開啟或 MCP 未啟用時，shim 會對每個請求回傳 JSON-RPC 錯誤 `-32000`，訊息以 `Modbux endpoint:` 開頭。

## Prompts

前三個 Prompt 皆只有一個必填參數 `pointTable`：點位表文字（直接從規格書複製貼上的列、CSV 或 Markdown 表格皆可）。

- `point_table_to_client`：先讀取 `client_get_config`，必要時呼叫 `client_set_connection` 設定連線；接著執行 `client_apply_point_table` 進行 `dryRun: true` 試跑驗證並修正被拒絕的點位，再正式套用，最後執行 `client_connect` 與 `client_read_points`。依數值合理性檢查字組順序（word order）與縮放比例；若數值不合理，則依 `modbux://encoding` 嘗試其他位元組順序。
- `point_table_to_simulator`：透過 `server_list` / `server_create` 建立 Server，呼叫 `server_apply_point_table` 先進行 `dryRun` 再正式套用，為每個點位設定固定值或產生器範圍，最後以 `server_get_values` 確認結果。
- `closed_loop_test`：依點位表建立 Server，將 Client 指向 `127.0.0.1` 與該 Server 的連接埠並套用同一份點位表，讀取後逐點與 `server_get_values` 比對並回報不一致的點位。通過僅代表兩端設定一致，不代表點位表與真實裝置相符。
- `simulate_device_fault`：必填參數 `situation`，以文字說明欲模擬的設備故障情境。Prompt 會引導以 `server_set_faults` 規則組合離線、忙碌、拒絕寫入與回應延遲，以 `server_drop_connections` 模擬斷線，並以 `server_set_values` 設定數值凍結、無效值哨兵（`0xFFFF`、`0x8000`、float 的 `NaN`）、超量程與累計值回捲，最後透過 `server_get_requests` 與 `server_get_faults` 驗證故障確實觸發。

## 輪詢工具（Poll）

- `client_start_polling`：等同於點擊畫面上的 **Poll** 按鈕，Client 會依 poll rate 持續讀取，視窗表格也會隨之更新。未連線時會回傳錯誤並提示呼叫 `client_connect`；重連期間同樣拒絕。若已在輪詢中則直接回傳成功。單次讀取、掃描或寫入進行中時會被拒絕。由於僅執行讀取，不受「Allow writes to devices」開關限制。
- `client_stop_polling`：停止輪詢，並等待最後一筆進行中的讀取完成後才回傳，因此緊接著呼叫 `client_read_points` 不會發生請求衝突。未處於輪詢狀態時也會回傳成功。

輪詢期間呼叫 `client_read_points` 會被拒絕（`Cannot read during a poll`），請先執行 `client_stop_polling`。

## 掃描工具

兩個掃描工具皆標記為 `readOnlyHint`，掃描期間 Modbux 視窗會即時顯示進度與結果。輪詢、讀取、寫入或另一個掃描進行中時皆會拒絕執行。若執行超過 120 秒會自動停止並回傳目前已找到的結果（`stopped: true`）。

- `client_scan_registers`：參數包含 `startAddress`（PDU 位址）、`count`（`1`–`10000`）、`registerType`（省略時沿用 Client 目前的類型）、`chunkSize`（預設 `100`）、`timeoutMs`（`100`–`5000`，預設 `500`）。回傳非零的 word（或為 `1` / `TRUE` 的 bit）。
- `client_scan_unit_ids`：參數包含 `startUnitId`、`endUnitId`、`registerTypes`（預設 `holding_registers`）、`address`（預設 `0`）、`length`（預設 `1`）、`timeoutMs`。掃描的 Unit ID 數量乘以暫存器類型數量最多為 `1000`。回傳所有有回應的 Unit ID（包含回傳 Modbus 例外碼者）。

## Client 除錯工具

- `client_get_transactions`：`readOnlyHint`。回傳 Client 最近 1,000 筆通訊紀錄（與視窗中的通訊紀錄表格相同），由舊到新排序。參數包含：`limit`（預設 `50`，取最新的 N 筆）、`sinceTimestamp`（epoch 毫秒，含該時刻）、`failedOnly`（僅保留逾時、有錯誤訊息或例外碼的紀錄）。每筆紀錄包含 Unit ID、位址、Function Code、請求與回應的十六進位字串、`durationMs`（從送出請求到記錄完成的毫秒數；若逾時則為實際等待時間）、`timeout`、`errorMessage`，以及設備回傳 Modbus 例外碼時的 `exceptionCode`。
- `client_read_points`（當所有群組皆失敗時）與 `client_write`（當寫入失敗或設備回傳錯誤時）的失敗結果會額外附上 `failedTransactions`：列出這次呼叫期間產生的失敗通訊紀錄，格式同上。`client_write` 的寫入後回讀也包含在這次呼叫中。執行成功、僅部分群組失敗，或因未連線／忙碌而遭拒絕的結果則不包含此欄位。
- 掃描工具不附帶 `failedTransactions`：掃描過程中每個無回應的 Unit ID 都會產生一筆逾時紀錄，大多僅是雜訊；若需檢視明細可另行呼叫 `client_get_transactions`。

所記錄的 frame 在 TCP 與 RTU 模式下皆包含 Unit ID、Function Code、資料與 CRC，不含 MBAP header。

## Server 請求紀錄

- `server_get_requests`：`readOnlyHint`。回傳主站對指定 Server 送出的請求紀錄，由舊到新排序；不論請求涵蓋幾個位址，每筆請求固定記錄一筆。參數：`uuid`（省略時使用主伺服器）、`limit`（預設 `50`）、`sinceTimestamp`（毫秒，含該時刻）、`failedOnly`（僅回傳例外碼或無回應的請求）。
- 每筆紀錄包含 `timestamp`、`uuid`、`unitId`、`direction`（`read` 或 `write`）、`registerType`、`address`（起始 PDU 位址）、`count`、`outcome`（`ok`、`exception` 搭配 `exceptionCode`，或 `no_response`）；寫入請求另有 `values`。若該請求由故障規則決定，則另含 `fault`（`rule` 為規則在清單中的 0-based 索引，`delay` 規則另有 `delayMs`）。
- 每台 Server 會在主行程記憶體中保留最新紀錄（上限記載於工具說明中），刪除 Server 時會清除且不會存檔。
- RTU 模式下的 Unit ID `0` 為廣播位址：讀取請求不回應並記為 `no_response`；寫入請求會寫入該伺服器上所有已建立點位的（有資料的）Unit ID、不回應封包並記為 `ok`。若廣播寫入超過位址 `65535`，則所有位址皆不寫入並記為 `no_response`。
- 紀錄僅涵蓋實際送達 Server 暫存器 Vector 的請求。由 `modbus-serial` 底層自行攔截處理的請求不會被記錄，也不會套用故障規則（因 Vector 未被呼叫）。依 `servertcp_handler.js`、`servertcp.js` 與 `serverserial.js` 的實作行為：
  - FC1、FC2、FC3、FC4、FC15 數量為 `0`：回傳例外碼 `2`，不記錄。FC16 數量為 `0` 會呼叫 Vector，因此記為 `exception` `2`。
  - FC1 或 FC2 數量大於 `2040`，或 FC3、FC4 數量大於 `127`：因回應的位元組長度無法容納於單一位元組欄位中，底層直接回傳例外碼 `4`，不記錄；`2040` 與 `127` 則可正常讀取並記錄。
  - Vector 未實作對應存取器的 Function Code（例如 `7` 與 `43`）：直接回傳例外碼 `1`，不記錄。
  - FC1 至 FC6 封包長度不為 `8` 位元組，或 FC15、FC16 封包長度與請求數量不符：不回應也不記錄。
  - RTU CRC 錯誤不在此列：函式庫收到 frame 後會重算 CRC 並覆寫收到的數值，因此 CRC 錯誤的 frame 不會被擋下，仍會送達 Server、被記錄並套用故障規則。
- 傳入不存在的 `uuid` 時會回傳空清單。此工具不透過 renderer 執行，因此即使 Server 畫面已拆至獨立視窗也能正常使用。

## 故障注入

讓 Modbux 的 Server 模擬故障設備回應主站，用來測試上位系統遇到例外碼、無回應、延遲或斷線時的行為。這四個工具的操作對象皆為 Modbux 本身的模擬器而非真實裝置，因此不受「Allow writes to devices」開關限制。四者皆不透過 renderer，即使將 Server 畫面拆至獨立視窗仍可使用。省略 `uuid` 時預設操作主伺服器；不存在於主行程的 Server（從未建立或已刪除）則會回傳錯誤。未處於監聽狀態的 Server（例如連接埠綁定失敗或 RTU 模式下停用時）仍視為存在。

- `server_set_faults`：參數為 `uuid`、`rules`。整份取代既有的規則清單並回傳生效中的清單；傳入空清單等同於清除所有規則。
- `server_get_faults`：`readOnlyHint`。回傳目前的規則清單，每條規則皆附帶 `matched`（成為第一條符合條件的請求次數）、`triggered`（實際觸發決策的請求次數），以及 `forSeconds` 規則的到期時間 `expiresAt`（epoch 毫秒）。
- `server_clear_faults`：清除該伺服器的所有故障規則。
- `server_drop_connections`：中斷主站連向該 Server 的所有使用中 TCP 連線，但保留監聽狀態讓主站可以重連，並回傳已關閉的連線數。若伺服器處於 RTU 模式則回傳錯誤。

一條規則：

```ts
{
  unitId?: number
  registerType?: 'coils' | 'discrete_inputs' | 'input_registers' | 'holding_registers'
  addressRange?: [start, end] // PDU 位址，含兩端
  direction?: 'read' | 'write'
  action:
    | { kind: 'exception'; code: number }
    | { kind: 'no_response' }
    | { kind: 'delay'; ms: number }
  everyNth?: number
  forSeconds?: number
}
```

- 省略的條件欄位代表不限條件。只要請求涵蓋 `addressRange` 內的任一位址即視為符合。
- 每個請求會依清單順序由上而下比對，第一條所有條件皆符合的規則即決定該請求的處理方式，因此清單順序即代表優先順序。
- 設有 `everyNth: N` 時，該規則只會觸發於它符合的第 `N`、`2N`… 個請求；其餘未觸發的請求會照常回應，且不會再往下交由後續規則處理。
- `exception` 會回傳指定的例外碼，`no_response` 則完全不回應；兩者若用於寫入請求皆不會將數值寫入 Server。`delay` 會在請求到達當下照常執行讀寫，並在 `ms` 毫秒後才送出當時讀取到的回應內容；等待送出期間即使數值變更、點位被刪除或載入設定檔，也不會影響該筆已排定的回應。`delay` 的上限與每份清單的規則數量上限記載於工具說明中。
- 在 TCP 模式下，故障規則會在 Server 本身的檢查之前生效，因此對尚未託管的 Unit ID 或超出範圍的位址同樣有效。
- 在 RTU 模式下，未託管的 Unit ID 一律靜默不回應，不會進入規則比對也不計入 `matched`：因為該 ID 屬於匯流排上的其他真實設備，模擬器若送出任何 frame 都會造成碰撞衝突。
- RTU 廣播請求（Unit ID `0`）無論是否套用規則皆不回傳封包；若命中 `exception` 或 `no_response` 規則，則會阻止該筆廣播寫入任何位址。
- 已排程的延遲回應：清除或取代規則時不會取消，仍會依原定時間送出；僅停止或刪除該 Server（包含切換 TCP／RTU 或變更連接埠）時才會取消並不再送出。
- 設定 `forSeconds` 的規則會在經過指定秒數後自動從清單移除。
- 規則僅存於主行程記憶體中：重啟應用程式、刪除 Server，或對該 Server 載入設定檔／專案檔時皆會清空。
- 規則亦可直接於 Server 畫面編輯（主視窗與獨立 Server 視窗皆可）：點擊 **Fault rules** 按鈕可開啟對話框，每條規則各佔一列，支援上移、下移、編輯與刪除，底部提供新增、重新整理（Refresh）與全部清除（Clear all）；伺服器有設定規則時按鈕會顯示規則數量。
- 透過畫面進行的每次修改皆為整份清單取代，行為與 `server_set_faults` 相同，因此各規則的 `matched` 與 `triggered` 計數會歸零，且所有 `forSeconds` 規則會重新開始計時。對話框顯示的計數僅於開啟、規則變更或點擊重新整理時更新。
- 透過畫面送出變更時，僅在主行程內的清單仍與對話框讀取當時相符的情況下才會生效。若在此期間清單已被 `server_set_faults`、另一個視窗或 `forSeconds` 到期而更動，該次寫入便不會套用，對話框會保留編輯中的表單並改為顯示目前的最新清單。`server_set_faults` 本身則不做這項版本檢查。
- 當 Server 遭刪除後，主行程不會再為該 `uuid` 套用或保留任何規則，畫面操作與 `server_set_faults` 皆然。若對話框正處於開啟狀態，會自動關閉編輯表單、捨棄草稿、停用所有寫入按鈕並提示該 Server 已被刪除。透過 Undo 復原的 Server 不會還原原有規則，將從空白的規則清單重新開始。
