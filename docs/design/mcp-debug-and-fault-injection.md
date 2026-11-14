# MCP 除錯紀錄與故障注入

狀態：設計待確認，尚未寫任何程式碼。只在 fork 開發。

## 目標

1. **AI 讀不到值時能自己找原因。** 現在 tool 失敗只回錯誤訊息。AI 要看得到送出的 frame、回來的 frame、exception code 與回應耗時。
2. **模擬器看得到主站問了什麼。** 上位系統連模擬器讀不到值時，模擬器這一側要有紀錄。
3. **模擬器能模擬設備故障。** 用來測上位系統遇到 exception、不回應、延遲、斷線時的行為。

## 不做

- Frame 層的故障：CRC 錯誤、截斷的 frame、transaction id 不符。這些要包住 socket 或 serial port。
- 故障規則存進設定檔。
- 故障規則的一鍵預設情境。
- 在畫面上顯示 Server 請求紀錄。

## 現況

- `modbusClient/transactionLog.ts` 的 `TransactionLog.log` 組出一筆 `Transaction`，只用 `windows.send('transaction', ...)` 送給 main window。main 不留存。renderer 的 `data.zustand.ts` 保留最近的紀錄並有上限。
- `TransactionSchema`（`shared/types/client.ts`）有 `timestamp`、`unitId`、`address`、`code`、`responseLength`、`timeout`、`request`、`responses`、`errorMessage`。沒有耗時。
- `ModbusClient` 的每個請求都是先 `nextTransactionIdKey()`、送出、再 `log(key, errorMessage)`。
- `src/main/modules/mcp` 沒有任何 tool 讀 transaction。
- Server 的每個請求都經過 `modbusServer/vector.ts` 的 `get` 與 `set`。`rtu.ts` 與 `tcp.ts` 用同一個 `createVector`。
- `vector.ts` 已經用 `mbError` 回 exception 2、4、11，`refuseUnit` 已經用不呼叫 `cb` 做到不回應。
- `servertcp_handler.js` 讀多個位址時，對每個位址呼叫一次 accessor，用計數器收齊 `cb` 後才組包。任何一個 `cb` 帶錯誤，整個請求回 exception。`serverserial.js` 用的是同一個 handler。
- 同一個 handler 在 vector 有 `getMultipleHoldingRegisters`、`getMultipleInputRegisters`、`setRegisterArray`、`setCoilArray` 時改呼叫它們，一個請求一次。兩個 `getMultiple*` 只在數量大於 1 時呼叫，讀一個 register 仍走 `getHoldingRegister` 與 `getInputRegister`。coil 與 discrete input 的讀取沒有整個請求的 accessor。
- `setCoilArray` 不能用。modbus-serial 8.0.25 的 FC15 handler 先把每個位址的 `cb` 都呼叫完、回了成功，才呼叫 `setCoilArray`，所以它回不了 exception，也做不到不回應。
- FC16 現在是逐位址呼叫 `setRegister`，每次立刻寫進 registry。
- Server 沒有請求紀錄。
- `McpToolContext.server`（`registry.ts`）目前只有 `readRegisters`。

## 做法的選擇

**故障注入在哪一層。**

- **vector 層（採用）。** 在 `get` 與 `set` 裡依規則決定回 exception、不呼叫 `cb`、或延後呼叫 `cb`。TCP 與 RTU 共用，不碰 modbus-serial 的內部。做不到 frame 層的故障。
- **包住 socket 與 serial port。** 什麼故障都做得到，但要改寫 modbus-serial 的收發路徑，serial 那一側使用者已決定不處理。
- **在 Server 前面放一個 proxy。** 不動現有 Server，但 RTU 沒辦法 proxy，而且多一個 port 要管理。

**Server 請求紀錄記在哪一層。**

- **vector 層（採用）。** 記解析後的內容：unit id、register 類型、位址、數量、結果。TCP 與 RTU 都有。沒有原始 hex。
- **socket 層。** 有原始 hex，但只有 TCP，RTU 要碰 serial port。

## 步驟

每一步一個 PR，從 `icp` 開分支。

| 步驟 | 內容 | 依賴 |
| ---- | ---- | ---- |
| A | Client 的 transaction 紀錄開給 MCP | 無 |
| B | Server 請求紀錄 | 無 |
| C | 故障注入，設定只從 MCP 進來，畫面顯示與清除 | B |
| D | 在畫面上編輯故障規則 | C |

### A. Client 除錯

1. **main 留存 transaction。** `TransactionLog` 保留最近的紀錄，上限與 renderer 的相同。送給畫面的行為不變。
2. **回應耗時。** `Transaction` 加選填的 `durationMs`：從送出請求到 `log` 被呼叫的毫秒數。timeout 的請求，耗時就是等到 timeout 的時間。`TransactionGrid` 多一欄。
3. **`client_get_transactions`。** `readOnlyHint`。參數：`limit`（預設 50）、`sinceTimestamp`、`failedOnly`。回傳每筆的欄位，加上 `exceptionCode`：response 的 function code 最高位元為 1 時，取其後一個 byte。紀錄裡的 frame 在每種通訊協定下都是 unit id、function code、資料、CRC：modbus-serial 的 TCP port 收到回應時先去掉 MBAP header 再往上傳，所以 function code 一律是第 1 個 byte。
4. **失敗時附上證據。** `client_read_points` 與 `client_write` 失敗時，結果附上這次呼叫期間記下的失敗 transaction，含 `exceptionCode`。Client 同一時間只有一個擁有者，所以「這次呼叫期間」不會混到別人的請求。
5. **掃描 tool 不附。** `client_scan_unit_ids` 的每個無回應 unit 都是一筆 timeout，附上去只是雜訊。要看就呼叫 `client_get_transactions`。
6. **測試。** `TransactionLog` 的留存與上限、`exceptionCode` 的解析（TCP 實際擷取的 frame 與 RTU 的 frame 各一個案例，偏移相同）、tool 的篩選；一條 e2e：Client 讀一個 Server 沒有的 unit id，`client_read_points` 的錯誤裡有 exception 11 的 transaction。

### B. Server 請求紀錄

1. **記錄與判斷的單位是一個請求，不是一次 accessor 呼叫。** register 的讀取改用 `getMultipleHoldingRegisters` 與 `getMultipleInputRegisters`，FC16 改用 `setRegisterArray`，vector 一次看到整個請求。coil 與 discrete input 的讀取沒有這種 accessor，FC15 的 `setCoilArray` 不能用（見現況），所以這三種照舊逐位址呼叫 `getCoil`、`getDiscreteInput`、`setCoil`：同一個請求的呼叫在同一段同步執行內，兩個 frame 各自經過一次 `setTimeout`，所以收集到這段同步執行結束再一起回答。
2. **多筆寫入因此是整筆成立或整筆不成立。** 現在 FC16 寫到一半遇到錯誤時，前面的位址已經寫入。改成先檢查整個請求，通過才寫。FC16 與 FC15 都是。
3. **一筆的內容：** `timestamp`、Server 的 `uuid`、`unitId`、`direction`（`read` 或 `write`）、`registerType`、`address`（第一個位址）、`count`、`outcome`（`ok`、`exception` 加 code、`no_response`）、選填的 `fault`。寫入另外記寫進來的值。`fault` 在 B 只定義形狀，由 C 填入：生效的是第幾條規則，以及延遲的毫秒數。有它，注入的 exception 才和 Server 自己回的分得開，延遲的請求也不會只記成 `ok`。
4. **紀錄在 vector，只有到達 Server 暫存器的請求。** modbus-serial 在 vector 之前自己處理的請求不記，故障規則也不套用：FC1、FC2、FC3、FC4、FC15 數量為 0（exception 2）、FC1 或 FC2 數量大於 2040 與 FC3 或 FC4 數量大於 127（exception 4）、vector 沒有對應 accessor 的 function code（exception 1）、長度不符的 frame（不回應）。RTU 的 CRC 錯誤不在其中：library 重算並蓋掉收到的 CRC，錯的 frame 照樣到達 vector。要記它們得在 library 之下解析 frame，「記在哪一層」已選擇不做。FC16 數量為 0 會呼叫 vector，照常記錄。
5. **每台 Server 保留最近的紀錄，有上限。** Server 刪除時一併清掉。不存檔。
6. **`server_get_requests`。** `readOnlyHint`。參數：`uuid`（省略時用主 Server）、`limit`（預設 50）、`sinceTimestamp`、`failedOnly`。
7. **`McpToolContext.server` 的 `Pick` 加上讀紀錄的方法。**
8. **測試。** 多 word 讀取是一筆、多 bit 讀取合成一筆、三種 `outcome`、RTU broadcast 寫入、被拒絕的多筆寫入一個位址都沒寫進去；一條 e2e：Client 讀 Server，`server_get_requests` 回那一筆。

### C. 故障注入

**規則的形狀。** 每台 Server 一份清單，依序比對，第一條符合的生效。

```ts
{
  // 條件：省略的欄位表示不限
  unitId?: number
  registerType?: RegisterType
  addressRange?: [start: number, end: number] // PDU 位址，含兩端
  direction?: 'read' | 'write'
  // 動作：三選一
  action:
    | { kind: 'exception'; code: number }
    | { kind: 'no_response' }
    | { kind: 'delay'; ms: number }
  // 觸發：省略表示每次
  everyNth?: number // 每 N 個符合的請求觸發一次
  forSeconds?: number // 設定後過這麼多秒，規則自動移除
}
```

- 請求碰到 `addressRange` 內任何一個位址，就算符合該規則。
- 一個請求只套用一條規則：清單裡第一條符合的。比對的是整個請求，不是個別位址，所以清單的順序就是優先順序。
- `exception` 與 `no_response` 的寫入都不寫進 registry。`no_response` 模擬的是設備沒收到，不是回應在路上遺失。
- 「拒絕寫入」是 `direction: 'write'` 加 `exception`。
- 「unit 離線」是只給 `unitId` 加 `no_response`。
- `delay` 只延後回應，值照常讀寫。延後的時間有上限。
- RTU 的 broadcast 照舊不回應，規則不改變它。
- `everyNth` 數的是符合該規則的請求。
- 生效的規則寫進 B 的請求紀錄的 `fault`。

**狀態。** 規則只存在 main 的記憶體。重開 app、刪除 Server、對該 Server 載入設定檔或 project 檔時清空。

**Tools。**

- `server_set_faults`：`uuid`、`rules`。整份取代。回傳生效的清單。
- `server_get_faults`：回目前的清單與每條規則已觸發的次數。
- `server_clear_faults`：清空。
- `server_drop_connections`：切斷該 Server 現有的 TCP 連線，listener 留著，主站可以重連。RTU 模式回錯誤。

四個都不是 `writesToDevice`：對象是 Modbux 自己的模擬器，不是裝置。

**畫面。** Server 有規則生效時，Server 畫面顯示一個標示，寫出規則條數，並有一個清除按鈕（帶 `data-testid`）。main window 與 server window 都要顯示。需要一個 main 到 renderer 的事件通知規則變動，一個取得目前規則的 channel（視窗重新載入後要能補上），一個清除的 channel。

**Prompt。** `simulate_device_fault`：參數是要模擬的狀況。說明如何用規則組出離線、忙碌、回應慢、斷線，如何用 `server_set_values` 組出值凍結、無效值哨兵（`0xFFFF`、`0x8000`、float 的 NaN）、超量程、累計值回捲，以及如何用 `server_get_requests` 確認故障真的被觸發。

**文件。** `docs/mcp.md` 補上 A、B、C 的 tool 與 prompt。

**測試。** vector 的每種動作、`everyNth`、`forSeconds`、規則順序；一條 e2e 走閉環：設故障，Client 讀取，`client_get_transactions` 看到 exception，`server_get_requests` 看到同一筆，清除後讀取恢復正常；畫面的標示與清除按鈕。

### D. 在畫面上編輯故障規則

**目的。** 沒有網路、用不了 AI 時的備援。功能要和 MCP 的一樣齊，畫面從簡。

**寫入的做法。**

- **整份取代（採用）。** 畫面把整份清單送給 main，經 `ModbusServer.replaceFaults` 與 `ServerFaults.replace` 交給 `ServerFaults.set`，與 MCP 的 `server_set_faults` 是同一個取代。`ServerFaults.set` 會把每條規則的次數歸零，並重新開始每個 `forSeconds` 的計時，所以改任何一條，其他規則的計數與倒數都重來。備援用途下這個代價可以接受，對話框裡要寫明。
- **逐條操作。** 其他規則不受影響，但規則要有 id，MCP 的資料形狀得跟著改。
- **整份取代，main 保留沒變動的規則的狀態。** `server_set_faults` 的行為會跟著變。

**畫面。**

- `ServerFaultsIndicator` 改成一顆永遠都在的按鈕，有規則時顯示條數並用 warning 色。按下去開對話框。原本的清除按鈕移進對話框。
- 對話框每條規則一行：條件與動作的摘要、觸發次數與符合次數、`forSeconds` 剩餘的秒數，以及上移、下移、編輯、刪除。順序就是優先順序，因為第一條符合的規則生效。
- 新增與編輯用同一張表單，列出規則的全部欄位：`unitId`、`registerType`、`addressRange`、`direction`、`action`、`everyNth`、`forSeconds`。條件欄位留空表示不限。`action` 三選一：`exception` 加 code、`no_response`、`delay` 加毫秒數。表單用 `ServerFaultRuleSchema` 驗證，不合格不送出。
- 對話框底部：新增、重新整理、全部清除。
- main window 與 server window 都有。每個可互動的元素帶 `data-testid`。

**Channel。**

- `set_server_faults`：`uuid`、`version` 與 `rules`，整份取代。帶物件，所以要有 schema。回 `{ taken, status }`，payload 不合格時回 `undefined`。
- `get_server_fault_status`：`uuid`，回 `{ version, rules, exists }`，`rules` 是 `ServerFaultRuleStatus[]`，`exists` 說 main 有沒有這台 Server。
- 清除沿用 `clear_server_faults`，清單的變動沿用 `server_faults` 事件，事件帶 `version`。

**清單的版本。** 畫面送出的清單是從它讀到的清單改出來的，main 的清單若已經變了，整份取代會讓刪掉的規則復活、或丟掉別處加的規則。所以：

- main 為每個 Server 的清單記一個版本。MCP 或畫面的設定、清除、`forSeconds` 到期、刪除 Server 都會換一個新版本。版本來自一個只增不減的計數器，所以同一個 uuid 不會再拿到用過的版本。
- `set_server_faults` 帶著清單讀到時的版本。main 在同一個同步步驟裡比對版本並取代；版本不符就什麼都不改，回 `taken: false` 與 main 現在的清單。
- `server_set_faults` 不比對版本，照舊無條件取代。
- 對話框在第一次狀態還沒回來、有狀態查詢在途中、或另一筆寫入還沒回來時，不提供寫入：新增、上移、下移、刪除與表單的儲存都停用。所以同一個對話框的寫入一筆接一筆，每筆都從前一筆回覆的清單改出來。
- 寫入被 main 以版本拒絕時，表單與草稿留著，錯誤訊息說規則已經變了，對話框改顯示 main 回的清單。

**已刪除的 Server。** 刪除後 main 對這個 uuid 回的是新版本的空清單，只比對版本會讓刷新後的儲存把規則放回去，Undo 以同一個 uuid 復原時規則就會生效。所以：

- main 記得有哪些 Server：主 Server 一直都有，其他的從 `createServer` 或 `startRtuServer` 起算，到 `deleteServer` 為止。這不看 TCP listener，bind 失敗或在 RTU 模式下停掉的 Server 仍然可以設規則。
- `ModbusServer.setFaults`（`server_set_faults` 用的）與 `ModbusServer.replaceFaults`（`set_server_faults` 用的）在同一個同步步驟裡先問 main 有沒有這台 Server，沒有就什麼都不改。
- 狀態的 `exists` 為 false 時，對話框關掉表單、丟掉草稿、停用所有寫入，並說明 Server 已刪除。之後的刷新若看到 Server 又在了，就恢復寫入。
- Undo 復原的 Server 從沒有規則開始，因為刪除時清單已清空，之後也沒有路徑能給它規則。

**次數不自動更新。** 開啟對話框、收到 `server_faults`、按重新整理時各讀一次 `get_server_fault_status`。

**不變的。** 規則仍然不存檔。MCP 的四個 tool 與規則的形狀不動。

**文件。** `docs/mcp.md` 補一句：規則也能在 Server 畫面上編輯，以及整份取代會讓次數與倒數重來。

**測試。** 表單的驗證與每個欄位、摘要文字、上移下移；一條 e2e：在畫面上新增一條 exception 規則，Client 讀取得到該 exception，對話框的次數在重新整理後增加，編輯、移動、刪除、全部清除各走一次，並確認 MCP 的 `server_get_faults` 看到畫面設的規則。

## 還沒實測，先寫測試再做

- **延後呼叫 `cb`。** `vector.ts` 的註解說 accessor 必須同步，指的是不能 `async`。用 `setTimeout` 延後呼叫 `cb`，從 handler 的原始碼讀起來可行，沒有跑過。
- **切斷連線。** `servertcp.js` 把開啟的 socket 記在 `socks`，`ServerTCP` 的型別沒有宣告它。像 `transactionLog.ts` 對待 `_transactions` 那樣，把用到的內部形狀寫在一處。

## 留給實作的人決定

- 紀錄上限的確切數字、`delay` 的上限。
- `durationMs` 在 `TransactionLog` 內計時，還是由 `ModbusClient` 傳入。
- 故障規則與請求紀錄放在 `ServerRegistry` 裡，還是 `modbusServer/` 下的新模組。
- renderer 用哪個 store 放故障標示的狀態。
