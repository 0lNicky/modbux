# MCP 除錯紀錄與故障注入

狀態：設計待確認，尚未寫任何程式碼。只在 fork 開發。

## 目標

1. **AI 讀不到值時能自己找原因。** 現在 tool 失敗只回錯誤訊息。AI 要看得到送出的 frame、回來的 frame、exception code 與回應耗時。
2. **模擬器看得到主站問了什麼。** 上位系統連模擬器讀不到值時，模擬器這一側要有紀錄。
3. **模擬器能模擬設備故障。** 用來測上位系統遇到 exception、不回應、延遲、斷線時的行為。

## 不做

- Frame 層的故障：CRC 錯誤、截斷的 frame、transaction id 不符。這些要包住 socket 或 serial port。
- 故障規則存進設定檔。
- 在畫面上編輯故障規則。這是步驟 D，另外設計。
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
| D | 在畫面上編輯故障規則 | C，另外設計 |

### A. Client 除錯

1. **main 留存 transaction。** `TransactionLog` 保留最近的紀錄，上限與 renderer 的相同。送給畫面的行為不變。
2. **回應耗時。** `Transaction` 加選填的 `durationMs`：從送出請求到 `log` 被呼叫的毫秒數。timeout 的請求，耗時就是等到 timeout 的時間。`TransactionGrid` 多一欄。
3. **`client_get_transactions`。** `readOnlyHint`。參數：`limit`（預設 50）、`sinceTimestamp`、`failedOnly`。回傳每筆的欄位，加上 `exceptionCode`：response 的 function code 最高位元為 1 時，取其後一個 byte。
4. **失敗時附上證據。** `client_read_points` 與 `client_write` 失敗時，結果附上這次呼叫期間記下的失敗 transaction，含 `exceptionCode`。Client 同一時間只有一個擁有者，所以「這次呼叫期間」不會混到別人的請求。
5. **掃描 tool 不附。** `client_scan_unit_ids` 的每個無回應 unit 都是一筆 timeout，附上去只是雜訊。要看就呼叫 `client_get_transactions`。
6. **測試。** `TransactionLog` 的留存與上限、`exceptionCode` 的解析（TCP 與 RTU 的 frame 偏移不同，各一個案例）、tool 的篩選；一條 e2e：Client 讀一個 Server 沒有的 unit id，`client_read_points` 的錯誤裡有 exception 11 的 transaction。

### B. Server 請求紀錄

1. **記錄與判斷的單位是一個請求，不是一次 accessor 呼叫。** register 的讀取改用 `getMultipleHoldingRegisters` 與 `getMultipleInputRegisters`，FC16 改用 `setRegisterArray`，vector 一次看到整個請求。coil 與 discrete input 的讀取沒有這種 accessor，FC15 的 `setCoilArray` 不能用（見現況），所以這三種照舊逐位址呼叫 `getCoil`、`getDiscreteInput`、`setCoil`：同一個請求的呼叫在同一段同步執行內，兩個 frame 各自經過一次 `setTimeout`，所以收集到這段同步執行結束再一起回答。
2. **多筆寫入因此是整筆成立或整筆不成立。** 現在 FC16 寫到一半遇到錯誤時，前面的位址已經寫入。改成先檢查整個請求，通過才寫。FC16 與 FC15 都是。
3. **一筆的內容：** `timestamp`、Server 的 `uuid`、`unitId`、`direction`（`read` 或 `write`）、`registerType`、`address`（第一個位址）、`count`、`outcome`（`ok`、`exception` 加 code、`no_response`）、選填的 `fault`。寫入另外記寫進來的值。`fault` 在 B 只定義形狀，由 C 填入：生效的是第幾條規則，以及延遲的毫秒數。有它，注入的 exception 才和 Server 自己回的分得開，延遲的請求也不會只記成 `ok`。
4. **每台 Server 保留最近的紀錄，有上限。** Server 刪除時一併清掉。不存檔。
5. **`server_get_requests`。** `readOnlyHint`。參數：`uuid`（省略時用主 Server）、`limit`（預設 50）、`sinceTimestamp`、`failedOnly`。
6. **`McpToolContext.server` 的 `Pick` 加上讀紀錄的方法。**
7. **測試。** 多 word 讀取是一筆、多 bit 讀取合成一筆、三種 `outcome`、RTU broadcast 寫入、被拒絕的多筆寫入一個位址都沒寫進去；一條 e2e：Client 讀 Server，`server_get_requests` 回那一筆。

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

C 完成後另外設計。C 的畫面只做顯示與清除，但規則的事件與 channel 要讓 D 能直接沿用。

## 還沒實測，先寫測試再做

- **延後呼叫 `cb`。** `vector.ts` 的註解說 accessor 必須同步，指的是不能 `async`。用 `setTimeout` 延後呼叫 `cb`，從 handler 的原始碼讀起來可行，沒有跑過。
- **切斷連線。** `servertcp.js` 把開啟的 socket 記在 `socks`，`ServerTCP` 的型別沒有宣告它。像 `transactionLog.ts` 對待 `_transactions` 那樣，把用到的內部形狀寫在一處。

## 留給實作的人決定

- 紀錄上限的確切數字、`delay` 的上限。
- `durationMs` 在 `TransactionLog` 內計時，還是由 `ModbusClient` 傳入。
- 故障規則與請求紀錄放在 `ServerRegistry` 裡，還是 `modbusServer/` 下的新模組。
- renderer 用哪個 store 放故障標示的狀態。
