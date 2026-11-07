# P3-R checks
Label: **MOCK BROWSER TEST — static prototype (file://, sample data)**. Chromium via Playwright 1.61. Not REAL BROWSER against the product; not E2E.

## 1. Keyboard
- Finance tabs: ArrowRight -> hash=#/finance/reconciliation, focus=tab-finance-reconciliation
- Finance tabs: ArrowRight -> hash=#/finance/transactions, focus=tab-finance-transactions
- Finance tabs: ArrowRight -> hash=#/finance/withdrawals, focus=tab-finance-withdrawals
- Finance tabs: ArrowRight -> hash=#/finance, focus=tab-finance
- Finance tabs: ArrowLeft -> hash=#/finance/withdrawals, focus=tab-finance-withdrawals
- Finance tabs: End -> hash=#/finance/withdrawals, focus=tab-finance-withdrawals
- Finance tabs: Home -> hash=#/finance, focus=tab-finance
- Arrow/Home/End on Finance tabs: PASS (6 key presses, 4 ArrowRight wrap-around + ArrowLeft + End; Home also verified above with hash + focus moving together)
- Drawer: 40 Tab + 20 Shift+Tab presses, focus outside drawer 0 times (PASS, trapped)
- Drawer Esc: hash=#/finance/transactions, drawer open=false, focus returns to opener row=PASS
- Dialog (mark paid): 24 Tab + 12 Shift+Tab, focus outside dialog 0 times (PASS, trapped)
- Dialog Esc: dialog open=false, focus on opener=PASS
- Mobile menu (390): 40 Tab, focus outside sidebar 0 times (PASS)
- Mobile menu Esc: focus on hamburger=PASS

## 2. Reduced motion (emulateMedia reducedMotion=reduce)
- matchMedia reduce=true; 60 ms after opening the drawer: class on=true, visibility=visible, computed transform=none, transition-duration=1e-06s, running animations=0 -> PASS (no residual transform movement, state unchanged)
- After Esc: drawer open=false (expected false) -> PASS

## 3. Horizontal overflow at 390 px (document scrollWidth - innerWidth)
- overview: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- finance: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- recon-books: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- recon-exceptions: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- recon-gateway: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- transactions: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- withdrawals: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- withdrawals-approved: scrollWidth 390 / body 390 / viewport 390 -> overflow 0 px PASS
- drawer-normal: page overflow 0 px, drawer overflow 0 px -> PASS
- drawer-mismatch: page overflow 0 px, drawer overflow 0 px -> PASS
- Total: 10 routes/drawers checked, 0 with overflow.

## 4. No "0 ₫" under loading / 500 / 403 (regex `(?<![\d.,])0 ₫` on #main + drawer text)
- overview -> loading:none, error:none, forbidden:none
- finance -> loading:none, error:none, forbidden:none
- recon-books -> loading:none, error:none, forbidden:none
- recon-exceptions -> loading:none, error:none, forbidden:none
- recon-gateway -> loading:none, error:none, forbidden:none
- transactions -> loading:none, error:none, forbidden:none
- withdrawals -> loading:none, error:none, forbidden:none
- withdrawals-approved -> loading:none, error:none, forbidden:none
- drawer loading: none
- drawer error: none
- drawer forbidden: none
- Total: 27 state/route combinations, "0 ₫" found in 0.

## 5. Six scenarios on every screen (no page error, #main non-empty, scenario-specific marker)
- overview -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- finance -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- recon-books -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- recon-exceptions -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- recon-gateway -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- transactions -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- withdrawals -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- withdrawals-approved -> normal:ok, loading:ok, error:ok, forbidden:ok, stale:ok, drift:ok
- Total: 48 combinations, 0 failures.

## 6. Invariants (DOM)
- Yellow banner present: true; buttons labelled "Đã đối soát": 0.
- Investigation panel (FAILED mismatch): next-step link=true, "không ghi sổ" statement=true, L3 BLOCKED label=true, DESIGN EXPLORATION label=true.
- Withdrawals APPROVED shows "Đã duyệt ≠ đã chuyển": true.
- 409 drift = shown as drift (not load error): see section 5 drift marker on overview/finance/recon-books; HTTP 409 callout in recon-books drift (CODE AUDIT of app.js tabBooks).
- No count-up: CODE AUDIT — requestAnimationFrame occurrences in app.js = 0 (none drive number tweening; only chart/layout is drawn once).

## 7. axe-core 4.10.2 (cdnjs, addScriptTag) — serious + critical violations
- 1440 px light: total serious+critical nodes = 0
  - overview: 0 rule(s), 0 node(s)
  - finance: 0 rule(s), 0 node(s)
  - recon-books: 0 rule(s), 0 node(s)
  - recon-exceptions: 0 rule(s), 0 node(s)
  - recon-gateway: 0 rule(s), 0 node(s)
  - transactions: 0 rule(s), 0 node(s)
  - withdrawals: 0 rule(s), 0 node(s)
  - withdrawals-approved: 0 rule(s), 0 node(s)
  - drawer-normal: 0 rule(s), 0 node(s)
  - drawer-mismatch: 0 rule(s), 0 node(s)
  - dialog-markpaid: 0 rule(s), 0 node(s)
- 1440 px dark: total serious+critical nodes = 0
  - overview: 0 rule(s), 0 node(s)
  - finance: 0 rule(s), 0 node(s)
  - recon-books: 0 rule(s), 0 node(s)
  - recon-exceptions: 0 rule(s), 0 node(s)
  - recon-gateway: 0 rule(s), 0 node(s)
  - transactions: 0 rule(s), 0 node(s)
  - withdrawals: 0 rule(s), 0 node(s)
  - withdrawals-approved: 0 rule(s), 0 node(s)
  - drawer-normal: 0 rule(s), 0 node(s)
  - drawer-mismatch: 0 rule(s), 0 node(s)
  - dialog-markpaid: 0 rule(s), 0 node(s)
- 390 px light: total serious+critical nodes = 0
  - overview: 0 rule(s), 0 node(s)
  - finance: 0 rule(s), 0 node(s)
  - recon-books: 0 rule(s), 0 node(s)
  - recon-exceptions: 0 rule(s), 0 node(s)
  - recon-gateway: 0 rule(s), 0 node(s)
  - transactions: 0 rule(s), 0 node(s)
  - withdrawals: 0 rule(s), 0 node(s)
  - withdrawals-approved: 0 rule(s), 0 node(s)
  - drawer-normal: 0 rule(s), 0 node(s)
  - drawer-mismatch: 0 rule(s), 0 node(s)
  - dialog-markpaid: 0 rule(s), 0 node(s)


## Round 2 (after coordinator review) — MOCK BROWSER TEST — static prototype (file://, sample data)
Changes: prescriptive remediation text removed (factual "Điều đã xảy ra" + "Nguyên nhân có thể (chỉ là khả năng)" + "Xử lý: chưa có quy trình … (G-15)"), "Khớp" marked derived display state, mismatch journey steps now warning/fail (no green tick), KPI captions shortened, sidebar group "XỬ LÝ VỤ VIỆC" (tooltip Case Management).
- Gateway investigation text: contains "Xử lý: chưa có quy trình" = true; contains "Cần làm gì"/"hoàn phần chênh"/"liên hệ khách" = false; legend marks Khớp as "suy ra hiển thị (derived display state)" = true
- Mismatch journey step states: done:Tạo thanh toán | done:Chuyển sang cổng thanh toán | warn:Cổng gửi callback · số tiền khác Gymini | fail:Trạng thái trong Gymini: Thất bại | na:Ghi sổ: tiền vào giữ hộ và chia ba ngăn chờ | na:Giải phóng theo buổi | na:Kết thúc hoặc hoàn tiền | na:Rút tiền
- Drawer (mismatch) forbidden phrases present = false; green "done" step labelled for gateway/status = 0
- Overview tile caption line counts (tiles 1-4): 2, 2, 2, 2; sidebar group labels: TÀI CHÍNH h=20 ; ĐỐI TÁC & NGƯỜI DÙNG h=20 ; XỬ LÝ VỤ VIỆC [title=Case Management] h=20 ; HỆ THỐNG h=20
- axe 4.10.2 serious+critical at 1440 px light: total 0 [overview=0; recon-gateway=0; drawer-mismatch=0; drawer-normal=0; finance=0]
- axe 4.10.2 serious+critical at 390 px light: total 0 [overview=0; recon-gateway=0; drawer-mismatch=0; drawer-normal=0; finance=0]
- Overflow at 390 px (px): overview=0, recon-gateway=0, drawer-mismatch=0, drawer-normal=0, finance=0 -> 0 screens with overflow
- No "0 ₫" under loading/500/403: 15 combinations, 0 hits
