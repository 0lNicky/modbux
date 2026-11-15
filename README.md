# Modbux

[English](./README.en.md) | 正體中文

> 本專案 Fork 自 [ploxc](https://github.com/ploxc) 開發的 [ploxc/modbux](https://github.com/ploxc/modbux)。

## 交由 AI 代理程式安裝

將以下內容貼入 Claude Code、Codex、Antigravity 或任何可執行 shell 指令的代理程式：

````text
Install Modbux from its latest release at https://github.com/fengchyunbih/modbux/releases
and connect it to yourself as an MCP server. Do these in order, and stop at step 2.
Do not build from source.

1. Download the installer for my OS and CPU from the latest release, and install it:
   macOS .dmg (arm64 for Apple silicon, x64 for Intel), Windows x64-setup.exe, Linux
   .deb or .AppImage. For example: gh release download -R fengchyunbih/modbux --pattern "*arm64.dmg"
   If macOS says the app is damaged, tell me; I open it with right-click, Open.
   Then start Modbux.
2. Ask me to open the Modbux window, press the settings button on the Home screen,
   open the MCP page and switch "Enable MCP" on. It is off by default and only I can
   switch it. Leave "Allow writes to devices" off unless I say otherwise. Wait for me.
3. Read the token from mcp.json in Modbux's user data directory:
   macOS ~/Library/Application Support/Modbux, Windows %APPDATA%\Modbux,
   Linux ~/.config/Modbux.
4. Register the MCP server in the client you are running in.
   - Claude Code:
     claude mcp add --transport http modbux http://127.0.0.1:15502/mcp --header "Authorization: Bearer <token>"
   - A client without HTTP headers (Codex and others): ask me to copy the stdio command
     shown on the same MCP page ("Any client that starts a stdio server") and register
     it. It reads the token from mcp.json by itself.
5. Check it: call the tool server_list. An error that starts with "Modbux endpoint:"
   means the stdio bridge could not use Modbux's HTTP endpoint; the text after it is
   the reason. A refused connection means Modbux is not running or MCP is not enabled;
   401 means the token is wrong.
6. Tell me what I can ask you now. The MCP prompts take a pasted point table:
   point_table_to_client reads the device, point_table_to_simulator builds a simulated
   server, closed_loop_test checks both against each other. Scanning unit IDs and
   registers, polling and reading work without writes. Writing to a device needs
   "Allow writes to devices".
````

詳細說明請見 [docs/mcp.md](docs/mcp.md) 與[使用手冊](docs/manual/README.md)。

<img src="./resources/icon.png" alt="Logo" width="60" />

[![Release](https://img.shields.io/github/v/release/fengchyunbih/modbux?color=5b9279)](https://github.com/fengchyunbih/modbux/releases)
[![Downloads](https://img.shields.io/github/downloads/fengchyunbih/modbux/total?color=5b9279&label=downloads)](https://github.com/fengchyunbih/modbux/releases)
[![License](https://img.shields.io/github/license/fengchyunbih/modbux?color=5b9279)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-5b9279)

## 適用於 Windows、macOS 與 Linux 的開源 Modbus Client 與 Server 模擬工具

Modbux 在單一應用程式中支援 Modbus TCP、RTU 與 RTU over TCP，可為暫存器指定資料型別、掃描位址與資料、模擬測試用伺服器，並讓你真正看懂所讀到的數值。

## 下載

**[下載最新版本](https://github.com/fengchyunbih/modbux/releases/latest)**

提供 Windows 安裝檔、macOS（Apple Silicon 與 Intel）安裝映像檔，以及 Linux 的 `.deb` 與 `.AppImage`（x64 與 arm64）。

**[閱讀使用手冊](docs/manual/README.md)**、**[閱讀 MCP 說明文件](docs/mcp.md)**，以及其餘功能的[上游說明文件](https://ploxc.com/modbux/docs/latest/getting-started)。

## 功能特色

**Client 模式：**

- 解碼所有常見資料型別：int16/32/64、uint16/32/64、float、double、bitmap、時間戳記（`UNIX` 與 IEC 870-5 `DATETIME`）與 UTF-8 字串；UTF-8 僅供讀取，寫入對話框不支援寫入 UTF-8
- Bitmap 明細面板：可展開檢視 16 個位元，支援逐位元切換、燈號顏色設定、反相（Invert）與行內註解
- Advanced mode（進階模式）：同時顯示所有數值資料型別的解碼結果
- `Read configuration` 模式：僅讀取已設定的暫存器，自動合併分組、顯示群組索引欄位（`G`）與行內錯誤訊息
- 掃描 Unit ID 與暫存器位址範圍，並在掃描進行時即時填入表格
- 區分「回傳例外碼的 Unit」與「無回應的 Unit」：前者代表匯流排上有設備但拒絕該請求，後者代表匯流排上沒有該設備
- 四種位元組與字組順序（`ABCD`、`CDAB`、`BADC`、`DCBA` — 支援交換暫存器順序與交換暫存器內位元組）
- 縮放係數（Scaling factor）與線性內插（Linear interpolation）
- 支援 Modbus TCP（主機名稱或 IP）與 RTU，並自動偵測序列埠（COM 埠）
- 支援 RTU over TCP，適用於傳送封裝 RTU 封包的序列轉乙太網路閘道器
- 通訊紀錄（Transaction log，最多保留 1,000 筆紀錄，包含原始十六進位封包與延遲時間，並支援匯出 CSV）
- 復原與重做（Undo / Redo，最多 100 步）
- 設定檔儲存與載入（JSON）

**Server 模式：**

- 支援 Modbus TCP 與 RTU 伺服器模式（實體序列埠、USB 轉接器、socat 虛擬序列埠）
- 同時模擬最多 10 台 Modbus TCP 伺服器（各自使用不同連接埠）
- 每台伺服器皆支援協定允許的完整 Unit ID 範圍（0–255）
- 支援與 Client 相同的資料型別：數值暫存器、bitmap、UTF-8 字串、Unix 時間戳記與 IEC 870-5 datetime
- 固定數值或可設定更新間隔的隨機數值產生器（Generator）
- 輸出系統目前時間的 Unix / datetime 時間產生器
- 附帶 UTC 切換開關的 DateTimePicker，可設定精確時間戳記
- 重新設計的布林點位介面：逐位址列顯示圓點切換開關、行內註解與游標懸停刪除按鈕
- 故障注入規則（Fault rules，每台伺服器最多 32 條規則：模擬回傳 Modbus 例外碼、`no_response` 或回應延遲 `delay`，支援 `everyNth` 與 `forSeconds` 條件）
- 設定檔儲存與載入，以及完整專案檔儲存與載入（`Save project` / `Open project`，JSON）
- 啟動後即自動開始監聽

**Split Mode（並排模式）：**

- 在兩個獨立視窗中同時執行 Client 與 Server
- Server 在第二個視窗開啟，主視窗則切換為 Client
- 透過 `127.0.0.1` 連線至本機模擬伺服器進行測試
- 適合動手實測 Modbus，或同時開發通訊兩端的程式

**MCP 伺服器：**

- 內建 Model Context Protocol (MCP) 伺服器，監聽 `http://127.0.0.1:15502/mcp`（Streamable HTTP + Bearer token）並提供 `stdio` 轉接器（`out/main/mcpStdio.js`）
- 提供 29 項工具、7 項資源與 4 組提示詞範本，讓 AI 代理程式操控 Client 與 Server
- 具備寫入保護開關（Settings 頁面中的 `Allow writes to devices`）

**狀態自動保存（State Persistence）：**

- Client 與 Server 的設定（連線、讀取設定、點位對應表、伺服器與暫存器）會在關閉與重新啟動之間自動保留
- 連線與輪詢狀態、讀到的數值、通訊紀錄、故障規則與 Undo 歷史則不會保存，詳見[使用手冊第 7 章](docs/manual/README.md#7-狀態保存與復原persistence--undoredo)

## 介面預覽

![Modbux Client UI](./resources/modbux-client.png)

## 實用技巧：讓 AI 處理繁瑣設定

儲存的設定檔皆為 JSON 格式。給 Claude 或 ChatGPT 看幾個暫存器範例、貼上設備說明書的點位表，請它補齊完整對應表，再載入 Modbux 即可完成。歡迎來到 2026 年。

## 安裝說明

### Windows

從 [releases](https://github.com/fengchyunbih/modbux/releases) 下載 `.exe` 安裝檔。

⚠️ **SmartScreen 警告**：點擊「其他資訊」（More info）→「仍要執行」（Run anyway）

### macOS

從 [releases](https://github.com/fengchyunbih/modbux/releases) 下載 `.dmg` 檔案。Apple Silicon 請選擇 `arm64`，Intel 請選擇 `x64`。

**需 macOS 12 以上版本。** Modbux 2.3 升級至 Electron 41，不再支援 Catalina 或 Big Sur。Modbux 2.2.1 仍支援舊版系統，並保留於[上游 releases 頁面](https://github.com/ploxc/modbux/releases)。

⚠️ **首次開啟**：對應用程式按右鍵並選擇「打開」（Open），或至「系統設定 → 隱私權與安全性 → 強制打開」（Open Anyway）。

### Linux

從 [releases](https://github.com/fengchyunbih/modbux/releases) 下載 `.deb` 或 `.AppImage`（支援 x64 與 arm64）。亦可從原始碼建置，請參閱[自行建置](#自行建置)。

在 Linux 上有兩項功能需要應用程式無法自行取得的系統權限，Modbux 會主動彈出提示詢問，而非默默失敗：

- **連接埠 502** 預設保留給 root 使用，因此伺服器會改在其他連接埠啟動。開啟 Server 畫面時會詢問是否調降特權連接埠門檻（可選擇生效至下次重開機或永久生效）。
- **序列埠**屬於特定系統群組（通常為 `dialout`），不在群組內的使用者無法開啟序列埠。由於序列埠仍會出現在清單中，在連線被拒前看起來一切正常。切換至 RTU 時會詢問是否將你的帳號加入群組，並在完成後提供登出選項（因為登入工作階段會維持登入當下的群組權限）。

兩項功能在執行前都會顯示完整指令，並透過 PolicyKit 詢問密碼，Modbux 本身不會經手你的密碼。若在 Flatpak 或 Snap 沙盒中執行，則會改為顯示指令供你自行貼上執行。若想手動執行，指令亦列於下方[自行建置](#自行建置)章節。

## 自行建置

Modbux 是使用 React、TypeScript 與 Material-UI 建構的 Electron 應用程式。

### 環境需求

- Node.js（建議使用 LTS 版本）
- Yarn 套件管理工具

### 安裝步驟

**複製儲存庫並安裝相依套件：**

```bash
git clone https://github.com/fengchyunbih/modbux.git
cd modbux
yarn
```

### 開發模式

**以開發模式啟動應用程式：**

```bash
yarn dev
```

### 測試

**執行單元測試：**

```bash
yarn test
```

**以監看模式執行單元測試：**

```bash
yarn test:watch
```

**執行 E2E 測試：**

```bash
yarn test:e2e
```

**執行目前平台支援的所有測試：**

```bash
yarn test:all:mac
yarn test:all:windows
yarn test:all:linux
```

包含 lint、型別檢查、單元測試、兩種 E2E 模式、畫面截圖與掃描效能測試，以及硬體測試（三個平台皆執行，未接開發板時自動略過）；Linux 另含連接埠 502 對話框測試（唯一需要人工互動的步驟）。推送程式碼前可執行較快速的 `yarn verify`：包含 lint、型別檢查、單元測試與 E2E 測試。

**針對打包後的建置執行 E2E 測試：**

```bash
yarn test:e2e:packaged
```

此指令會先建置並以 `electron-builder --dir` 打包，再針對 `dist/` 中的執行檔（而非 `out/` 開發輸出）執行同一套測試規格。這是唯一能捕捉「僅在打包後才出現的問題」的方式——尤其是誤放進 `devDependencies` 的執行期相依套件，因為只有 `dependencies` 會被打包進 `app.asar`，而一般開發模式會直接從儲存庫的 `node_modules` 解析所有套件。

打包測試會使用獨立的暫存 user-data 目錄，不會影響系統中已安裝的 Modbux 設定。

在 macOS 與 Linux 上會一併執行 socat 虛擬序列埠測試；Windows 因無 socat 而會自動略過。

**執行硬體 E2E 測試：**

```bash
yarn test:e2e:hardware
```

此測試不包含在一般測試流程中。它會透過序列埠與燒錄了 `tools/arduino/iem3000.ino` 的 Arduino 通訊，並自動依 USB Vendor ID 尋找開發板，無須人工指定；若未連接開發板則會自動略過。

### 建置安裝包

**建立目前平台的可發布安裝包：**

```bash
# Windows
yarn build:win

# macOS
yarn build:mac

# Linux
yarn build:linux
```

> **Linux 注意事項：**
>
> 預設的 Modbus 連接埠（502）需要較高權限。Modbux 啟動時會自動偵測並提供修正選項——顯示完整指令並透過 PolicyKit 詢問密碼。若要手動設定：
>
> ```bash
> sudo sysctl net.ipv4.ip_unprivileged_port_start=502
> ```
>
> 若要在重開機後持續生效：
>
> ```bash
> echo 'net.ipv4.ip_unprivileged_port_start=502' | sudo tee /etc/sysctl.d/50-unprivileged-ports.conf
> sudo sysctl --system
> ```
>
> 序列埠屬於特定系統群組（通常為 `dialout`）。切換至 RTU 時 Modbux 也會自動從裝置讀取實際群組名稱並提供加入群組的選項。若要手動設定：
>
> ```bash
> sudo usermod -aG dialout $USER
> ```
>
> 設定完成後請登出再重新登入才會生效：登入工作階段會沿用登入時取得的群組清單，因此系統檔案雖已更新，但目前的工作階段不會立即變更。

## 參與貢獻

本 Fork 儲存庫已關閉 Issues 功能。請針對 [fengchyunbih/modbux](https://github.com/fengchyunbih/modbux) 的 `develop` 分支提出 Pull Request，相關規範請參閱 [CONTRIBUTING.md](CONTRIBUTING.md)。若為上游應用程式本身的錯誤，請回報至 [ploxc/modbux](https://github.com/ploxc/modbux/issues)。

## 授權條款

本專案採用 MIT 授權條款，詳情請參閱 [LICENSE](LICENSE) 檔案。

## 第三方軟體

本軟體採用寬鬆授權條款（MIT、ISC、Apache-2.0、BSD）的開源套件。所有第三方授權條款皆隨附於發布的應用程式中。
