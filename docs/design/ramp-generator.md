# Server 點位的 Ramp 模式（遞增/遞減）

目標：Server 的暫存器除了 Fixed 與隨機 Generator，多一種 Ramp：從初始值開始，每隔一段時間加或減一個固定步進，到界限後跳回初始值或停住。視窗與 MCP 都能設定與讀回。

狀態：設計已與 owner 對過，尚未寫程式碼。分支 `feature/ramp-generator`，自 `develop` 分出。

## 為什麼需要

owner 要模擬兩種訊號，隨機 Generator 做不到：

- **kWh 累加。** 電度一直 `+=`，超過上限 overflow 後從頭開始。
- **溼度穩定下降。** 數值一直 `-=`，途中穿過告警門檻讓告警觸發，到底後重新開始。

兩者都是鋸齒波：單向走到界限，跳回初始值再走。

## 目標

- 新增點位對話框有第三個模式 `Ramp`，可設定 Start、Step、Min、Max、Interval、Restart。
- Step 正數遞增，負數遞減。
- Restart 預設勾選。勾選時到界跳回 Start，不勾時停在最後一個界內的值。
- 存進 Server 設定、設定檔、undo，重新開啟後照樣運作。
- MCP 的 `server_apply_point_table` 能建立 Ramp 點位，`server_get_values` 能讀回它的設定。

## 不做

- 到界後反向（三角波）。
- 小於 1 秒的間隔。Ramp 沿用 `RegisterParamsGeneratorPartSchema` 的 `interval` 限制。
- coil、discrete input、`utf8`、`bitmap`、`unix`、`datetime` 的 Ramp。
- 記住走到哪。重啟 app、重新載入設定、編輯該點位，都從 Start 開始。
- 修正 `int64`/`uint64` 超過 `Number.MAX_SAFE_INTEGER` 的精度。min、max、value 現在就是 `number`，Ramp 沿用。

## 不可發生

- Ramp 寫出型別裝不下的值。`ValueGenerator` 的寫入在 `setInterval` 裡，encoder 丟例外就是 main 的 uncaught exception。
- 舊設定檔讀不進來，或其中的隨機 Generator 行為改變。
- `server_set_values` 能寫進 Ramp 驅動的暫存器，下一次步進又把它蓋掉。

## 做法

考慮過三種：

- **A. 在現有 generator 欄位上加 `mode`（選定）。** Ramp 共用 `min`、`max`、`interval`，另加 `mode`、`start`、`step`、`restart`。`mode` 缺省是隨機，所以舊資料不用 migration。現有用 `params.min !== undefined` 或 `value !== undefined` 分辨 Fixed 與 generator 的地方對 Ramp 仍然答對。代價是錯的欄位組合要靠 schema 的 refine 擋。
- **B. 第三種獨立型別，欄位不共用。** 型別層就寫不出錯的組合，但每個分辨 Fixed 與 generator 的地方都要補分支，漏一處 TypeScript 不會報錯，Ramp 會被當成 Fixed。
- **C. 所有點位加明確的 `mode: fixed | random | ramp`。** 要寫 store migration 並改設定檔格式，遠大於這次需求。

owner 選 A，因為 Ramp 與隨機在這個程式裡該受的待遇相同：都有上下限與間隔，都由 timer 驅動，都不能被手動寫值。

## 資料

`RegisterParamsGeneratorPartSchema` 加四個選填欄位，`RegisterParamsStaticPartSchema` 把這四個欄位禁掉，寫法同它現在禁 `min`、`max`、`interval`。

| 欄位 | 型別 | 意義 |
|---|---|---|
| `mode` | `'random' \| 'ramp'`，缺省 `random` | 產生方式 |
| `start` | number | Ramp 的初始值，raw |
| `step` | number | 每次的增量，raw，正負皆可 |
| `restart` | boolean，缺省 `true` | 到界後是否跳回 `start` |

`RegisterParamsSchema` 的 refine 要擋：

- `mode` 不是 `ramp` 而帶 `start`、`step` 或 `restart`。
- `mode` 是 `ramp` 而缺 `start` 或 `step`。
- `step` 為 0。
- `min` 大於 `max`。隨機模式容許這個，Ramp 不容許，因為到界判定讀它。
- `start` 不在 `min` 到 `max` 之間。
- `dataType` 是 `unix`、`datetime`、`utf8`、`bitmap` 或 `none`。
- 整數型別的 `start` 或 `step` 不是整數。（這是我的決定：整數暫存器上的小數步進會被 encoder 處理成使用者沒打的數。）

`min` 與 `max` 已經過 `getValueRangeError`，`start` 夾在兩者之間，所以每個寫出的值都在型別範圍內。

## 行為

在 `ValueGenerator` 裡，`mode` 是 `ramp` 時：

1. 建構時寫入 `start`。
2. 每個 `interval`，算下一個值 `start + n * step`，`n` 是自上次從 `start` 出發後走的步數。用步數算而不累加，浮點型別才不會漂移。
3. 下一個值小於 `min` 或大於 `max` 時：`restart` 為真就寫入 `start` 並把 `n` 歸零；為假就不寫，並停掉 timer。
4. 下一個值與到界判定都以 `BigInt` 精確計算：`start`、`step`、`min`、`max` 各自以能寫回自身的最少小數位讀成十進位，再乘十的冪次對齊到四者中最多的小數位。`3 * 0.1` 在 `Number` 裡是 `0.30000000000000004`，以 `Number` 判定時 Max 0.3 永遠寫不到，設在界限上的告警門檻就不會觸發；以十進位計算時它等於 0.3。越過界限的值，差距再小也不會寫成界限。int64 的 `n * step` 可達約 `2 ** 54`，超出安全整數範圍，同一套 `BigInt` 計算也讓它保持精確。
5. `params` getter 回傳含 `mode`、`start`、`step`、`restart` 的參數，讓 `syncServerRegisters` 能重建。

例：`uint32`、Start 0、Step 1、Max 為型別上限，是 kWh overflow 歸零。Start 80、Step -1、Min 20、Max 80，是溼度降到 20 後跳回 80。

`registry.ts` 的 `addRegister` 把新欄位傳給 `ValueGenerator`。它分辨 Fixed 的條件不用改。

## 視窗

```
[ Fixed ] [ Generator ] [ Ramp ]

Start [ 0 ]  Step [ 1 ]  Min [ 0 ]  Max [ 65535 ]  Interval (s) [ 1 ]  [x] Restart
```

- `FixedOrGenerator` 的 toggle 多一顆 `Ramp`。型別是 `unix` 或 `datetime` 時不顯示這顆，已選 Ramp 再切到這些型別時退回 Generator。`utf8` 與 `bitmap` 照舊整組隱藏並強制 Fixed。
- Min、Max、Interval 沿用現有欄位與 mask。Start 與 Step 是新的 masked 欄位，Step 的 mask 容許負號。Restart 是 checkbox。
- 預設值：Start 0、Step 1、Restart 勾選。Min 與 Max 和 Generator 共用同一份狀態，預設照 `FIELD_DEFAULTS`，在 Generator 與 Ramp 之間切換時保留已輸入的值。上方示意圖的 65535 是使用者輸入的，不是預設。（owner 選定。）
- 驗證同 schema：Step 不為 0、Start 在 Min 與 Max 之間、Min 不大於 Max。不過就把欄位標紅並停用 Add。
- 編輯既有 Ramp 點位時，對話框以 Ramp 模式開啟並帶回全部欄位。`toFormSnapshot` 納入新欄位，dirty 判定才看得到它們。
- `data-testid`：`add-reg-ramp-btn`、`add-reg-start-input`、`add-reg-step-input`、`add-reg-restart-checkbox`。
- 表單狀態怎麼表示三選一（現在是 `fixed: boolean`）留給實作者，遵守 store 的既有寫法。

## MCP

`PointGeneratorSchema` 加 `mode`、`start`、`step`、`restart`，全部是工程值：

```json
"generator": { "mode": "ramp", "start": 80, "step": -1, "min": 20, "max": 80,
               "intervalSeconds": 1, "restart": true }
```

`serverValue` 在 `mode` 是 `ramp` 時：

- `unix`、`datetime` 拒絕。coil、discrete input、`utf8` 已被現有規則拒絕。
- 缺 `start`、`step`、`min` 或 `max` 拒絕。
- `start`、`min`、`max` 經 `engineeringToRaw` 換成 raw，`min`、`max` 照現在的寫法排成低者在前。
- raw 步進是 `engineeringToRaw(start + step)` 減 `engineeringToRaw(start)`。負的 scaling factor 會自然把方向翻過來。算出 0 就拒絕，理由寫明步進小於這個 scaling 的解析度。
- raw 的 `start` 不在 raw 的 `min` 與 `max` 之間就拒絕。

`ResolvedGenerator` 與 `serverRegisterParams` 帶上新欄位。`mode` 缺省時行為與現在相同。

`server_get_values` 回報的 `generator` 在 Ramp 時多 `mode`、`start`、`step`、`restart`，都是 raw，與它現在回報 `min`、`max` 的單位一致。

`server_set_values` 對 Ramp 暫存器的拒絕不用改程式，但要有測試釘住。

文字要更新：`server_apply_point_table` 與 `server_get_values` 的 description、`prompts.ts` 裡教 agent 選 fixed 或 generator 的步驟（累加量如電度用 Ramp）、`docs/mcp.md` 中描述 generator 的地方。

## 測試

- **`valueGenerator.test.ts`**，用 fake timer：遞增到界後重啟、遞減到界後重啟、`float` 步進 0.1 寫得到界限、`restart` 為假時停住且不再寫入、步進不整除範圍時不越界、`params` 往返。
- **`schemas.test.ts`**：上面每一條 refine 各一個被拒的例子，以及沒有 `mode` 的舊 generator 照樣通過。
- **`pointTable.test.ts` 與 `pointTableTools.test.ts`**：Ramp 的 scaling 換算、負 factor 翻向、各種拒絕、`server_get_values` 的回報、`server_set_values` 的拒絕。
- **對話框的單元測試**：`toRegisterParams` 的 Ramp 分支、編輯時帶回欄位、驗證。
- **e2e**：`e2e/specs/01-main/` 末尾加一支新 spec。建一個 Ramp 點位，用 Client 讀到它上升，再讀到它回到 Start。

## 文件

- `docs/manual/README.md` 的「固定值與隨機產生器」一節加 Ramp 與欄位說明。截圖要跑 `yarn presentation`，所以 `03-presentation` 要加一個場景。
- `CHANGELOG.md` 加一條，寫使用者現在能做什麼。

## 留給實作者

- `ValueGenerator` 內部怎麼分隨機與 Ramp。
- 新 masked input 的寫法，照 `maskedInputs.tsx` 現有的做。
- e2e spec 的編號與確切步驟。
