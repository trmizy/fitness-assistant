/* Gymini Admin prototype — DỮ LIỆU MẪU (không phải dữ liệu thật). Mọi số tiền là số nguyên đồng (VND). */
(function () {
  'use strict';

  // ---------- PRNG xác định ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = rng(20261026);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(R() * 16).toString(16); return s; };
  const uuid = () => hex(8) + '-' + hex(4) + '-4' + hex(3) + '-8' + hex(3) + '-' + hex(12);

  // Thời điểm "bây giờ" của prototype: 26/10/2026 14:32:08 giờ Việt Nam (UTC+7)
  const NOW = Date.UTC(2026, 9, 26, 7, 32, 8);
  const MIN = 60000;

  // ---------- Bản đồ tiền đang giữ (P3 breakdown) ----------
  const BREAKDOWN = {
    clientBalances: 184250000,
    ptPending: 96400000, ptAvailable: 41300000, ptLocked: 12500000,
    gymPending: 128700000, gymAvailable: 57900000, gymLocked: 8000000,
    platformPending: 34600000, platformAvailable: 27150000
  };
  // party: ai đang có quyền đòi · comp: ngăn · token: màu tiền
  const CLAIM_ROWS = [
    { key: 'clientBalances', label: 'Khách hàng — số dư ví', party: 'Khách', comp: 'Ví', token: 'held' },
    { key: 'ptPending', label: 'PT — đang chờ giải phóng', party: 'PT', comp: 'Chờ', token: 'pending' },
    { key: 'ptAvailable', label: 'PT — khả dụng', party: 'PT', comp: 'Khả dụng', token: 'available' },
    { key: 'ptLocked', label: 'PT — đã khoá chờ chi', party: 'PT', comp: 'Đã khoá', token: 'locked' },
    { key: 'gymPending', label: 'Phòng gym — đang chờ giải phóng', party: 'Phòng gym', comp: 'Chờ', token: 'pending' },
    { key: 'gymAvailable', label: 'Phòng gym — khả dụng', party: 'Phòng gym', comp: 'Khả dụng', token: 'available' },
    { key: 'gymLocked', label: 'Phòng gym — đã khoá chờ chi', party: 'Phòng gym', comp: 'Đã khoá', token: 'locked' },
    { key: 'platformPending', label: 'Nền tảng — doanh thu chờ', party: 'Nền tảng', comp: 'Chờ', token: 'pending' },
    { key: 'platformAvailable', label: 'Nền tảng — doanh thu đã hưởng', party: 'Nền tảng', comp: 'Khả dụng', token: 'revenue' }
  ];
  const claimsTotal = CLAIM_ROWS.reduce((s, r) => s + BREAKDOWN[r.key], 0);
  // Bình thường: escrow ĐƯỢC SUY RA từ claims (không gõ tay hai số)
  const RECON_NORMAL = { escrow: claimsTotal, claims: claimsTotal, drift: 0, balanced: true };
  // Lệch sổ: tiền giữ hộ thấp hơn quyền đòi 1.250.000 ₫ (do 1 ví PT âm)
  const DRIFT_AMOUNT = 1250000;
  const RECON_DRIFT = { escrow: claimsTotal - DRIFT_AMOUNT, claims: claimsTotal, drift: -DRIFT_AMOUNT, balanced: false };

  // ---------- Người ----------
  const CUSTOMERS = ['Nguyễn Văn Hùng', 'Trần Thị Mai Anh', 'Lê Hoàng Nam', 'Phạm Quỳnh Chi', 'Võ Minh Khôi', 'Đặng Thu Hà', 'Bùi Anh Tuấn', 'Hoàng Thị Lan', 'Đỗ Quang Huy', 'Ngô Bảo Châu', 'Dương Thanh Tâm', 'Lý Gia Bảo', 'Phan Khánh Linh', 'Vũ Đức Thịnh', 'Huỳnh Ngọc Trâm', 'Trương Minh Quân', 'Mai Phương Thảo', 'Cao Hữu Phước'];
  const PTS = ['Trần Quốc Việt', 'Lê Thị Thanh Hằng', 'Nguyễn Đình Khang', 'Phạm Hải Yến', 'Võ Thành Đạt'];
  const GYMS = ['Phoenix Gym Bình Thạnh', 'Titan Fitness Quận 7', 'Zenith Gym Thủ Đức', 'Olympia Club Gò Vấp'];

  // ---------- Giao dịch ----------
  const PURPOSE = {
    PT_CONTRACT: 'Hợp đồng PT', GYM_MEMBERSHIP: 'Hội viên phòng gym',
    WALLET_TOPUP: 'Nạp ví', PERSONALIZED_SERVICE_PURCHASE: 'Dịch vụ cá nhân hoá'
  };
  const PROVIDER = { VNPAY: 'VNPay', ZALOPAY: 'ZaloPay', PAYOS: 'PayOS' };
  const STATUS = {
    PAID: 'Đã thanh toán', PENDING: 'Chờ thanh toán', FAILED: 'Thất bại',
    REFUNDED: 'Đã hoàn về ví', CANCELLED: 'Đã huỷ'
  };

  const txs = [];
  function mk(o) {
    const id = o.id || uuid();
    const t = Object.assign({
      id, code: (o.prefix || 'TX') + '-' + id.slice(0, 6).toUpperCase(),
      status: 'PAID', provider: 'VNPAY', purpose: 'PT_CONTRACT', variant: 'generic', flags: {}
    }, o);
    t.id = id;
    t.code = o.code || ((o.prefix || 'TX') + '-' + id.slice(0, 6).toUpperCase());
    t.at = NOW - (o.agoMin || 0) * MIN;
    txs.push(t);
    return t;
  }
  // Sáu giao dịch tay cho các biến thể hành trình tiền
  mk({ id: '9b1f6c52-3d0e-4a77-8e15-c2a4f0b7d913', code: 'PT-9B1F6C', variant: 'pt_normal', agoMin: 38, provider: 'VNPAY', purpose: 'PT_CONTRACT', amount: 3600000, payer: 'Nguyễn Văn Hùng', related: 'Hợp đồng PT-2026-0412 · PT Trần Quốc Việt', gym: 'Phoenix Gym Bình Thạnh', pt: 'Trần Quốc Việt', sessions: [12, 3], rates: [80, 10, 10], gwId: 'GYM2610269B1F6C' });
  mk({ id: '4e7a20d1-86b3-4c19-9a52-7d13fe08b6a4', code: 'PT-4E7A20', variant: 'pt_terminated', status: 'REFUNDED', agoMin: 1190, provider: 'VNPAY', purpose: 'PT_CONTRACT', amount: 4800000, payer: 'Trần Thị Mai Anh', related: 'Hợp đồng PT-2026-0377 · PT Lê Thị Thanh Hằng', gym: 'Titan Fitness Quận 7', pt: 'Lê Thị Thanh Hằng', sessions: [16, 5], rates: [80, 10, 10], gwId: 'GYM26102545E7A20' });
  mk({ id: 'c3d85f29-14aa-4d6e-b0f7-91e2a6c4d058', code: 'MB-C3D85F', variant: 'membership', agoMin: 95, provider: 'ZALOPAY', purpose: 'GYM_MEMBERSHIP', amount: 1800000, payer: 'Lê Hoàng Nam', related: 'Gói 3 tháng · Zenith Gym Thủ Đức', gym: 'Zenith Gym Thủ Đức', rates: [0, 90, 10], gwId: '261026_c3d85f' });
  mk({ id: '71a0b9ce-52d4-4f83-a6e1-3c8d70f2b195', code: 'PT-71A0B9', variant: 'mismatch', status: 'FAILED', agoMin: 210, provider: 'VNPAY', purpose: 'PT_CONTRACT', amount: 2000000, gwAmount: 2500000, payer: 'Phạm Quỳnh Chi', related: 'Hợp đồng PT-2026-0419 · PT Nguyễn Đình Khang', gym: 'Phoenix Gym Bình Thạnh', pt: 'Nguyễn Đình Khang', sessions: [8, 0], rates: [80, 10, 10], gwId: 'GYM26102671A0B9', flags: { mismatch: true } });
  mk({ id: 'e5f12a74-9c60-4b38-8d07-a4b6c13e7f20', code: 'PL-E5F12A', variant: 'pending', status: 'PENDING', agoMin: 7, provider: 'PAYOS', purpose: 'PERSONALIZED_SERVICE_PURCHASE', amount: 299000, payer: 'Võ Minh Khôi', related: 'Dịch vụ “Giáo án tăng cơ 12 tuần” · PT Phạm Hải Yến', pt: 'Phạm Hải Yến', rates: [85, 0, 15], gwId: '2610260071' });
  mk({ id: '28d6e3b0-a1f7-4e52-b9c4-5f07d82a1e63', code: 'MB-28D6E3', variant: 'activation_failed', agoMin: 160, provider: 'ZALOPAY', purpose: 'GYM_MEMBERSHIP', amount: 2400000, payer: 'Đặng Thu Hà', related: 'Gói 6 tháng · Olympia Club Gò Vấp', gym: 'Olympia Club Gò Vấp', rates: [0, 90, 10], gwId: '261026_28d6e3', flags: { activationFailed: true } });

  const purposeCycle = ['PT_CONTRACT', 'GYM_MEMBERSHIP', 'GYM_MEMBERSHIP', 'WALLET_TOPUP', 'PERSONALIZED_SERVICE_PURCHASE', 'PT_CONTRACT'];
  const provCycle = ['VNPAY', 'ZALOPAY', 'PAYOS', 'VNPAY', 'ZALOPAY', 'PAYOS', 'VNPAY'];
  const prefixOf = { PT_CONTRACT: 'PT', GYM_MEMBERSHIP: 'MB', WALLET_TOPUP: 'WT', PERSONALIZED_SERVICE_PURCHASE: 'PL' };
  const amountsOf = {
    PT_CONTRACT: [2400000, 3000000, 3600000, 4800000, 6000000, 7200000, 9600000],
    GYM_MEMBERSHIP: [600000, 900000, 1200000, 1800000, 2400000, 3600000, 4800000],
    WALLET_TOPUP: [200000, 500000, 1000000, 2000000],
    PERSONALIZED_SERVICE_PURCHASE: [99000, 199000, 299000, 399000, 599000]
  };
  let ago = 260;
  for (let i = 0; i < 34; i++) {
    ago += Math.floor(40 + R() * 1200);
    const purpose = purposeCycle[i % purposeCycle.length];
    const roll = R();
    const status = roll < 0.72 ? 'PAID' : roll < 0.82 ? 'PENDING' : roll < 0.9 ? 'FAILED' : roll < 0.95 ? 'REFUNDED' : 'CANCELLED';
    const payer = CUSTOMERS[i % CUSTOMERS.length];
    const amount = pick(amountsOf[purpose]);
    const pt = pick(PTS), gym = pick(GYMS);
    const rel = purpose === 'PT_CONTRACT' ? 'Hợp đồng PT-2026-0' + (300 + Math.floor(R() * 120)) + ' · PT ' + pt
      : purpose === 'GYM_MEMBERSHIP' ? 'Gói hội viên · ' + gym
        : purpose === 'WALLET_TOPUP' ? 'Nạp vào ví Gymini' : 'Dịch vụ cá nhân hoá · PT ' + pt;
    const provider = purpose === 'WALLET_TOPUP' ? pick(['VNPAY', 'ZALOPAY']) : provCycle[(i + 2) % provCycle.length];
    mk({
      prefix: prefixOf[purpose], agoMin: ago, status, purpose, provider, amount, payer, related: rel, pt, gym,
      sessions: purpose === 'PT_CONTRACT' ? [pick([8, 12, 16]), Math.floor(R() * 6)] : null,
      rates: purpose === 'PT_CONTRACT' ? [80, 10, 10] : purpose === 'GYM_MEMBERSHIP' ? [0, 90, 10] : purpose === 'PERSONALIZED_SERVICE_PURCHASE' ? [85, 0, 15] : [0, 0, 0],
      gwId: provider === 'VNPAY' ? 'GYM' + hex(10).toUpperCase() : provider === 'ZALOPAY' ? '261' + hex(3) + '_' + hex(6) : String(2610000000 + Math.floor(R() * 99999))
    });
  }
  txs.sort((a, b) => b.at - a.at);
  // Một số giao dịch đặc biệt cho tab đối chiếu cổng
  const generics = txs.filter((t) => t.variant === 'generic' && t.status === 'PAID' && t.purpose !== 'WALLET_TOPUP');
  generics[0].flags.noGatewayEvent = true;   // Gymini đã thu, chưa thấy sự kiện cổng
  generics[2].flags.noLedger = true;        // PAID nhưng thiếu bút toán (bất thường thật)
  generics[1].flags.duplicateEvent = true;   // cổng gửi trùng
  txs.forEach((t) => { if (t.status === 'PENDING' && t.variant === 'generic') t.flags.waitingGateway = true; });

  // ---------- Sự kiện cổng thanh toán (webhook/truy vấn) ----------
  const events = [];
  function ev(t, extra) {
    const e = Object.assign({
      id: 'ev_' + hex(10), provider: t ? t.provider : 'VNPAY', gwId: t ? t.gwId : '', gwAmount: t ? (t.gwAmount || t.amount) : 0,
      at: t ? t.at + 20000 : NOW - 300 * MIN, gwStatus: 'Thành công', txId: t ? t.id : null, attempts: 1, processedAt: t ? t.at + 21500 : null
    }, extra || {});
    events.push(e); return e;
  }
  const gwTx = txs.filter((t) => t.status === 'PAID' && t.variant !== 'pt_terminated' && !t.flags.noGatewayEvent && t.purpose !== 'WALLET_TOPUP').slice(0, 6);
  txs.filter((t) => t.id === '71a0b9ce-52d4-4f83-a6e1-3c8d70f2b195' || t.id === '28d6e3b0-a1f7-4e52-b9c4-5f07d82a1e63').forEach((t) => gwTx.push(t));
  const gwSet = Array.from(new Set(gwTx.concat([generics[1]])));
  gwSet.forEach((t) => {
    if (t.flags.mismatch) ev(t, { attempts: 3, processedAt: t.at + 21500 });
    else if (t.flags.duplicateEvent) { ev(t, { attempts: 2 }); ev(t, { at: t.at + 95000, attempts: 1, processedAt: t.at + 96000 }); }
    else ev(t, { attempts: t.id === '28d6e3b0-a1f7-4e52-b9c4-5f07d82a1e63' ? 4 : 1 });
  });
  // pt_terminated vẫn có sự kiện cổng khớp
  ev(txs.find((t) => t.variant === 'pt_terminated'));
  // Cổng có, Gymini không tìm thấy
  ev(null, { provider: 'PAYOS', gwId: '2610259944', gwAmount: 1500000, at: NOW - 410 * MIN, attempts: 5, processedAt: null });
  ev(null, { provider: 'ZALOPAY', gwId: '261025_7ac19e', gwAmount: 900000, at: NOW - 655 * MIN, attempts: 2, processedAt: null });
  // Giao dịch đang chờ cổng
  const pendTx = txs.filter((t) => t.status === 'PENDING' && t.variant !== 'mismatch').slice(0, 2);
  pendTx.forEach((t) => ev(t, { gwStatus: 'Đang xử lý', processedAt: null, attempts: 0 }));
  events.sort((a, b) => b.at - a.at);

  // Dòng "Trong Gymini" của tab đối chiếu
  const gymRowIds = new Set();
  events.forEach((e) => { if (e.txId) gymRowIds.add(e.txId); });
  txs.filter((t) => t.flags.noGatewayEvent).forEach((t) => gymRowIds.add(t.id));
  const gymRows = txs.filter((t) => gymRowIds.has(t.id));

  function evCount(txId) { return events.filter((e) => e.txId === txId).length; }
  function ledgerTotal(t) {
    if (t.status === 'PAID' || t.status === 'REFUNDED') return t.amount; // tiền vào giữ hộ
    return null; // chưa ghi — hiển thị "—", không phải 0
  }
  function eventState(e) {
    if (!e.txId) return 'gw_only';
    const t = txs.find((x) => x.id === e.txId);
    if (evCount(e.txId) > 1) return 'duplicate';
    if (e.gwAmount !== t.amount) return 'amount';
    if (t.status === 'PENDING') return 'pending';
    return 'match';
  }
  function txState(t) {
    const es = events.filter((e) => e.txId === t.id);
    if (!es.length) return t.status === 'PENDING' ? 'pending' : 'gym_only';
    return eventState(es[0]);
  }
  const MATCH = {
    match: { label: 'Khớp', tone: 'success', derived: true, hint: 'Khoá khớp và số tiền bằng nhau' },
    amount: { label: 'Lệch số tiền', tone: 'danger', derived: false, hint: 'Có thật: metadata.gatewayDiscrepancy' },
    gw_only: { label: 'Cổng có, Gymini không thấy', tone: 'danger', derived: true, hint: 'Suy ra hiển thị: webhook có processedAt rỗng' },
    gym_only: { label: 'Gymini đã thu, chưa có sự kiện cổng', tone: 'warning', derived: true, hint: 'Suy ra hiển thị: không tìm thấy sự kiện theo mã cổng' },
    duplicate: { label: 'Cổng gửi trùng', tone: 'warning', derived: true, hint: 'Suy ra hiển thị: nhiều sự kiện cùng mã giao dịch cổng' },
    pending: { label: 'Chờ cổng xác nhận', tone: 'pending', derived: false, hint: 'Giao dịch PENDING, cổng chưa trả kết quả cuối' }
  };

  // ---------- Chi tiết giao dịch: hành trình tiền, phân chia, bút toán ----------
  function shares(t) {
    const [p, g, pl] = t.rates || [0, 0, 0];
    if (!(p + g + pl)) return null;
    const pt = Math.floor(t.amount * p / 100), gym = Math.floor(t.amount * g / 100);
    return { pt, gym, platform: t.amount - pt - gym, rates: { pt: p, gym: g, platform: pl } };
  }
  function releasedOf(t, sh) {
    if (!sh || !t.sessions || t.status !== 'PAID') return { pt: 0, gym: 0, platform: 0, done: 0, total: t.sessions ? t.sessions[0] : 0 };
    const [total, done] = t.sessions;
    const f = (x) => Math.floor(x * done / total);
    return { pt: f(sh.pt), gym: f(sh.gym), platform: f(sh.platform), done, total };
  }
  const S = { done: 'done', wait: 'wait', na: 'na', unread: 'unread', missing: 'missing', warn: 'warn', fail: 'fail' };
  function journey(t) {
    const v = t.variant, paid = t.status === 'PAID' || t.status === 'REFUNDED';
    const a = t.at;
    const steps = [];
    const add = (title, st, at, src, ref, verif, note) => steps.push({ title, st, at, src, ref, verif, note });
    add('Tạo thanh toán', S.done, a, 'GET /admin/payments · P1', t.code, 'Đã xác minh từ bản ghi giao dịch', 'Khách ' + t.payer + ' bắt đầu thanh toán ' + (PURPOSE[t.purpose] || '').toLowerCase() + '.');
    add('Chuyển sang cổng thanh toán', S.done, a + 4000, 'CẦN API MỚI · G-05', t.gwId, 'Suy ra từ bản ghi giao dịch', 'Khách được chuyển sang cổng ' + PROVIDER[t.provider] + '.');
    if (v === 'pending') {
      add('Cổng xác nhận', S.wait, null, 'CẦN API MỚI · G-05', null, 'Chưa có sự kiện từ cổng', 'Chưa nhận kết quả từ PayOS. Giao dịch giữ ở “Chờ thanh toán” cho tới khi cổng trả kết quả.');
      add('Trạng thái trong Gymini', S.wait, null, 'GET /admin/payments · P1', null, 'Đã xác minh', 'Chờ thanh toán.');
      add('Ghi sổ: tiền vào giữ hộ và chia ba ngăn chờ', S.na, null, '', null, '', 'Chưa áp dụng — tiền chưa về.');
      add('Giải phóng theo buổi', S.na, null, '', null, '', '');
      add('Kết thúc hoặc hoàn tiền', S.na, null, '', null, '', '');
      add('Rút tiền', S.na, null, '', null, '', '');
      return steps;
    }
    if (v === 'mismatch') {
      add('Cổng gửi callback · số tiền khác Gymini', S.warn, a + 20000, 'CẦN API MỚI · G-05', t.gwId, 'Có thật: metadata.gatewayDiscrepancy', 'Cổng VNPay báo đã thu ' + fmtMoney(t.gwAmount) + ', trong khi Gymini chờ ' + fmtMoney(t.amount) + '. Gửi lại 3 lần.');
      add('Trạng thái trong Gymini: Thất bại', S.fail, a + 21500, 'GET /admin/payments/gateway-discrepancies · P2', null, 'Có thật', 'Giao dịch chuyển sang Thất bại vì số tiền cổng báo khác số Gymini chờ; hợp đồng không được kích hoạt.');
      add('Ghi sổ: tiền vào giữ hộ và chia ba ngăn chờ', S.na, null, 'CẦN API MỚI · G-05', null, 'Đúng thiết kế', 'Đúng thiết kế: không ghi sổ khi lệch số tiền. Tiền ' + fmtMoney(t.gwAmount) + ' khách đã trả đang nằm ở cổng, chưa vào tiền giữ hộ — cần xử lý hoàn tại cổng (chưa có quy trình trong hệ thống, G-15).');
      add('Giải phóng theo buổi', S.na, null, '', null, '', '');
      add('Kết thúc hoặc hoàn tiền', S.na, null, '', null, '', 'Chưa có quy trình xử lý sai lệch được duyệt (G-15).');
      add('Rút tiền', S.na, null, '', null, '', '');
      return steps;
    }
    add('Cổng xác nhận', paid ? S.done : S.na, paid ? a + 20000 : null, 'CẦN API MỚI · G-05', paid ? t.gwId : null, paid ? 'Đối chiếu theo mã giao dịch cổng' : '', paid ? 'Cổng báo thành công ' + fmtMoney(t.amount) + '.' : 'Giao dịch không thành công.');
    add('Trạng thái trong Gymini', v === 'activation_failed' ? S.warn : (paid ? S.done : S.na), paid ? a + 21500 : null, 'GET /admin/payments · P1', null, 'Đã xác minh', v === 'activation_failed' ? 'Đã thu tiền nhưng kích hoạt gói hội viên thất bại. Chưa có quy trình xử lý được duyệt (G-15).' : paid ? 'Đã thanh toán.' : STATUS[t.status] + '.');
    if (!paid) { ['Ghi sổ: tiền vào giữ hộ và chia ba ngăn chờ', 'Giải phóng theo buổi', 'Kết thúc hoặc hoàn tiền', 'Rút tiền'].forEach((x) => add(x, S.na, null, '', null, '', '')); return steps; }
    const sh = shares(t);
    if (t.flags.noLedger) add('Ghi sổ: tiền vào giữ hộ và chia ba ngăn chờ', S.missing, null, 'CẦN API MỚI · G-05', null, 'Chưa xác minh', 'Giao dịch đã thanh toán nhưng không tìm thấy bút toán nào — bất thường, cần kỹ thuật kiểm tra.');
    else add('Ghi sổ: tiền vào giữ hộ và chia ba ngăn chờ', S.done, a + 22000, 'CẦN API MỚI · G-05', 'ledger_op PAY:' + t.id.slice(0, 8), 'Đã xác minh từ sổ cái',
      sh ? 'Tiền vào giữ hộ; chia ' + (sh.pt ? 'PT ' + fmtMoney(sh.pt) + ' · ' : '') + (sh.gym ? 'phòng gym ' + fmtMoney(sh.gym) + ' · ' : '') + 'nền tảng ' + fmtMoney(sh.platform) + ' vào ngăn chờ.' : 'Tiền vào ví khách.');
    const rel = releasedOf(t, sh);
    if (v === 'activation_failed') add('Giải phóng theo buổi', S.unread, null, 'user-service · buổi tập', null, 'Không đọc được dữ liệu', 'Chưa đọc được trạng thái gói hội viên từ gym-service nên không biết đã đến kỳ giải phóng chưa.');
    else if (t.sessions) add('Giải phóng theo buổi', rel.done ? S.done : S.wait, rel.done ? a + 3 * 86400000 : null, 'CẦN API MỚI · G-05', rel.done + '/' + rel.total + ' buổi', 'Đã xác minh từ sổ cái', rel.done + ' trên ' + rel.total + ' buổi đã hoàn thành — đã chuyển ' + fmtMoney(rel.pt + rel.gym + rel.platform) + ' từ ngăn chờ sang khả dụng.');
    else add('Giải phóng theo buổi', S.na, null, '', null, '', 'Gói này không giải phóng theo buổi.');
    if (v === 'pt_terminated') {
      add('Kết thúc hoặc hoàn tiền', S.done, a + 6 * 86400000, 'CẦN API MỚI · G-05', 'refund REF-' + t.id.slice(0, 6), 'Đã xác minh từ sổ cái', 'PT chấm dứt hợp đồng. Hoàn ' + fmtMoney(Math.round(t.amount * 0.6875 / 1000) * 1000) + ' về ví khách cho phần chưa tập; phần còn lại được chia theo các buổi đã tập.');
      add('Rút tiền', S.wait, null, 'CẦN API MỚI · G-08', null, 'Chưa có yêu cầu', 'Khách chưa rút khoản hoàn khỏi ví.');
    } else {
      add('Kết thúc hoặc hoàn tiền', S.wait, null, '', null, '', t.sessions ? 'Hợp đồng còn hiệu lực.' : 'Chưa kết thúc.');
      add('Rút tiền', S.na, null, '', null, '', 'Chưa có yêu cầu rút tiền liên quan.');
    }
    return steps;
  }
  function ledger(t) {
    const v = t.variant;
    if (!(t.status === 'PAID' || t.status === 'REFUNDED') || v === 'mismatch' || t.flags.noLedger) return [];
    const sh = shares(t);
    const rows = [];
    let escBal = 480000000;
    const d0 = 'Giao dịch ' + t.code;
    rows.push({ wallet: 'Ví giữ hộ (nền tảng)', comp: 'Khả dụng', debit: 0, credit: t.amount, before: escBal, after: escBal + t.amount, desc: 'Nhận tiền thanh toán — ' + d0 });
    if (sh) {
      if (sh.pt) rows.push({ wallet: 'PT ' + t.pt, comp: 'Chờ', debit: 0, credit: sh.pt, before: 0, after: sh.pt, desc: 'Phần của PT (' + sh.rates.pt + '%) — chờ giải phóng theo buổi' });
      if (sh.gym) rows.push({ wallet: t.gym, comp: 'Chờ', debit: 0, credit: sh.gym, before: 0, after: sh.gym, desc: 'Phần của phòng gym (' + sh.rates.gym + '%) — chờ giải phóng' });
      rows.push({ wallet: 'Doanh thu nền tảng', comp: 'Chờ', debit: 0, credit: sh.platform, before: 0, after: sh.platform, desc: 'Phí nền tảng (' + sh.rates.platform + '%) — chờ giải phóng' });
      const rel = releasedOf(t, sh);
      if (rel.done) {
        if (rel.pt) { rows.push({ wallet: 'PT ' + t.pt, comp: 'Chờ', debit: rel.pt, credit: 0, before: sh.pt, after: sh.pt - rel.pt, desc: 'Giải phóng ' + rel.done + '/' + rel.total + ' buổi' }); rows.push({ wallet: 'PT ' + t.pt, comp: 'Khả dụng', debit: 0, credit: rel.pt, before: 0, after: rel.pt, desc: 'Giải phóng ' + rel.done + '/' + rel.total + ' buổi' }); }
        else if (rel.gym) { rows.push({ wallet: t.gym, comp: 'Chờ', debit: rel.gym, credit: 0, before: sh.gym, after: sh.gym - rel.gym, desc: 'Giải phóng theo kỳ' }); rows.push({ wallet: t.gym, comp: 'Khả dụng', debit: 0, credit: rel.gym, before: 0, after: rel.gym, desc: 'Giải phóng theo kỳ' }); }
      }
    }
    if (v === 'pt_terminated') {
      const refund = Math.round(t.amount * 0.6875 / 1000) * 1000;
      rows.push({ wallet: 'Ví giữ hộ (nền tảng)', comp: 'Khả dụng', debit: refund, credit: 0, before: escBal + t.amount, after: escBal + t.amount - refund, desc: 'Hoàn tiền phần chưa tập về ví khách' });
      rows.push({ wallet: t.payer + ' (khách)', comp: 'Khả dụng', debit: 0, credit: refund, before: 0, after: refund, desc: 'Nhận hoàn tiền do PT chấm dứt hợp đồng' });
    }
    return rows;
  }
  function detail(t) {
    const sh = shares(t);
    const rel = releasedOf(t, sh);
    const tech = {
      idempotencyKey: 'pay:' + t.id.slice(0, 13) + ':' + (t.at / 1000 | 0),
      providerTransactionId: t.gwId,
      metadata: { rates: sh ? sh.rates : null, parties: { pt: t.pt || null, gym: t.gym || null }, gatewayDiscrepancy: t.flags.mismatch ? { kind: 'AMOUNT_MISMATCH', expected: t.amount, received: t.gwAmount, resolved: false } : undefined, unactivatedRefund: undefined }
    };
    return {
      journey: journey(t), split: sh ? { sh, rel } : null, ledger: ledger(t), tech,
      links: [
        t.purpose === 'PT_CONTRACT' ? { k: 'Hợp đồng', v: t.related } : t.purpose === 'GYM_MEMBERSHIP' ? { k: 'Gói hội viên', v: t.related } : t.purpose === 'PERSONALIZED_SERVICE_PURCHASE' ? { k: 'Dịch vụ', v: t.related } : { k: 'Ví', v: t.related },
        { k: 'Yêu cầu rút tiền', v: t.variant === 'pt_normal' ? 'Chưa có (PT chưa gửi yêu cầu)' : 'Không có' },
        { k: 'Hoàn tiền', v: t.variant === 'pt_terminated' ? 'Đã hoàn về ví khách' : 'Không có' }
      ]
    };
  }

  // ---------- Rút tiền (P7 + giả định G-08) ----------
  const withdrawals = [
    { id: 'w1', name: 'Trần Quốc Việt', role: 'PT', amount: 8500000, available: 14200000, ageMin: 190, bank: 'Vietcombank · ****4821 · TRAN QUOC VIET', status: 'PENDING' },
    { id: 'w2', name: 'Phoenix Gym Bình Thạnh', role: 'Chủ phòng gym', amount: 22000000, available: 31500000, ageMin: 1560, bank: 'Techcombank · ****0937 · CTY TNHH PHOENIX FITNESS', status: 'PENDING' },
    { id: 'w3', name: 'Lê Thị Thanh Hằng', role: 'PT', amount: 4200000, available: 4200000, ageMin: 2900, bank: 'ACB · ****7710 · LE THI THANH HANG', status: 'PENDING' },
    { id: 'w4', name: 'Nguyễn Đình Khang', role: 'PT', amount: 6300000, available: 9800000, ageMin: 330, bank: 'MB Bank · ****3356 · NGUYEN DINH KHANG', status: 'PENDING', conflict: true },
    { id: 'w5', name: 'Titan Fitness Quận 7', role: 'Chủ phòng gym', amount: 15000000, available: 15000000, ageMin: 4300, bank: 'BIDV · ****6602 · CTY CP TITAN FITNESS', status: 'APPROVED', approvedBy: 'Quản trị viên Phạm Thu Hương' },
    { id: 'w6', name: 'Phạm Hải Yến', role: 'PT', amount: 3100000, available: 3100000, ageMin: 5900, bank: 'Sacombank · ****2284 · PHAM HAI YEN', status: 'APPROVED', approvedBy: 'Quản trị viên Phạm Thu Hương' },
    { id: 'w7', name: 'Võ Thành Đạt', role: 'PT', amount: 5400000, available: 6000000, ageMin: 7200, bank: 'VPBank · ****9015 · VO THANH DAT', status: 'APPROVED', approvedBy: 'Quản trị viên Đoàn Minh Tâm' },
    { id: 'w8', name: 'Zenith Gym Thủ Đức', role: 'Chủ phòng gym', amount: 12800000, available: 12800000, ageMin: 9800, bank: 'Vietinbank · ****1148 · CTY TNHH ZENITH', status: 'PAID', ref: 'FT26102412345678', paidAt: NOW - 8200 * MIN },
    { id: 'w9', name: 'Trần Quốc Việt', role: 'PT', amount: 7000000, available: 14200000, ageMin: 20000, bank: 'Vietcombank · ****4821', status: 'PAID', ref: 'FT26101998761234', paidAt: NOW - 17000 * MIN },
    { id: 'w10', name: 'Lê Thị Thanh Hằng', role: 'PT', amount: 2500000, available: 4200000, ageMin: 15000, bank: 'ACB · ****7710', status: 'REJECTED', reason: 'Thông tin tài khoản nhận không khớp tên chủ ví' }
  ];

  // ---------- Hàng đợi khác (không phải rút tiền) ----------
  const QUEUES = [
    { id: 'dispute', title: 'Tranh chấp buổi tập', src: 'GET /admin/sessions/disputed · U1', count: 3, oldestMin: 3640, amount: 1950000, route: null, newest: { who: 'Trương Minh Quân', note: 'Khách báo PT vắng mặt', ageMin: 610 } },
    { id: 'refund', title: 'Yêu cầu hoàn tiền dịch vụ', src: 'ai-service refund-requests · A1', count: 2, oldestMin: 310, amount: 1198000, route: null, newest: { who: 'Phan Khánh Linh', note: 'Hoàn tiền dịch vụ chờ xử lý', ageMin: 45 } },
    { id: 'pt', title: 'Hồ sơ PT chờ duyệt', src: 'GET /admin/dashboard', count: 6, oldestMin: 4400, amount: null, route: null, newest: { who: 'PT Võ Thành Đạt', note: 'Hồ sơ PT mới nộp', ageMin: 95 } },
    { id: 'partner', title: 'Hồ sơ đối tác chờ duyệt', src: 'GET /admin/dashboard', count: 2, oldestMin: 1700, amount: null, route: null, newest: { who: 'Zenith Gym Thủ Đức', note: 'Hồ sơ đối tác mới nộp', ageMin: 260 } },
    { id: 'branch', title: 'Chi nhánh chờ duyệt', src: 'gym-service admin', count: 4, oldestMin: 2600, amount: null, route: null, newest: { who: 'Olympia Club Gò Vấp', note: 'Chi nhánh mới gửi duyệt', ageMin: 180 } },
    { id: 'listing', title: 'Tin đăng chờ duyệt', src: 'gym-service admin', count: 9, oldestMin: 800, amount: null, route: null, newest: { who: 'Phoenix Gym Bình Thạnh', note: 'Tin đăng mới gửi duyệt', ageMin: 35 } }
  ];

  // ---------- Nhóm ngoại lệ (P13 + U2 + P2) ----------
  function items(n, base, who, amounts, notes) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ code: (base + hex(6)).toUpperCase(), who: who[i % who.length], amount: amounts ? amounts[i % amounts.length] : null, ageMin: 90 + Math.floor(R() * 4200), note: notes ? notes[i % notes.length] : '' });
    }
    return out.sort((a, b) => b.ageMin - a.ageMin);
  }
  const EXCEPTIONS = [
    { id: 'ob_overdue', level: 'urgent', title: 'Nghĩa vụ hoàn tiền của PT quá hạn xác minh', src: 'P13', items: items(2, 'OB-', ['PT Võ Thành Đạt', 'PT Phạm Hải Yến'], [2600000, 2800000], ['Chưa có chứng từ chuyển trả sau 3 ngày', 'Chứng từ chờ người thứ hai xác minh']) },
    { id: 'activation', level: 'urgent', title: 'Đã thu tiền nhưng kích hoạt dịch vụ thất bại', src: 'P13', items: items(1, 'TX-', ['Đặng Thu Hà'], [2400000], ['Gói hội viên 6 tháng — gym-service trả lỗi']) },
    { id: 'discrepancy', level: 'urgent', title: 'Cổng báo số tiền khác với Gymini', src: 'P2', items: items(2, 'TX-', ['Phạm Quỳnh Chi', 'Hoàng Thị Lan'], [500000, 100000], ['VNPay báo cao hơn 500.000 ₫', 'ZaloPay báo thấp hơn 100.000 ₫']) },
    { id: 'holdback', level: 'watch', title: 'Khoản giữ lại của PT chờ quyết định', src: 'P13', items: items(3, 'HB-', ['PT Trần Quốc Việt', 'PT Lê Thị Thanh Hằng', 'PT Nguyễn Đình Khang'], [1200000, 900000, 1500000], ['Khách khiếu nại buổi tập', 'Chờ PT phản hồi', 'Đủ điều kiện nhả']) },
    { id: 'receivable', level: 'watch', title: 'Khoản phải thu từ đối tác', src: 'P13', items: items(2, 'RC-', ['Olympia Club Gò Vấp', 'Titan Fitness Quận 7'], [3200000, 1100000], ['Hoàn tiền hội viên vượt số dư', 'Đang trừ dần vào lần chi sau']) },
    { id: 'dispute_hold', level: 'watch', title: 'Buổi tập tranh chấp đang giữ tiền', src: 'U2', items: items(3, 'SS-', ['Trương Minh Quân', 'Mai Phương Thảo', 'Cao Hữu Phước'], [450000, 450000, 600000], ['Khách báo PT vắng mặt', 'PT báo khách không đến', 'Chờ bằng chứng']) },
    { id: 'refund_wait', level: 'watch', title: 'Hoàn tiền buổi tập chờ xử lý', src: 'U2', items: items(2, 'RF-', ['Phan Khánh Linh', 'Vũ Đức Thịnh'], [1000000, 1500000], ['Chờ admin quyết định', 'Chờ PT phản hồi']) }
  ];
  const EXCEPTIONS_DRIFT = [
    { id: 'neg_wallet', level: 'urgent', title: 'Ví có số dư âm', src: 'P3', drift: true, items: [{ code: 'WL-5C21AD', who: 'Ví PT Lê Thị Thanh Hằng — ngăn khả dụng', amount: -1250000, ageMin: 42, note: 'Rút hoặc hoàn vượt số dư' }] },
    { id: 'ledger_mismatch', level: 'urgent', title: 'Ví lệch với tổng sổ cái', src: 'P3', drift: true, items: [{ code: 'WL-90B7E2', who: 'Ví PT Lê Thị Thanh Hằng', amount: 1250000, ageMin: 42, note: 'Số dư ví và tổng bút toán khác nhau' }] },
    { id: 'missing_entry', level: 'urgent', title: 'Bút toán còn thiếu', src: 'P3', drift: true, items: [{ code: 'TX-4E7A20', who: 'Hợp đồng PT-2026-0377', amount: 1250000, ageMin: 42, note: 'Hoàn tiền đã ghi ở ví khách nhưng chưa trừ khỏi ví PT' }] }
  ];

  // ---------- Doanh thu luỹ kế ----------
  const PLATFORM_REVENUE = { available: BREAKDOWN.platformAvailable, pending: BREAKDOWN.platformPending };

  // ---------- Chuỗi theo kỳ ----------
  function seriesDay(dayIdx) {
    const r = rng(dayIdx * 7919 + 13);
    const dow = new Date(dayIdx * 86400000).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const income = Math.round((9000000 + r() * 26000000) * (weekend ? 0.7 : 1) / 1000) * 1000;
    const expense = Math.round((1500000 + r() * 11000000) / 1000) * 1000;
    const net = Math.round(income * (0.07 + r() * 0.03) / 1000) * 1000;
    return { income, expense, net };
  }
  function buildSeries(fromMs, toMs, group) {
    const day0 = Math.floor(fromMs / 86400000), day1 = Math.floor(toMs / 86400000);
    const buckets = new Map();
    for (let d = day0; d <= day1; d++) {
      const dt = new Date(d * 86400000);
      let key, label, start;
      if (group === 'day') { key = d; start = d; label = pad(dt.getUTCDate()) + '/' + pad(dt.getUTCMonth() + 1); }
      else if (group === 'week') { const dow = (dt.getUTCDay() + 6) % 7; start = d - dow; key = start; const s = new Date(start * 86400000); label = 'Tuần ' + pad(s.getUTCDate()) + '/' + pad(s.getUTCMonth() + 1); }
      else { key = dt.getUTCFullYear() * 12 + dt.getUTCMonth(); start = d; label = 'Tháng ' + pad(dt.getUTCMonth() + 1) + '/' + dt.getUTCFullYear(); }
      const s = seriesDay(d);
      const b = buckets.get(key) || { label, income: 0, expense: 0, net: 0, days: 0 };
      b.income += s.income; b.expense += s.expense; b.net += s.net; b.days++;
      buckets.set(key, b);
    }
    return Array.from(buckets.values());
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtMoney(n) { return new Intl.NumberFormat('vi-VN').format(n) + ' ₫'; }

  window.DATA = {
    NOW, MIN, BREAKDOWN, CLAIM_ROWS, claimsTotal, RECON_NORMAL, RECON_DRIFT,
    PURPOSE, PROVIDER, STATUS, txs, events, gymRows, MATCH, eventState, txState, ledgerTotal, evCount,
    detail, shares, withdrawals, QUEUES, EXCEPTIONS, EXCEPTIONS_DRIFT, PLATFORM_REVENUE, buildSeries,
    PEOPLE: { CUSTOMERS, PTS, GYMS },
    USERS: { total: 12486, new7d: 214 }, SYSTEM: { bad: 0, total: 9 }
  };
})();
