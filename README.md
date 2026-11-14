# Modbux

[English](./README.en.md) | 正體中文

> 本專案分支自 [ploxc](https://github.com/ploxc) 開發的 [ploxc/modbux](https://github.com/ploxc/modbux)，新增了 MCP 伺服器，讓 AI 代理程式可直接操控 Client 與 Server。

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
   means Modbux is not running or MCP is not enabled.
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

**Modbux 是我四年前迫切需要的工具。** 它在單一應用程式中支援 Modbus TCP、RTU 與 RTU over TCP，可為暫存器指定資料型別、掃描位址與資料、模擬測試用伺服器，並讓你真正看懂所讀到的數值。

## 下載

**[下載最新版本](https://github.com/fengchyunbih/modbux/releases/latest)**

提供 Windows 安裝檔、macOS（Apple silicon 與 Intel）安裝映像檔，以及 Linux 的 `.deb` 與 `.AppImage`（x64 與 arm64）。

**[閱讀使用手冊](docs/manual/README.md)**、**[閱讀 MCP 說明文件](docs/mcp.md)**，以及其餘功能的[上游說明文件](https://ploxc.com/modbux/docs/latest/getting-started)。

## 功能特色

**Client 模式：**

- 讀寫所有常見資料型別：int16/32/64、uint16/32/64、float、double、bitmap、時間戳記（`UNIX` 與 IEC 870-5 `DATETIME`）與 UTF-8 字串
- Bitmap 明細面板：可展開檢視 16 個位元，支援逐位元切換、燈號顏色設定、反相（Invert）與行內註解
- Advanced mode（進階模式）：同時顯示所有數值資料型別的解碼結果
- `Read configuration` 模式：僅讀取已設定的暫存器，自動合併分組、顯示群組索引欄位（`G`）與行內錯誤訊息
- 掃描 Unit ID 與暫存器位址範圍，並在掃描進行時即時填入表格
- 區分「回傳例外碼的 Unit」與「無回應的 Unit」：前者代表總線上有設備但拒絕該請求，後者代表總線上沒有該設備
- 四種位元組與字組順序（`ABCD`、`CDAB`、`BADC`、`DCBA` — 支援交換暫存器順序與交換暫存器內位元組）
- 縮放係數（Scaling factor）與線性內插（Linear interpolation）
- 支援 Modbus TCP（主機名稱或 IP）與 RTU，並自動偵測 COM 序列埠
- 支援 RTU over TCP，適用於傳送封裝 RTU 封包的序列轉乙太網路閘道器
- 通訊紀錄（Transaction log，最多保留 1,000 筆原始十六進位封包、延遲時間，並支援匯出 CSV）
- 復原與重做（Undo / Redo，最多 100 步）
- 設定檔儲存與載入（JSON）

**Server 模式：**

- 支援 Modbus TCP 與 RTU 伺服器模式（實體序列埠、USB 轉接器、socat 虛擬序列埠對）
- 同時模擬最多 10 台 Modbus TCP 伺服器（各自使用不同連接埠）
- 每台伺服器皆支援協定允許的完整 Unit ID 範圍（0–255）
- 支援與 Client 相同的資料型別：數值暫存器、bitmap、UTF-8 字串、Unix 時間戳記與 IEC 870-5 datetime
- 固定數值或可設定更新間隔的隨機數值產生器（Generator）
- 輸出系統目前時間的 Unix / datetime 時間產生器
- 附帶 UTC 切換開關的 DateTimePicker，可設定精確時間戳記
- 重新設計的布林點位介面：逐位址列顯示切換圓鈕、行內註解與游標懸停刪除按鈕
- 故障注入規則（Fault rules，每台伺服器最多 32 條規則：模擬回傳 Modbus 例外碼、`no_response` 或回應延遲 `delay`，支援 `everyNth` 與 `forSeconds` 條件）
- 設定檔儲存與載入，以及完整專案檔儲存與載入（`Save project` / `Open project`，JSON）
- 啟動即自動開始監聽

**Split Mode（並排模式）：**

- 在兩個獨立視窗中同時執行 Client 與 Server
- Server 在第二個視窗開啟，主視窗則切換為 Client
- 透過 `127.0.0.1` 連線至本機模擬伺服器進行測試
- 適合實際演練 Modbus 或同時開發通訊兩端的程式

**MCP 伺服器：**

- 內建 Model Context Protocol (MCP) 伺服器，監聽 `http://127.0.0.1:15502/mcp`（Streamable HTTP + Bearer token）並提供 `stdio` 轉接器（`out/main/mcpStdio.js`）
- 提供 21 項工具、7 項資源與 4 組提示詞範本，讓 AI 代理程式操控 Client 與 Server
- 具備寫入保護開關（Settings 中的 `Allow writes to devices` 開關）

**狀態自動保存（State Persistence）：**

- 所有畫面狀態與設定會在關閉與重啟之間自動保存

## 工具比較

市面上的 Modbus 工具不少，其中幾款在各自領域表現不俗。問題在於每套工具往往只做其中一件事，而且好用的多半是付費且僅支援 Windows：Client 一套、Server 一套、掃描器又是另一套。我過去好幾年都得在這些視窗之間來回切換。

Modbux 免費開源，支援 Windows、macOS 與 Linux，並將 Client 與 Server 整合在同一個應用程式裡，讓你直接連向 `127.0.0.1` 測試，手邊不需要任何硬體。我開發它最核心的理由是資料解讀能力：對同一批暫存器同時套用所有資料型別、隨時切換位元組順序、套用縮放換算，以及不僅找出哪個 Unit ID 有回應、更能直接找出資料位址落在哪裡的掃描器。

若想逐一比較各款工具，請參閱上游網站的[工具比較頁面](https://ploxc.com/modbux/alternatives)。

## 介面預覽

![Modbux Client UI](./resources/modbux-client.png)

## 為什麼會有這套工具

四年前，我在完全沒有 Modbus 經驗的情況下被派去執行汽電共生廠（CHP）的試車。客戶不知道點位位址，我也不懂通訊協定。手邊只有一套掃描出「某些東西」的掃描器，以及一個顯示十六進位數值卻無法幫我解讀意義的讀取工具。

_溫度到底在暫存器 100 還是 101？說明書是從 0 還是從 1 開始算？為什麼手冊寫 Holding Register 0，TIA Portal 卻叫它 40000？它是 big-endian 還是 little-endian？是 Input Registers 還是 Holding Registers？我到底該用哪個 Function Code？_

而且現場還是 Modbus RTU，所以清單上還得加上「終端電阻裝對了嗎？」與「接線真的沒接反嗎？」。因為只要其中一項不對，就完全讀不到任何東西，只能盲目除錯。

**這種情況持續了四年。**

後來我逐漸摸透了，但卻看著同事們一個接一個撞上同樣的牆。我們最後當然還是能完成任務，但代價是無數心血與太多趟現場出差。手邊的工具運氣好時能讀出一個 float 或 int，卻從來無法呈現全貌。位元組順序不對？自己交換暫存器碰運氣吧。說明書位址偏移寫錯？祝你好運找到資料真正存放的位置。

到了 Modbus TCP，至少實體層不再處處與你作對。我用 [modbus-serial](https://www.npmjs.com/package/modbus-serial)（感謝 [yaacov](https://github.com/yaacov)！）為自家的太陽能板寫了一套 TypeScript 程式，事情才開始豁然開朗。一旦理解之後，這套通訊協定本身其實非常直觀。

接著又是一場試車。更多問題、更多挫折。我終於受不了了。

**「我受夠了。」**

我決定徹底鑽研這套協定，把每個細節弄懂，然後發現：我手邊已經有所有需要的拼圖了。我知道它怎麼運作，我可以親手做出這幾年來一直希望存在的工具。

於是我動手做了。

我做出了一套能同時顯示所有可能資料型別解讀結果的工具；一套不只掃描設備、更能直接掃描出「實際資料位址在哪裡」的工具（因為我曾花了好幾個小時才發現第三方說明書寫錯了暫存器範圍）；一套能讓你去現場之前，先在辦公室用模擬設備驗證 PLC 程式的工具。

我現在每天都在用它。寫好 Modbus 程式卻只能「祈禱」去到現場連上設備會動？我再也不用那種方式工作了。

**如果你曾經與 Modbus 苦戰過，你就會明白為什麼需要這套工具。**

以 Electron、React 與 Material-UI 打造。之所以開源，是因為這個產業需要更好的工具。

### 免費，且維持免費

無須註冊帳號、無試用期限制、無付費版本。

## 為什麼叫「Modbux」？

這是我自己常打錯的字——把 _modbus_ 打成 _modbux_。但這個名字剛好契合：它代表你在操作 Modbus 時的使用者體驗（UX）。這個打字錯誤就成了品牌名稱。

## 實用技巧：讓 AI 處理繁瑣設定

儲存的設定檔皆為 JSON 格式。給 Claude 或 ChatGPT 看幾個暫存器範例、貼上設備說明書的點位表，請它補齊完整對應表，再載入回 Modbux 即可完成。歡迎來到 2026 年。

## 安裝說明

### Windows

從 [releases](https://github.com/fengchyunbih/modbux/releases) 下載 `.exe` 安裝檔。

⚠️ **SmartScreen 警告**：點擊「其他資訊」（More info）→「仍要執行」（Run anyway）

### macOS

從 [releases](https://github.com/fengchyunbih/modbux/releases) 下載 `.dmg` 檔案。Apple silicon 請選擇 `arm64`，Intel 請選擇 `x64`。

**需 macOS 12 以上版本。** Modbux 2.3 升級至 Electron 41，不再支援 Catalina 或 Big Sur。Modbux 2.2.1 仍支援舊版系統，並保留於[上游 releases 頁面](https://github.com/ploxc/modbux/releases)。

⚠️ **首次開啟**：對應用程式按右鍵並選擇「打開」（Open），或至「系統設定 → 隱私權與安全性 → 強制打開」（Open Anyway）。

### Linux

從 [releases](https://github.com/fengchyunbih/modbux/releases) 下載 `.deb` 或 `.AppImage`（支援 x64 與 arm64）。亦可從原始碼建置，請參閱[自行建置](#自行建置)。

在 Linux 上有兩項功能需要應用程式無法自行取得的系統權限，Modbux 會主動彈出提示詢問，而非無聲失敗：

- **連接埠 502** 預設保留給 root 使用，因此伺服器會改在其他連接埠啟動。開啟 Server 畫面時會詢問是否下調特權連接埠門檻（可選擇生效至下次重開機或永久生效）。
- **序列埠**屬於特定系統群組（通常為 `dialout`），不在群組內的使用者無法開啟序列埠。由於序列埠仍會出現在清單中，在連線被拒前表面上看不到異狀。切換至 RTU 時會詢問是否將你的帳號加入群組，並在完成後提供登出選項（因為登入工作階段會維持登入當下的群組權限）。

兩項功能在執行前都會顯示完整指令，並透過 PolicyKit 詢問密碼，Modbux 本身不會接觸你的密碼。若在 Flatpak 或 Snap 沙盒中執行，則會改為顯示指令供你自行貼上執行。若想手動執行，指令亦列於下方[自行建置](#自行建置)章節。

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

**執行當前平台支援的所有測試：**

```bash
yarn test:all:mac
yarn test:all:windows
yarn test:all:linux
```

包含 lint、型別檢查、單元測試、兩種 E2E 模式、畫面截圖與掃描效能測試，以及該平台專屬測試：macOS 與 Linux 的硬體測試，以及 Linux 的連接埠 502 對話框測試（唯一需要人工互動的步驟）。推送程式碼前可執行較快速的 `yarn verify`：包含 lint、型別檢查、單元測試與 E2E 測試。

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

**建立當前平台的可發佈安裝包：**

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
> 設定完成後請登出再重新登入才會生效：登入工作階段會沿用登入時取得的群組清單，因此系統檔案雖已更新，但當前工作階段不會立即變更。

## 參與貢獻

本分支儲存庫已關閉 Issues 功能。請針對 [fengchyunbih/modbux](https://github.com/fengchyunbih/modbux) 的 `develop` 分支發起 Pull Request，規範請參閱 [CONTRIBUTING.md](CONTRIBUTING.md)。若為上游應用程式本身的錯誤，請回報至 [ploxc/modbux](https://github.com/ploxc/modbux/issues)。

## 授權條款

本專案採用 MIT 授權條款，詳情請參閱 [LICENSE](LICENSE) 檔案。

## 第三方軟體

本軟體使用具備寬鬆授權條款（MIT、ISC、Apache-2.0、BSD）的開源套件。所有第三方授權條款皆隨附於發佈的應用程式中。
