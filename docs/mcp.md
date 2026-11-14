# Modbux MCP 使用說明

Modbux 內嵌 MCP server，讓本機的 AI agent 操作 Client 與 Server。設計見 `docs/design/json-config-and-mcp.md`。

## 啟用

1. Home 畫面按設定（`home-settings-btn`），開啟 MCP 設定頁。
2. 打開「Enable MCP」。狀態顯示 Running 即表示在監聽。
3. 預設關閉。「Allow writes to devices」是另一個開關，關閉時所有會寫入裝置的 tool 一律拒絕。
4. MCP 只在 main window 開著時運作。

## URL 與 token

- URL：`http://127.0.0.1:15502/mcp`（只綁 127.0.0.1，port 固定）。
- 每個請求都要帶 `Authorization: Bearer <token>`。token 顯示在設定頁，按「Regenerate token」會換一個，舊的立即失效。
- token 存在 `<userData>/mcp.json`（權限 0600）。`<userData>` 依平台：
  - Linux：`~/.config/Modbux`（從原始碼執行時為 `~/.config/modbux`）
  - macOS：`~/Library/Application Support/Modbux`
  - Windows：`%APPDATA%\Modbux`

## Claude Code（HTTP）

設定頁「Claude Code」欄位有完整指令，token 已帶入：

```sh
claude mcp add --transport http modbux http://127.0.0.1:15502/mcp --header "Authorization: Bearer <token>"
```

## stdio shim

給只支援 stdio 的 MCP client。shim 不宣告任何 tool，只把訊息轉送到上面的 HTTP 端點，所以端點有什麼，client 就看到什麼。

- 建置輸出：`out/main/mcpStdio.js`（`electron-vite build` 產生）。
- 從原始碼執行：`node out/main/mcpStdio.js`。
- 打包後的 app：`ELECTRON_RUN_AS_NODE=1 <Modbux 執行檔> <resources>/app.asar/out/main/mcpStdio.js`。
- 設定頁會顯示本機實際的路徑與完整的 `claude mcp add modbux ... -- ...` 指令。
- token 取得順序：環境變數 `MODBUX_MCP_TOKEN`，否則讀 `<userData>/mcp.json`。以 `--user-data-dir` 啟動 Modbux 時，用 `MODBUX_USER_DATA` 指向該目錄。
- 端點網址預設為 `http://127.0.0.1:15502/mcp`，可用 `MODBUX_MCP_URL` 覆寫。
- Modbux 沒開或 MCP 沒啟用時，shim 對每個請求回 JSON-RPC 錯誤 `-32000`，訊息以 `Modbux endpoint:` 開頭。

## Prompts

前三個 prompt 只有一個必填參數 `pointTable`：點表的文字（從規格書貼上的列、CSV 或 Markdown 表格皆可）。

- `point_table_to_client`：讀 `client_get_config`，必要時 `client_set_connection`，先 `client_apply_point_table` 做 `dryRun: true` 並修正被拒絕的點，再正式套用，接著 `client_connect`、`client_read_points`。用數值合理性檢查 word order 與比例；數值不合理時，依 `modbux://encoding` 試其他 byte order。
- `point_table_to_simulator`：`server_list` / `server_create` 建立 Server，`server_apply_point_table` 先 `dryRun` 再套用，每個點給固定值或產生器範圍，最後用 `server_get_values` 確認。
- `closed_loop_test`：用點表建立 Server，把 Client 指向 `127.0.0.1` 與該 Server 的 port，套用同一份點表，讀取後逐點與 `server_get_values` 比對並回報不一致的點。通過只代表兩端一致，不代表點表與真實裝置相符。
- `simulate_device_fault`：必填參數 `situation`，用文字描述要模擬的設備故障。說明如何用 `server_set_faults` 的規則組出離線、忙碌、拒絕寫入、回應慢，用 `server_drop_connections` 模擬斷線，用 `server_set_values` 組出值凍結、無效值哨兵（`0xFFFF`、`0x8000`、float 的 NaN）、超量程與累計值回捲，再用 `server_get_requests` 與 `server_get_faults` 確認故障真的被觸發。

## Poll tools

- `client_start_polling`：如同按 POLL，Client 依 poll rate 持續讀取，視窗格子隨之更新。未連線時回錯誤，指向 `client_connect`；重連中也拒絕。已在 poll 時回成功。Poll、掃描或寫入進行中被拒絕。不受 "Allow writes to devices" 管，因為它只讀裝置。
- `client_stop_polling`：停止 poll，並等 poll 最後一次 read 結束才回傳，所以接著呼叫 `client_read_points` 不會與它同時在線上。沒有在 poll 時回成功。

poll 期間 `client_read_points` 會被拒絕（`Cannot read during a poll`）；先 `client_stop_polling`。

## 掃描 tools

兩個都是 `readOnlyHint`，掃描期間 Modbux 視窗會顯示進度與結果。Poll、讀取、寫入或另一個掃描進行中時拒絕。超過 120 秒會停止並回報已找到的部分（`stopped: true`）。

- `client_scan_registers`：`startAddress`（PDU 位址）、`count`（1 到 10000）、`registerType`（省略時用 Client 目前的類型）、`chunkSize`（預設 100）、`timeoutMs`（100 到 5000，預設 500）。回傳非零的 word（或為 1 的 bit）。
- `client_scan_unit_ids`：`startUnitId`、`endUnitId`、`registerTypes`（預設 `holding_registers`）、`address`（預設 0）、`length`（預設 1）、`timeoutMs`。unit id 數量乘以 register type 數量最多 1000。回傳有回應的 unit，回 Modbus exception 也算有回應。

## Client 除錯 tools

- `client_get_transactions`：`readOnlyHint`。回傳 Client 最近 1000 筆 transaction（與視窗的 Transactions 格子相同），由舊到新。參數：`limit`（預設 50，取最新的幾筆）、`sinceTimestamp`（epoch 毫秒，含）、`failedOnly`（只留 timeout、有錯誤訊息或 exception 的）。每筆有 unit id、位址、function code、request 與 response 的 hex、`durationMs`（送出到記錄的毫秒數，timeout 則是等待的時間）、`timeout`、`errorMessage`，以及設備回 Modbus exception 時的 `exceptionCode`。
- `client_read_points`（每個 group 都失敗時）與 `client_write`（設備回錯誤時）的失敗結果多一個 `failedTransactions`：這次呼叫期間記下的失敗 transaction，格式同上。`client_write` 的寫入後回讀也算這次呼叫。成功、只有部分 group 失敗、被拒絕（未連線、忙碌）的結果沒有這個欄位。
- 掃描 tools 不附 `failedTransactions`：每個無回應的 unit 都是一筆 timeout，只是雜訊。要看就呼叫 `client_get_transactions`。

紀錄的 frame 在 TCP 與 RTU 下都是 unit id、function code、資料、CRC，不含 MBAP header。

## Server 請求紀錄

- `server_get_requests`：`readOnlyHint`。回傳主站對某台 Server 送出的請求，由舊到新，一個請求一筆，不論位址數量。參數：`uuid`（省略時用主 Server）、`limit`（預設 50）、`sinceTimestamp`（毫秒，含該時刻）、`failedOnly`（只回 exception 與沒回應的請求）。
- 每筆有 `timestamp`、`uuid`、`unitId`、`direction`（`read` 或 `write`）、`registerType`、`address`（第一個 PDU 位址）、`count`、`outcome`（`ok`、`exception` 加 `exceptionCode`、`no_response`），寫入另有 `values`。由故障規則決定的請求另有 `fault`：`rule` 是規則在清單裡的位置（從 0 起算），`delay` 規則另有 `delayMs`。
- 每台 Server 在 main 的記憶體保留最近的紀錄，上限寫在 tool 說明裡。刪除 Server 時清掉，不存檔。
- RTU 的 unit 0 是 broadcast：讀取不回應，記為 `no_response`；寫入寫進每個有資料的 unit、不回應，記為 `ok`。超過位址 65535 的 broadcast 寫入一個位址都不寫，記為 `no_response`。
- 紀錄只有到達 Server 暫存器的請求。modbus-serial 自己處理掉的請求不記，故障規則也不套用，因為 vector 沒有被呼叫。依 `servertcp_handler.js`、`servertcp.js` 與 `serverserial.js`：
  - FC1、FC2、FC3、FC4、FC15 的數量為 0：回 exception 2，沒有紀錄。FC16 數量為 0 會呼叫 vector，記為 exception 2。
  - 不支援的 function code：回 exception 1，沒有紀錄。
  - FC1 到 FC6 的 frame 長度不是 8 位元組，FC15 與 FC16 的長度與數量不符：不回應，沒有紀錄。
  - RTU 的 CRC 錯誤：不回應，沒有紀錄。
- 不存在的 `uuid` 回空清單。這個 tool 不經過 renderer，所以 Server 畫面拆到另一個視窗時也能用。

## 故障注入

讓 Modbux 的 Server 像故障的設備一樣回應主站，用來測上位系統遇到 exception、不回應、延遲、斷線時的行為。四個 tool 的對象都是 Modbux 自己的模擬器，不是裝置，所以都不受 "Allow writes to devices" 管。四個都不經過 renderer，Server 畫面拆到另一個視窗時也能用。`uuid` 省略時用主 Server；main 沒有的 Server（從沒建立，或已刪除）回錯誤。沒在監聽的 Server，例如 bind 失敗或 RTU 模式下停掉的，仍然算有。

- `server_set_faults`：參數 `uuid`、`rules`。整份取代，回傳生效的清單。空清單等於清除。
- `server_get_faults`：`readOnlyHint`。回目前的清單，每條規則加上 `matched`（它是第一條符合的請求數）、`triggered`（它實際決定的請求數）與 `forSeconds` 規則的 `expiresAt`（epoch 毫秒）。
- `server_clear_faults`：清空。
- `server_drop_connections`：關掉主站對該 Server 開著的 TCP 連線，listener 留著，主站可以重連。回傳關掉幾條。RTU 模式回錯誤。

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

- 省略的條件表示不限。請求碰到 `addressRange` 內任何一個位址就算符合。
- 每個請求依序比對清單，第一條所有條件都符合的規則決定它，所以清單的順序就是優先順序。
- `everyNth: N` 時，規則只決定它符合的第 N、2N、… 個請求；其餘的照常回應，也不會交給後面的規則。
- `exception` 回該 exception code，`no_response` 不回應；兩者的寫入都不寫進 Server。`delay` 在請求到達時照常讀寫，回應的是那一刻讀到的值，晚 `ms` 毫秒才送出；等待期間值改變、被刪除或載入設定檔，都不影響這個回應。`delay` 的上限與一份清單的規則數上限寫在 tool 說明裡。
- TCP 上，規則在 Server 自己的檢查之前生效，所以對 Server 沒有的 unit id 或超出範圍的位址也有效。
- RTU 上，Server 沒有的 unit id 一律不回應，不經過規則，也不計入 `matched`：那個 id 屬於匯流排上的真實設備，模擬器回任何 frame 都會與它衝突。
- RTU 的 broadcast（unit 0）不論規則都不回應；`exception` 或 `no_response` 規則會讓 broadcast 寫入一個位址都不寫。
- 已排程的延遲回應：清除或取代規則不會取消，照原定時間送出；停止或刪除該 Server（包括切換 TCP／RTU、改 port）會取消，不再送出。
- `forSeconds` 秒後規則自動移除。
- 規則只存在 main 的記憶體：重開 app、刪除 Server、對該 Server 載入設定檔或 project 檔時清空。
- 規則也能在 Server 畫面上編輯（main window 與拆出來的 Server 視窗都是）：**Fault rules** 按鈕開對話框，每條規則一行，可上移、下移、編輯、刪除，底部有新增、重新整理與全部清除。按鈕在有規則時顯示條數。
- 畫面上的每次修改都是整份取代，與 `server_set_faults` 相同，所以每條規則的 `matched`、`triggered` 歸零，每個 `forSeconds` 的計時重新開始。對話框的次數只在開啟、規則變動與按下重新整理時讀取。
- 畫面的寫入只在 main 的清單仍是對話框讀到的那份時才生效。清單在這之間被 `server_set_faults`、另一個視窗或 `forSeconds` 到期改過，寫入就不生效，對話框保留表單並改顯示目前的清單。`server_set_faults` 本身不做這個檢查。
- Server 刪除後，main 不給它的 `uuid` 任何規則，畫面與 `server_set_faults` 都一樣。開著的對話框關掉表單、丟掉草稿、停用所有寫入，並說明 Server 已刪除。Undo 復原的 Server 從沒有規則開始。
