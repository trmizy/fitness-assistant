/* Gymini Admin prototype — app.js. JS thuần, không framework. Dữ liệu mẫu từ data.js. */
(function () {
  'use strict';
  const D = window.DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---------- Định dạng ----------
  const nf = new Intl.NumberFormat('vi-VN');
  const fm = (n) => (n == null || Number.isNaN(n)) ? '—' : nf.format(n) + ' ₫';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function parts(ms) { const o = {}; dtf.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; }); return o; }
  const fdt = (ms) => { if (!ms) return '—'; const p = parts(ms); return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute; };
  const fhm = (ms) => { const p = parts(ms); return p.hour + ':' + p.minute; };
  const fhms = (ms) => { const p = parts(ms); return p.hour + ':' + p.minute + ':' + p.second; };
  const T0 = performance.now();
  const vnow = () => D.NOW + (performance.now() - T0);
  function ageText(min) {
    if (min < 60) return Math.max(1, Math.round(min)) + ' phút';
    if (min < 1440) { const h = Math.floor(min / 60); const m = Math.round(min % 60); return h + ' giờ' + (m ? ' ' + m + ' phút' : ''); }
    const d = Math.floor(min / 1440); const h = Math.floor((min % 1440) / 60); return d + ' ngày' + (h ? ' ' + h + ' giờ' : '');
  }

  // ---------- Icon ----------
  const IC = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16 14h2',
    scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    out: 'M7 17 17 7M8 7h9v9',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    idcard: 'M3 6h18v12H3zM8 11a2 2 0 1 0 0 .01M5.5 16a3 3 0 0 1 5 0M14 10h4M14 14h3',
    building: 'M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M14 9h5a1 1 0 0 1 1 1v11M3 21h18M8 7h2M8 11h2M8 15h2',
    branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
    tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
    flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
    tri: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
    store: 'M3 9l1-5h16l1 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8',
    dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11',
    activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
    cpu: 'M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
    chevR: 'm9 6 6 6-6 6', chevD: 'm6 9 6 6 6-6',
    check: 'M20 6 9 17l-5-5', x: 'M18 6 6 18M6 6l12 12',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01',
    copy: 'M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10',
    refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
    sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    menu: 'M4 6h16M4 12h16M4 18h16', panel: 'M3 4h18v16H3zM9 4v16',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    arrow: 'M5 12h14M13 6l6 6-6 6', cols: 'M12 3v18M3 5h18v14H3z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4'
  };
  const ic = (n, s) => '<svg width="' + (s || 16) + '" height="' + (s || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + IC[n] + '"/></svg>';

  // ---------- Nhãn nguồn ----------
  const S = (t) => '<span class="srcl">' + esc(t) + '</span>';
  const G = (g) => '<span class="srcl gap">CẦN API MỚI · ' + esc(g) + '</span>';
  const SG = (src) => /^G-\d+/.test(src) ? G(src) : S(src);

  // ---------- Chip ----------
  const TONE_IC = { success: 'check', danger: 'tri', warning: 'tri', pending: 'clock', info: 'info', neutral: 'ban' };
  const chip = (tone, label, icon) => '<span class="chip ' + tone + '">' + ic(icon || TONE_IC[tone] || 'info', 12) + esc(label) + '</span>';
  const STATUS_TONE = { PAID: 'success', PENDING: 'pending', FAILED: 'danger', REFUNDED: 'info', CANCELLED: 'neutral', PROCESSING: 'pending' };
  const statusChip = (s) => chip(STATUS_TONE[s] || 'neutral', D.STATUS[s] || s);

  // ---------- State ----------
  const SK = 'gymini-proto-';
  const lsGet = (k) => { try { return localStorage.getItem(SK + k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(SK + k, v); } catch (e) { /* bỏ qua */ } };
  const st = {
    scenario: 'normal', showSrc: false, theme: lsGet('theme') || 'light', collapsed: lsGet('collapsed') === '1', navOpen: false,
    period: '30d', group: 'day', cFrom: '2026-10-01', cTo: '2026-10-26', tableOpen: false,
    expOpen: {}, expAll: {}, sel: null, side: 'gw', cols: { gw: false, upd: false }, popCols: false,
    wd: D.withdrawals.map((w) => Object.assign({}, w)), protoMin: window.innerWidth <= 640, updAt: D.NOW,
    pageKey: null, lastQs: null, tabX: null, lastTab: null, drawerTx: null, drawerOpener: null, retrying: false, rev: 0
  };
  const SCEN = [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['error', 'Lỗi máy chủ (500)'], ['forbidden', 'Không có quyền (403)'], ['stale', 'Dữ liệu cũ (>2 phút)'], ['drift', 'Lệch sổ']];
  const isOk = () => st.scenario === 'normal' || st.scenario === 'stale' || st.scenario === 'drift';
  const recon = () => st.scenario === 'drift' ? D.RECON_DRIFT : D.RECON_NORMAL;

  function exGroups() { return (st.scenario === 'drift' ? D.EXCEPTIONS_DRIFT.concat(D.EXCEPTIONS) : D.EXCEPTIONS); }
  function exCount() { return exGroups().reduce((s, g) => s + g.items.length, 0); }
  function exMoney() { return exGroups().reduce((s, g) => s + g.items.reduce((a, i) => a + (i.amount > 0 ? i.amount : 0), 0), 0); }

  // ---------- Khối theo kịch bản ----------
  const ref = () => 'REQ-' + (D.NOW % 1000000).toString(36).toUpperCase() + '-' + (st.rev + 17);
  function skel(h, extra) { return '<div class="skel" style="height:' + h + 'px;' + (extra || '') + '" aria-busy="true"></div>'; }
  function errBlock(what, h) {
    return '<div class="errblk" role="alert" style="' + (h ? 'min-height:' + h + 'px' : '') + '">' + ic('tri', 18) + '<div><div class="t">Không tải được' + (what ? ' ' + esc(what) : '') + ' — lỗi máy chủ</div><div class="ref">Mã tham chiếu mẫu: ' + ref() + ' · Số liệu không được hiển thị để tránh hiểu nhầm là 0.</div>' +
      '<button class="btn sm" style="margin-top:8px" data-act="retry">' + ic('refresh', 13) + 'Thử lại</button></div></div>';
  }
  function blk(h, what, fn) {
    if (st.scenario === 'loading' || st.retrying) return skel(h);
    if (st.scenario === 'error') return errBlock(what, h > 120 ? 0 : 0);
    return fn();
  }
  function forbidden() {
    return '<div class="forbid">' + ic('lock', 32) + '<h2>Tài khoản này không có quyền xem dữ liệu tài chính</h2><p class="muted" style="margin-top:6px">Nếu cần truy cập, hãy liên hệ quản trị viên cấp cao để được cấp quyền.</p></div>';
  }

  // ---------- Hàng đợi ----------
  function queueList() {
    const pend = st.wd.filter((w) => w.status === 'PENDING'), appr = st.wd.filter((w) => w.status === 'APPROVED');
    const sum = (a) => a.reduce((s, w) => s + w.amount, 0), oldest = (a) => a.reduce((m, w) => Math.max(m, w.ageMin), 0);
    const Q = {};
    D.QUEUES.forEach((q) => { Q[q.id] = q; });
    return [
      { id: 'wd_appr', urg: 1, money: true, title: 'Đã duyệt, chờ chuyển khoản', count: appr.length, oldest: oldest(appr), amount: sum(appr), src: 'GET /admin/payments/withdrawals · P7 (APPROVED)', go: 'Chuyển khoản', route: '#/finance/withdrawals?s=APPROVED', heat: 'hot' },
      { id: 'ex', urg: 2, money: true, title: 'Ngoại lệ đối soát cần xem', count: exCount(), oldest: exGroups().reduce((m, g) => g.items.reduce((a, i) => Math.max(a, i.ageMin), m), 0), amount: null, nosum: true, src: 'GET /admin/payments/obligations · P13 + U2 + P2', go: 'Xem ngoại lệ', route: '#/finance/reconciliation?tab=exceptions', heat: st.scenario === 'drift' ? 'hot' : 'warm' },
      { id: 'dispute', urg: 3, money: false, title: Q.dispute.title, count: Q.dispute.count, oldest: Q.dispute.oldestMin, amount: Q.dispute.amount, src: Q.dispute.src, go: 'Mở hàng đợi', route: null, heat: 'warm' },
      { id: 'refund', urg: 4, money: true, title: Q.refund.title, count: Q.refund.count, oldest: Q.refund.oldestMin, amount: Q.refund.amount, src: Q.refund.src, go: 'Mở hàng đợi', route: null, heat: 'warm' },
      { id: 'wd_pend', urg: 5, money: true, title: 'Rút tiền chờ duyệt', count: pend.length, oldest: oldest(pend), amount: sum(pend), src: 'GET /admin/payments/withdrawals · P7 (PENDING)', go: 'Duyệt', route: '#/finance/withdrawals?s=PENDING', heat: '' },
      { id: 'pt', urg: 6, money: false, title: Q.pt.title, count: Q.pt.count, oldest: Q.pt.oldestMin, amount: null, src: Q.pt.src, go: 'Mở hàng đợi', route: null, heat: '' },
      { id: 'partner', urg: 7, money: false, title: Q.partner.title, count: Q.partner.count, oldest: Q.partner.oldestMin, amount: null, src: Q.partner.src, go: 'Mở hàng đợi', route: null, heat: '' },
      { id: 'branch', urg: 8, money: false, title: Q.branch.title, count: Q.branch.count, oldest: Q.branch.oldestMin, amount: null, src: Q.branch.src, go: 'Mở hàng đợi', route: null, heat: '' },
      { id: 'listing', urg: 9, money: false, title: Q.listing.title, count: Q.listing.count, oldest: Q.listing.oldestMin, amount: null, src: Q.listing.src, go: 'Mở hàng đợi', route: null, heat: '' }
    ].sort((a, b) => a.urg - b.urg);
  }

  // ---------- Thành phần: tile / stat / AttentionList / RecentQueueList ----------
  function tile(o) {
    if (st.scenario === 'loading' || st.retrying) return skel(o.h || 116);
    const ib = '<span class="ibox ' + o.tone + '">' + ic(o.icon, 20) + '</span>';
    if (st.scenario === 'error') {
      return '<div class="card tile" role="group" aria-label="' + esc(o.label) + ' — không tải được"><div class="tb"><div class="lb">' + o.label + '</div><div class="val">—</div><div class="nt">Không tải được — lỗi máy chủ. Chưa biết số liệu; đây không phải số bằng không.</div>' +
        '<button class="btn sm" style="margin-top:8px" data-act="retry">' + ic('refresh', 13) + 'Thử lại</button></div>' + ib + '</div>';
    }
    return '<div class="card tile dimmable' + (o.danger ? ' danger' : '') + '"><div class="tb"><div class="lb">' + o.label + '</div><div class="val' + (o.sm ? ' sm' : '') + '">' + o.val + '</div><div class="nt">' + o.note + '</div>' + (o.src || '') + '</div>' + ib + '</div>';
  }
  function stat(o) {
    if (st.scenario === 'loading' || st.retrying) return skel(70);
    const ib = '<span class="ibox sm ' + o.tone + '">' + ic(o.icon, 18) + '</span>';
    if (st.scenario === 'error') return '<div class="card stat">' + ib + '<div><div class="sv">—</div><div class="sl">' + esc(o.label) + ' · không tải được</div></div></div>';
    return '<div class="card stat dimmable">' + ib + '<div><div class="sv">' + o.val + '</div><div class="sl">' + esc(o.label) + '</div>' + (o.src || '') + '</div></div>';
  }
  function attnRows(list) {
    return '<div class="attn">' + list.map((q) => {
      const flag = q.heat === 'hot' ? '<span class="hd hot" aria-hidden="true"></span><span class="sr">Khẩn: </span>' : q.heat === 'warm' ? '<span class="hd warm" aria-hidden="true"></span><span class="sr">Cần chú ý: </span>' : '';
      const meta = q.count === 0 ? 'Không có yêu cầu nào đang chờ' : 'Cũ nhất ' + ageText(q.oldest) + (q.amount != null && q.amount > 0 ? ' · Tổng <b class="num">' + fm(q.amount) + '</b>' : '') + (q.nosum ? ' · chỉ đếm, không cộng tiền' : '');
      return '<button class="attn-row dimmable" data-act="queue" data-id="' + q.id + '"><span class="at"><span class="an">' + flag + esc(q.title) + '</span><span class="am" style="display:block">' + meta + S(q.src) + '</span></span>' +
        (q.count === 0 ? chip('success', 'Đã xử lý hết') : '<span class="cp">' + q.count + '</span>') + '</button>';
    }).join('') + '</div>';
  }
  function attnPanel(id, title, sub, list) {
    return '<section class="card panel" aria-labelledby="' + id + '"><h2 class="ph2" id="' + id + '">' + ic('tri', 18) + esc(title) + '</h2><p class="ps">' + esc(sub) + '</p>' + blk(300, 'danh sách việc cần xử lý', () => attnRows(list)) + '</section>';
  }
  function recentItems() {
    const typ = { dispute: 'Tranh chấp', refund: 'Hoàn tiền', pt: 'Hồ sơ PT', partner: 'Đối tác', branch: 'Chi nhánh', listing: 'Tin đăng' };
    const out = D.QUEUES.map((q) => ({ t: typ[q.id], who: q.newest.who, note: q.newest.note, age: q.newest.ageMin, src: q.src }));
    const pend = st.wd.filter((w) => w.status === 'PENDING').sort((a, b) => a.ageMin - b.ageMin)[0];
    if (pend) out.push({ t: 'Rút tiền', who: pend.name, note: fm(pend.amount) + ' · chờ duyệt', age: pend.ageMin, src: 'GET /admin/payments/withdrawals · P7' });
    return out.sort((a, b) => a.age - b.age);
  }
  function recentPanel() {
    return '<section class="card panel" aria-labelledby="h-rc"><h2 class="ph2" id="h-rc">' + ic('activity', 18).replace('<svg', '<svg style="color:var(--st-info)"') + 'Mục mới tạo gần nhất trong các hàng đợi</h2><p class="ps">Mỗi hàng đợi một mục mới nhất · không phải toàn bộ hoạt động</p>' +
      blk(300, 'mục mới nhất', () => '<div class="dimmable">' + recentItems().map((r) => '<div class="rq-row"><span class="tp">' + esc(r.t) + '</span><div style="min-width:0"><div class="nm">' + esc(r.who) + '</div><div class="cp2">' + esc(r.note) + S(r.src) + '</div></div><span class="tm">' + ageText(r.age) + ' trước</span></div>').join('') +
        '<p class="foot-n">Nguồn: mục mới nhất của từng hàng đợi theo createdAt, đọc từ tập kết quả có giới hạn của mỗi hàng đợi — không phải mọi sự kiện gần đây, chưa có nhật ký hoạt động (G-23). ' + G('G-23') + '</p></div>') + '</section>';
  }
  const lv = (k, txt) => '<span class="lv ' + k + '">' + esc(txt) + '</span>';
  const lvlOfSrc = (src) => /P2/.test(src) ? lv('l2', 'L2 · callback cổng đã lưu') : lv('l1', 'L1 · sổ nội bộ');

  // ---------- Điều hướng ----------
  const NAV = [
    { title: null, items: [{ id: 'overview', label: 'Hôm nay', icon: 'home', href: '#/overview' }] },
    { title: 'Tài chính', items: [
      { id: 'finance', label: 'Tổng quan tài chính', icon: 'wallet', href: '#/finance' },
      { id: 'recon', label: 'Đối soát', icon: 'scale', href: '#/finance/reconciliation' },
      { id: 'tx', label: 'Giao dịch', icon: 'list', href: '#/finance/transactions' },
      { id: 'wd', label: 'Rút tiền', icon: 'out', href: '#/finance/withdrawals' },
      { id: 'refund', label: 'Hoàn tiền', icon: 'undo', href: '#/finance', oos: 'refund' }] },
    { title: 'Đối tác & người dùng', items: [
      { id: 'u', label: 'Người dùng', icon: 'users', oos: 1 }, { id: 'ptp', label: 'Hồ sơ PT', icon: 'idcard', oos: 1, badge: 6 },
      { id: 'gp', label: 'Đối tác phòng gym', icon: 'building', oos: 1, badge: 2 }, { id: 'br', label: 'Chi nhánh', icon: 'branch', oos: 1, badge: 4 },
      { id: 'ls', label: 'Tin đăng & tiện ích', icon: 'tag', oos: 1, badge: 9 }] },
    { title: 'Xử lý vụ việc', tip: 'Case Management', items: [
      { id: 'dp', label: 'Tranh chấp buổi tập', icon: 'flag', oos: 1, badge: 3 }, { id: 'gc', label: 'Khiếu nại phòng gym', icon: 'tri', oos: 1 },
      { id: 'mk', label: 'Chợ kế hoạch', icon: 'store', oos: 1 }, { id: 'ex', label: 'Bài tập', icon: 'dumbbell', oos: 1 }] },
    { title: 'Hệ thống', items: [{ id: 'sm', label: 'Giám sát hệ thống', icon: 'activity', oos: 1 }, { id: 'ai', label: 'Giám sát AI', icon: 'cpu', oos: 1 }] }
  ];
  const PAGES = {
    overview: { nav: 'overview', crumb: ['Hôm nay'], title: 'Hôm nay', sub: 'Những việc cần xử lý và tình trạng sổ sách tính đến lúc này.' },
    finance: { nav: 'finance', crumb: ['Tài chính', 'Tổng quan'], title: 'Tổng quan tài chính', sub: 'Tiền đang giữ hộ, ai đang có quyền đòi và dòng tiền theo kỳ.' },
    'finance/reconciliation': { nav: 'recon', crumb: ['Tài chính', 'Đối soát'], title: 'Đối soát', sub: 'Kiểm tra sổ sách có cân đối không, xem các ngoại lệ và đối chiếu cổng thanh toán với Gymini.' },
    'finance/transactions': { nav: 'tx', crumb: ['Tài chính', 'Giao dịch'], title: 'Giao dịch', sub: 'Tìm giao dịch và lần theo hành trình tiền của từng khoản.' },
    'finance/withdrawals': { nav: 'wd', crumb: ['Tài chính', 'Rút tiền'], title: 'Rút tiền', sub: 'Duyệt và chuyển khoản các yêu cầu rút tiền của PT và chủ phòng gym.' }
  };
  const FTABS = [['finance', 'Tổng quan', '#/finance'], ['finance/reconciliation', 'Đối soát', '#/finance/reconciliation'], ['finance/transactions', 'Giao dịch', '#/finance/transactions'], ['finance/withdrawals', 'Rút tiền', '#/finance/withdrawals']];

  function badgesNow() {
    const ok = isOk();
    const wd = st.wd.filter((w) => w.status === 'PENDING' || w.status === 'APPROVED').length;
    return { wd: ok ? wd : 0, recon: ok ? exCount() : 0 };
  }
  const UCARD = '<button class="ucard" data-act="userc" aria-label="Tài khoản: Phạm Thu Hương"><span class="av" aria-hidden="true">PH</span><span class="ut"><b>Phạm Thu Hương</b><span>huong.pham@gymini.example</span></span><span class="uar" aria-hidden="true">' + ic('chevD', 16) + '</span></button>';
  function buildSidebar() {
    let h = '<div class="brand"><div class="logo">' + ic('dumbbell', 18) + '</div><div class="lbl">Gymini · Quản trị</div></div><nav class="nav" id="nav" aria-label="Điều hướng chính">';
    NAV.forEach((g) => {
      h += '<div class="nav-group">' + (g.title ? '<div class="nav-title"' + (g.tip ? ' title="' + esc(g.tip) + '"' : '') + '>' + esc(g.title) + '</div>' : '');
      g.items.forEach((it) => {
        h += '<a class="nav-item" href="' + (it.href || '#') + '" data-nav="' + it.id + '"' + (it.oos ? ' data-oos="' + (it.oos === 1 ? 'x' : it.oos) + '"' : '') + ' title="' + esc(it.label) + '">' + ic(it.icon, 18) + '<span class="lbl">' + esc(it.label) + '</span><span class="badge" data-badge="' + it.id + '" hidden></span></a>';
      });
      h += '</div>';
    });
    h += '</nav><div class="sb-foot"><button class="nav-item" id="themeRow" data-act="theme" aria-label="Đổi giao diện sáng hoặc tối" title="Đổi giao diện">' + ic(st.theme === 'dark' ? 'sun' : 'moon', 18) + '<span class="lbl">Đổi giao diện</span></button>' + UCARD +
      '<button class="nav-item sb-collapse" data-act="collapse" aria-label="Thu gọn hoặc mở rộng thanh bên" aria-expanded="true">' + ic('panel', 18) + '<span class="lbl">Thu gọn thanh bên</span></button></div>';
    $('#sidebar').innerHTML = h;
  }
  function updateSidebar(navId) {
    const b = badgesNow();
    $$('.nav-item[data-nav]').forEach((a) => {
      const id = a.dataset.nav;
      if (id === navId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      const bd = $('[data-badge]', a);
      let n = 0, soft = false;
      NAV.forEach((g) => g.items.forEach((i) => { if (i.id === id && i.badge) { n = isOk() ? i.badge : 0; soft = true; } }));
      if (id === 'wd') n = b.wd; if (id === 'recon') n = b.recon;
      bd.hidden = !n; bd.textContent = n || ''; bd.classList.toggle('soft', soft && id !== 'wd' && id !== 'recon');
    });
    $('#app').classList.toggle('collapsed', st.collapsed);
    const cb = $('.sb-collapse'); if (cb) cb.setAttribute('aria-expanded', String(!st.collapsed));
  }
  function posNavInd() { /* vạch xanh đã bỏ — giữ hàm rỗng để resize không lỗi */ }

  // ---------- Toast / theme ----------
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').appendChild(t);
    setTimeout(() => { t.remove(); }, 3200);
  }
  function applyTheme() { document.documentElement.dataset.theme = st.theme; lsSet('theme', st.theme); const tr = $('#themeRow'); if (tr) tr.innerHTML = ic(st.theme === 'dark' ? 'sun' : 'moon', 18) + '<span class="lbl">Đổi giao diện</span>'; }
  function renderProto() {
    const p = $('#proto');
    p.classList.toggle('min', st.protoMin);
    p.innerHTML = '<div class="proto-h"><span>Kịch bản (prototype)</span><button class="icon-btn" style="width:26px;height:26px" data-act="protomin" aria-label="Thu gọn hoặc mở thanh kịch bản" aria-expanded="' + !st.protoMin + '">' + ic(st.protoMin ? 'chevR' : 'chevD', 14) + '</button></div><div class="proto-b">' +
      SCEN.map((s) => '<button data-act="scen" data-v="' + s[0] + '" aria-pressed="' + (st.scenario === s[0]) + '">' + s[1] + '</button>').join('') +
      '<hr><button data-act="togglesrc" aria-pressed="' + st.showSrc + '">Hiện nguồn dữ liệu <span>' + (st.showSrc ? 'Bật' : 'Tắt') + '</span></button></div>';
  }

  // ---------- Header + tabs ----------
  function header(key) {
    const m = PAGES[key];
    const crumb = ['Quản trị'].concat(m.crumb).map((c, i) => (i ? ic('chevR', 11) : '') + '<span>' + esc(c) + '</span>').join('');
    let h = '<div class="topbar"><div class="l"><button class="icon-btn hamb" data-act="hamb" aria-label="Mở menu điều hướng">' + ic('menu', 18) + '</button><div class="crumb" style="display:flex;gap:6px;align-items:center">' + crumb + '</div></div><span class="upd" id="upd">Cập nhật lúc ' + fhms(st.updAt) + '</span></div>' +
      '<header class="ph"><div style="min-width:0"><h1>' + esc(m.title) + '</h1><p class="sub">' + esc(m.sub) + '</p></div>' +
      '<div class="ph-right"><button class="btn" id="refreshBtn" data-act="refresh">' + ic('refresh', 16) + 'Làm mới</button></div></header>';
    if (key.indexOf('finance') === 0) {
      h += '<div class="tabs" role="tablist" aria-label="Tài chính" id="ftabs">' + FTABS.map((t) => '<a class="tab" role="tab" id="tab-' + t[0].replace('/', '-') + '" href="' + t[2] + '" data-tab="' + t[0] + '" aria-selected="' + (t[0] === key) + '" tabindex="' + (t[0] === key ? 0 : -1) + '">' + esc(t[1]) + '</a>').join('') + '<div class="tab-ind" id="tabInd"></div></div>';
    }
    return h;
  }
  function posTabInd(animateFrom) {
    const a = $('#ftabs [aria-selected="true"]'), ind = $('#tabInd'); if (!a || !ind) return;
    const x = a.offsetLeft, w = a.offsetWidth;
    if (animateFrom && st.tabX != null) { ind.style.transition = 'none'; ind.style.transform = 'translateX(' + st.tabX.x + 'px) scaleX(' + st.tabX.w / 100 + ')'; void ind.offsetWidth; ind.style.transition = ''; }
    ind.style.transform = 'translateX(' + x + 'px) scaleX(' + w / 100 + ')';
    st.tabX = { x, w };
  }
  const staleChip = () => st.scenario === 'stale'
    ? '<div class="stalechip">' + ic('clock', 14) + 'Dữ liệu lúc ' + fhm(st.updAt - 3 * D.MIN) + ' — đã cũ 3 phút <button class="btn sm" data-act="refresh">' + ic('refresh', 12) + 'Làm mới</button></div>' : '';

  // ---------- S1 Hôm nay ----------
  function pageOverview() {
    const r = recon(), Q = {};
    D.QUEUES.forEach((q) => { Q[q.id] = q; });
    const appr = st.wd.filter((w) => w.status === 'APPROVED'), pend = st.wd.filter((w) => w.status === 'PENDING');
    const sum = (a) => a.reduce((x, w) => x + w.amount, 0);
    const money = appr.length + exCount() + Q.refund.count, moneyTotal = sum(appr) + Q.refund.amount;
    const profiles = Q.pt.count + Q.partner.count + Q.branch.count + Q.listing.count;
    const t1 = tile({ tone: 'warning', icon: 'tri', label: 'Cần xử lý về tiền', val: money + ' <span class="u">mục</span>',
      note: 'Tổng <b class="num">' + fm(moneyTotal) + '</b> · ' + exCount() + ' ngoại lệ chỉ đếm', src: S('Tổng = rút đã duyệt (P7) + hoàn dịch vụ (A1); ngoại lệ (P13/U2/P2) chỉ đếm, không cộng tiền') });
    const t2 = tile({ tone: 'info', icon: 'out', label: 'Rút tiền chờ duyệt', val: pend.length + ' <span class="u">yêu cầu</span>', note: 'Tổng <b class="num">' + fm(sum(pend)) + '</b>. Đã duyệt chưa phải đã chuyển.', src: S('GET /admin/payments/withdrawals · P7 (PENDING)') });
    const t3 = tile({ tone: 'neutral', icon: 'idcard', label: 'Hồ sơ chờ duyệt', val: profiles + ' <span class="u">hồ sơ</span>', note: 'PT ' + Q.pt.count + ' · đối tác ' + Q.partner.count + ' · chi nhánh ' + Q.branch.count + ' · tin đăng ' + Q.listing.count, src: S('ADM-08 · ADM-50 · ADM-51 · ADM-71 (DTO TO VERIFY)') });
    const t4 = tile({ tone: r.balanced ? 'success' : 'danger', danger: !r.balanced, icon: r.balanced ? 'check' : 'tri', label: 'Cân đối sổ ví (ESCROW = Σ quyền đòi)', sm: true,
      val: r.balanced ? 'Cân bằng' : 'Lệch ' + fm(Math.abs(r.drift)),
      note: '<span title="Chỉ so số dư các ví với ví giữ hộ; không kiểm cổng, quyết toán, nghĩa vụ treo">Chỉ so ví với ví giữ hộ</span> · <a class="link" href="#/finance/reconciliation">' + (r.balanced ? 'Xem đối soát' : 'Xem nguyên nhân') + '</a>',
      src: S('GET /admin/payments/reconciliation · P3' + (r.balanced ? '' : ' (HTTP 409)') + ' · Phạm vi: chỉ so số dư các ví với ví giữ hộ — không kiểm cổng, quyết toán, nghĩa vụ treo; KHÔNG phải kết luận sức khoẻ toàn hệ thống') });
    const s1 = stat({ tone: 'neutral', icon: 'users', val: nf.format(D.USERS.total), label: 'Người dùng', src: S('GET /admin/dashboard · ADM-01 (TO VERIFY)') });
    const s2 = stat({ tone: 'info', icon: 'activity', val: String(D.USERS.new7d), label: 'Mới 7 ngày', src: S('GET /admin/dashboard · ADM-01 (TO VERIFY)') });
    const s3 = stat({ tone: 'success', icon: 'cpu', val: (D.SYSTEM.total - D.SYSTEM.bad) + '/' + D.SYSTEM.total, label: 'Dịch vụ đang chạy', src: S('Giám sát hệ thống (TO VERIFY)') });
    const s4 = stat({ tone: 'warning', icon: 'flag', val: String(Q.dispute.count), label: 'Tranh chấp đang mở', src: S('GET /admin/sessions/disputed · ADM-32') });
    return '<div class="page content ' + (st.scenario === 'stale' ? 'stale-on' : '') + '">' + staleChip() +
      '<div class="grid g4" aria-label="Chỉ số chính">' + t1 + t2 + t3 + t4 + '</div>' +
      '<div class="grid g4 g4s" style="margin-top:14px">' + s1 + s2 + s3 + s4 + '</div>' +
      '<div class="g2c" style="margin-top:14px">' + attnPanel('h-q', 'Việc cần xử lý', 'Sắp theo độ khẩn · mục tiền đứng trước', queueList()) + recentPanel() + '</div></div>';
  }

  // ---------- S2 Tổng quan tài chính ----------
  function periodRange() {
    const day = 86400000, end = D.NOW;
    if (st.period === '7d') return [end - 6 * day, end];
    if (st.period === 'month') return [Date.UTC(2026, 9, 1), end];
    if (st.period === 'custom') { let a = Date.parse(st.cFrom + 'T00:00:00Z'), b = Date.parse(st.cTo + 'T00:00:00Z'); if (!(a <= b)) b = a; if (b - a > 92 * day) a = b - 92 * day; return [a, b]; }
    return [end - 29 * day, end];
  }
  function moneyMap() {
    const r = recon(), B = D.BREAKDOWN, total = r.claims;
    const parties = ['Khách', 'PT', 'Phòng gym', 'Nền tảng'];
    const grp = parties.map((p) => ({ p, rows: D.CLAIM_ROWS.filter((x) => x.party === p) }));
    const bar = '<div class="mm-bar" id="mmBar" role="group" aria-label="Bản đồ tiền đang giữ">' + grp.map((g) => {
      const sum = g.rows.reduce((s, x) => s + B[x.key], 0);
      return '<div class="mm-grp" style="flex:' + sum + ' 1 0">' + g.rows.map((x) => '<button class="mm-seg t-' + x.token + '" style="flex:' + B[x.key] + ' 1 0" data-seg="' + x.key + '" aria-label="' + esc(x.label) + ': ' + fm(B[x.key]) + ', ' + (B[x.key] / total * 100).toFixed(1).replace('.', ',') + '%"></button>').join('') + '</div>';
    }).join('') + '</div>';
    const plabels = '<div class="mm-parties">' + grp.map((g) => '<div style="flex:' + g.rows.reduce((s, x) => s + B[x.key], 0) + ' 1 0" title="' + g.p + '">' + g.p + '</div>').join('') + '</div>';
    const rows = D.CLAIM_ROWS.map((x) => '<tr data-seg="' + x.key + '" tabindex="0"><td><span class="sw t-' + x.token + '"></span>' + esc(x.label) + '</td><td class="money">' + fm(B[x.key]) + '</td><td class="money num hide-s">' + (B[x.key] / total * 100).toFixed(1).replace('.', ',') + '%</td></tr>').join('');
    return '<div class="card dimmable"><div class="sec-h" style="margin-bottom:0"><h2>Bản đồ tiền đang giữ hộ</h2><span class="hint">Mỗi đoạn là quyền đòi của một bên ở một ngăn · 100% = ' + fm(total) + '</span></div>' + bar + plabels +
      '<div class="tw" style="margin-top:14px;border-radius:8px"><table class="mm-table"><thead><tr><th scope="col">Bên và ngăn</th><th scope="col" class="r">Số tiền</th><th scope="col" class="r hide-s">Tỷ lệ</th></tr></thead><tbody>' + rows +
      '<tr class="total"><td>Tổng quyền đòi của các bên</td><td class="money">' + fm(total) + '</td><td class="money hide-s">100%</td></tr></tbody></table></div>' + S('GET /admin/payments/reconciliation · P3 breakdown') + '</div>';
  }
  function periodInner() {
    const [a, b] = periodRange();
    const ser = D.buildSeries(a, b, st.group);
    const tot = ser.reduce((s, x) => ({ i: s.i + x.income, e: s.e + x.expense, n: s.n + x.net }), { i: 0, e: 0, n: 0 });
    const range = fdt(a).slice(0, 10) + ' – ' + fdt(b).slice(0, 10);
    st._ser = ser;
    const kp = '<div class="grid g3">' +
      tile({ tone: 'info', icon: 'wallet', label: 'Tiền vào nền tảng', val: fm(tot.i), note: 'Cộng cả nạp ví khách (backend hiện tính vậy)', src: S('GET /admin/payments/finance-overview · P4 totals.income') }) +
      tile({ tone: 'neutral', icon: 'out', label: 'Tiền ra khỏi nền tảng', val: fm(tot.e), note: 'Hoàn về ví khách chưa tính cho tới khi khách rút', src: S('P4 totals.expense') + G('G-18') }) +
      tile({ tone: 'info', icon: 'activity', label: 'Doanh thu nền tảng đã thực hiện', val: fm(tot.n), note: 'Phần phí đã giải phóng trong kỳ', src: S('P4 totals.netRevenue') }) + '</div>';
    const tbl = '<div class="reveal ' + (st.tableOpen ? 'open' : '') + '" id="serTbl"><div><div class="tw" style="margin-top:10px;border-radius:8px"><table><thead><tr><th scope="col">Kỳ</th><th scope="col" class="r">Tiền vào</th><th scope="col" class="r">Tiền ra</th><th scope="col" class="r">Doanh thu</th></tr></thead><tbody>' +
      ser.map((x) => '<tr><td>' + esc(x.label) + '</td><td class="money">' + fm(x.income) + '</td><td class="money">' + fm(x.expense) + '</td><td class="money">' + fm(x.net) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    return kp + '<div class="card dimmable" style="margin-top:14px"><div class="sec-h" style="margin-bottom:6px"><h2>Tiền vào và ra theo ' + ({ day: 'ngày', week: 'tuần', month: 'tháng' }[st.group]) + '</h2><span class="hint">' + range + ' · Kỳ tính theo UTC (backend hiện tại)</span></div>' +
      '<div class="legend"><span><span class="sw t-held"></span>Tiền vào</span><span><span class="sw t-out"></span>Tiền ra</span></div>' +
      '<div class="chart-wrap" id="chartBox"><div class="chart-tip" id="chartTip" role="status"></div></div>' +
      '<button class="btn sm" style="margin-top:10px" data-act="tbl" aria-expanded="' + st.tableOpen + '" aria-controls="serTbl">' + ic(st.tableOpen ? 'chevD' : 'chevR', 13) + (st.tableOpen ? 'Thu gọn bảng theo kỳ' : 'Xem bảng theo kỳ') + '</button>' + tbl + '</div>';
  }
  function periodBlock() {
    const ctrl = '<div class="chips" style="margin-bottom:12px"><div class="seg" role="group" aria-label="Kỳ">' +
      [['7d', '7 ngày'], ['30d', '30 ngày'], ['month', 'Tháng này'], ['custom', 'Tuỳ chọn']].map((p) => '<button data-act="period" data-v="' + p[0] + '" aria-pressed="' + (st.period === p[0]) + '">' + p[1] + '</button>').join('') + '</div>' +
      '<div class="seg" role="group" aria-label="Nhóm theo">' + [['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map((p) => '<button data-act="group" data-v="' + p[0] + '" aria-pressed="' + (st.group === p[0]) + '">' + p[1] + '</button>').join('') + '</div>' +
      (st.period === 'custom' ? '<label class="small muted">Từ <input class="fi" type="date" id="cFrom" value="' + st.cFrom + '" style="width:150px"></label><label class="small muted">đến <input class="fi" type="date" id="cTo" value="' + st.cTo + '" style="width:150px"></label>' : '') + '</div>';
    return ctrl + '<div class="table-load" id="periodInner">' + blk(520, 'số liệu trong kỳ', periodInner) + '</div>';
  }
  function drawChart() {
    const box = $('#chartBox'); if (!box || !st._ser || !isOk()) return;
    const ser = st._ser, W = Math.max(box.clientWidth, 280), H = W < 500 ? 220 : 270, ml = W < 500 ? 46 : 58, mb = 28, mt = 10, mr = 6;
    const max = Math.max.apply(null, ser.map((x) => Math.max(x.income, x.expense))) || 1;
    const steps = [2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].map((x) => x * 1e6);
    const step = steps.find((s) => max / s <= 5) || 2000e6; const top = Math.ceil(max / step) * step;
    const iw = W - ml - mr, ih = H - mt - mb, gw = iw / ser.length, bw = Math.max(2, Math.min(18, gw * 0.36));
    const y = (v) => mt + ih - v / top * ih;
    let g = '';
    for (let v = 0; v <= top; v += step) g += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--border)" stroke-opacity="' + (v ? .55 : 1) + '"/><text x="' + (ml - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--text-2)">' + (v ? nf.format(v / 1e6) + ' tr' : '0') + '</text>';
    const every = Math.ceil(ser.length / Math.max(2, Math.floor(iw / 62)));
    ser.forEach((x, i) => {
      const cx = ml + gw * i + gw / 2;
      g += '<g class="bargrp" tabindex="0" data-i="' + i + '" role="img" aria-label="' + esc(x.label) + ': vào ' + fm(x.income) + ', ra ' + fm(x.expense) + '"><rect class="hit" x="' + (ml + gw * i) + '" y="' + mt + '" width="' + gw + '" height="' + ih + '" fill="transparent"/>' +
        '<rect x="' + (cx - bw - 1) + '" y="' + y(x.income) + '" width="' + bw + '" height="' + (mt + ih - y(x.income)) + '" rx="2" fill="var(--money-held)"/>' +
        '<rect x="' + (cx + 1) + '" y="' + y(x.expense) + '" width="' + bw + '" height="' + (mt + ih - y(x.expense)) + '" rx="2" fill="var(--money-out)"/></g>';
      if (i % every === 0) g += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="var(--text-2)">' + esc(x.label.replace('Tháng ', 'T').replace('Tuần ', 'Tu ')) + '</text>';
    });
    const old = $('svg', box); if (old) old.remove();
    box.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="group" aria-label="Biểu đồ cột đôi tiền vào và ra">' + g + '</svg>');
  }
  function pageFinance() {
    const r = recon();
    const now = blk(116, 'số liệu hiện tại', () => '<div class="grid g3">' +
      tile({ tone: 'info', icon: 'wallet', label: 'Tiền đang giữ hộ', val: fm(r.escrow), note: 'Số dư ví giữ hộ của nền tảng', src: S('GET /admin/payments/reconciliation · escrow') }) +
      tile({ tone: 'neutral', icon: 'users', label: 'Tổng quyền đòi của các bên', val: fm(r.claims), note: 'Khách + PT + phòng gym + nền tảng', src: S('P3 claims') }) +
      tile({ tone: r.balanced ? 'success' : 'danger', danger: !r.balanced, icon: r.balanced ? 'check' : 'tri', label: 'Chênh lệch', val: fm(r.drift), note: r.balanced ? chip('success', 'Cân bằng', 'check') : chip('danger', 'Lệch sổ', 'tri') + ' <a class="link" href="#/finance/reconciliation">Xem nguyên nhân</a>', src: S('P3 drift') }) + '</div>');
    const rev = blk(110, 'doanh thu luỹ kế', () => '<div class="grid g3">' +
      tile({ tone: 'info', icon: 'check', label: 'Đã hưởng', val: fm(D.PLATFORM_REVENUE.available), note: 'Phần phí đã giải phóng', src: S('P3 platformRevenue.available') }) +
      tile({ tone: 'pending', icon: 'clock', label: 'Còn chờ giải phóng', val: fm(D.PLATFORM_REVENUE.pending), note: 'Chờ buổi tập hoàn thành', src: S('P3 platformRevenue.pending') }) +
      tile({ tone: 'neutral', icon: 'clock', label: 'Tính đến', val: fdt(st.updAt), sm: true, note: 'Luỹ kế từ khi bắt đầu, không phụ thuộc kỳ ở trên', src: '' }) + '</div>');
    const qs = queueList().filter((q) => q.money);
    return '<div class="page content ' + (st.scenario === 'stale' ? 'stale-on' : '') + '">' + staleChip() +
      '<section class="sec"><div class="sec-h"><h2>Hiện tại</h2><span class="asof">Tính đến ' + fhm(st.updAt) + ' · không phụ thuộc kỳ</span></div>' + now + '</section>' +
      '<section class="sec">' + blk(300, 'bản đồ tiền', moneyMap) + '</section>' +
      '<section class="sec"><div class="sec-h"><h2>Trong kỳ</h2><span class="hint">Dòng tiền thật qua nền tảng</span></div>' + periodBlock() + '</section>' +
      '<section class="sec"><div class="sec-h"><h2>Doanh thu nền tảng luỹ kế</h2></div>' + rev + '</section>' +
      '<section class="sec">' + attnPanel('h-fq', 'Hàng đợi tài chính', 'Việc liên quan đến tiền, sắp theo độ khẩn', qs) + '</section></div>';
  }

  // ---------- S3 Đối soát ----------
  function reconTabs(tab) {
    const T = [['books', 'Cân đối sổ', 'scale', S('P3') + ''], ['exceptions', 'Ngoại lệ', 'tri', ''], ['gateway', 'Đối chiếu cổng ↔ Gymini', 'list', '']];
    return '<div class="chips" role="tablist" aria-label="Loại đối soát" id="rtabs" style="margin-bottom:18px">' + T.map((t) =>
      '<button class="fchip" role="tab" data-act="rtab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '" tabindex="' + (tab === t[0] ? 0 : -1) + '">' + esc(t[1]) +
      (t[0] === 'exceptions' && isOk() ? '<span class="badge">' + exCount() + '</span>' : '') +
      (t[0] === 'gateway' ? '<span class="chip warning wrap">DESIGN EXPLORATION — EXTERNAL DATA SOURCE NOT IMPLEMENTED</span>' : '') + '</button>').join('') + '</div>';
  }
  function tabBooks() {
    const r = recon(), B = D.BREAKDOWN;
    let run = 0;
    const rows = D.CLAIM_ROWS.map((x) => { run += B[x.key]; return '<div class="crow"><span><span class="sw t-' + x.token + '"></span>' + esc(x.label) + '</span><span class="n">' + fm(B[x.key]) + '</span></div>'; }).join('');
    const bridge = '<div class="bridge dimmable"><div class="card"><h2>Tiền đang giữ hộ</h2><div class="big">' + fm(r.escrow) + '</div><p class="muted small" style="margin-top:6px">Số dư thực của ví giữ hộ (ESCROW) trong sổ cái</p>' + S('P3 escrow') + '</div>' +
      '<div class="card"><h2>Quyền đòi của các bên</h2><div style="margin-top:6px">' + rows + '<div class="crow sum"><span>Tổng quyền đòi</span><span class="n">' + fm(r.claims) + '</span></div></div>' + S('P3 claims · breakdown') + '</div></div>' +
      '<div class="diffbar ' + (r.balanced ? 'ok' : 'bad') + '" role="status"><span>Chênh lệch = ' + fm(r.drift) + '</span><span>' + (r.balanced ? chip('success', 'Khớp', 'check') : chip('danger', 'Lệch ' + fm(Math.abs(r.drift)), 'tri')) + '</span></div>';
    const neg = r.balanced
      ? '<div class="card dimmable" style="margin-top:14px"><h2>Ví âm</h2><p style="margin-top:6px;display:flex;gap:8px;align-items:center;color:var(--st-success)">' + ic('check', 16) + 'Không có ví âm</p>' + S('P3 negativeWallets') + '</div>'
      : '<div class="card" style="margin-top:14px"><h2>Ví âm (1)</h2><div class="tw" style="margin-top:8px;border-radius:8px"><table><thead><tr><th scope="col">Ví</th><th scope="col">Ngăn</th><th scope="col" class="r">Số dư</th></tr></thead><tbody><tr><td>PT Lê Thị Thanh Hằng</td><td>Khả dụng</td><td class="money" style="color:var(--st-danger);font-weight:650">' + fm(-1250000) + '</td></tr></tbody></table></div>' + S('P3 negativeWallets') + '</div>';
    const cause = r.balanced ? '' :
      '<div class="card" style="margin-top:14px;border-color:var(--st-danger)"><h2 style="color:var(--st-danger)">Nguyên nhân có thể và bước tiếp theo</h2><ul style="margin:10px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px">' +
      '<li><b>Ví âm:</b> ví PT Lê Thị Thanh Hằng đang âm ' + fm(1250000) + ' — thường do hoàn tiền hoặc rút vượt số dư.</li><li><b>Ví lệch sổ cái:</b> số dư ví khác tổng bút toán của ví đó.</li><li><b>Bút toán thiếu:</b> hoàn tiền đã ghi ở ví khách nhưng chưa trừ ví PT (giao dịch TX-4E7A20).</li></ul>' +
      '<p style="margin-top:10px"><b>Bước tiếp theo:</b> mở <a class="link" href="#/finance/reconciliation?tab=exceptions">tab Ngoại lệ</a>, kiểm tra từng mục, rồi nhờ kỹ thuật ghi bút toán điều chỉnh. Không rút tiền của ví này cho tới khi xử lý xong.</p></div>' +
      '<div class="callout warning" style="margin-top:12px">' + ic('info', 16) + '<div>Backend trả <b>HTTP 409</b> kèm dữ liệu ở trạng thái này — giao diện vẫn hiển thị số, không báo “lỗi”. ' + G('G-06') + '</div></div>';
    const expl = '<button class="btn sm" style="margin-top:14px" data-act="expl" aria-expanded="' + !!st.explOpen + '" aria-controls="expl">' + ic(st.explOpen ? 'chevD' : 'chevR', 13) + 'Quy tắc cân đối là gì?</button><div class="reveal ' + (st.explOpen ? 'open' : '') + '" id="expl"><div><div class="card" style="margin-top:8px"><p>Mọi đồng tiền khách trả đều nằm trong ví giữ hộ cho tới khi được chia cho PT, phòng gym hoặc nền tảng. Vì vậy <b>tiền đang giữ hộ phải bằng đúng tổng quyền đòi của mọi bên</b>: số dư ví khách, cộng các ngăn chờ, khả dụng và đã khoá của PT, phòng gym, nền tảng. Nếu hai số khác nhau, một bút toán đã bị ghi thiếu, ghi trùng hoặc có ví âm.</p></div></div></div>';
    return '<div class="lvl" role="note">' + lv('l1', 'L1 · sổ nội bộ') + '<span>Kiểm bất biến ESCROW = Σ quyền đòi từ sổ cái của Gymini (P3). Không đối chiếu với bên ngoài.</span></div>' + blk(380, 'số liệu cân đối sổ', () => bridge + neg + cause) + (isOk() ? expl : '');
  }
  function tabExceptions() {
    return blk(320, 'danh sách ngoại lệ', () => {
      const gs = exGroups();
      return '<div class="lvl" role="note">' + lv('l1', 'L1 · P13 nghĩa vụ/giữ lại') + lv('l1', 'L1 · U2 buổi tranh chấp') + lv('l2', 'L2 · P2 callback cổng đã lưu') + '<span>Mọi nhóm đều từ dữ liệu hệ thống tự lưu; chưa có báo cáo độc lập của cổng/ngân hàng (L3 BLOCKED).</span></div><div class="callout" style="margin-bottom:12px">' + ic('info', 16) + '<div>Gộp từ ba nguồn: nghĩa vụ và khoản giữ lại (P13), buổi tập tranh chấp (U2), cổng báo lệch (P2). Bấm một nhóm để xem các mục.</div></div>' +
        gs.map((g) => {
          const open = !!st.expOpen[g.id], all = !!st.expAll[g.id];
          const total = g.items.reduce((s, i) => s + (i.amount > 0 ? i.amount : 0), 0);
          const oldest = g.items.reduce((m, i) => Math.max(m, i.ageMin), 0);
          const list = (all ? g.items : g.items.slice(0, 5)).map((i) => '<div class="exitem"><span class="mono">' + esc(i.code) + ' <button class="copy" data-act="copy" data-v="' + esc(i.code) + '" aria-label="Sao chép mã ' + esc(i.code) + '">' + ic('copy', 13) + '</button></span><span>' + esc(i.who) + '<span class="muted small" style="display:block">' + esc(i.note) + '</span></span><span class="money" style="' + (i.amount < 0 ? 'color:var(--st-danger);font-weight:650' : '') + '">' + fm(i.amount) + '</span><span class="muted small money">' + ageText(i.ageMin) + '</span></div>').join('');
          return '<div class="exgroup dimmable ' + (open ? 'open' : '') + '" data-g="' + g.id + '"><button class="exhead" data-act="exg" data-id="' + g.id + '" aria-expanded="' + open + '">' + ic('chevR', 16).replace('<svg', '<svg class="chev"') +
            '<span style="min-width:0"><b>' + esc(g.title) + '</b> ' + lvlOfSrc(g.src) + S(g.src) + '</span>' + '<span class="hide-s">' + (g.level === 'urgent' ? chip('danger', 'Cần xem ngay') : chip('pending', 'Theo dõi', 'clock')) + '</span><span class="num"><b>' + g.items.length + '</b> <span class="muted small">mục</span></span><span class="muted small hide-s">Cũ nhất ' + ageText(oldest) + '</span><span class="money">' + (total ? fm(total) : '') + '</span></button>' +
            '<div class="reveal ' + (open ? 'open' : '') + '"><div><div class="exitems">' + list + (g.items.length > 5 && !all ? '<div style="padding:8px 16px 10px 42px"><button class="link" data-act="exall" data-id="' + g.id + '">Xem tất cả ' + g.items.length + ' mục</button></div>' : '') + '</div></div></div></div>';
        }).join('');
    });
  }
  const KEYNAME = { VNPAY: 'vnp_TxnRef', ZALOPAY: 'app_trans_id', PAYOS: 'orderCode' };
  function gwRowHtml(e) {
    const m = D.MATCH[D.eventState(e)];
    return '<button class="gwrow" data-act="gwsel" data-side="gw" data-id="' + e.id + '" aria-pressed="false"><div class="l1"><span><b>' + D.PROVIDER[e.provider] + '</b> <span class="mono muted">' + esc(e.gwId) + '</span></span><span class="num"><b>' + fm(e.gwAmount) + '</b></span></div>' +
      '<div class="l2"><span>' + fdt(e.at) + ' · ' + esc(e.gwStatus) + '</span>' + chip(m.tone, m.label) + '</div></button>';
  }
  function gymRowHtml(t) {
    const m = D.MATCH[D.txState(t)];
    return '<button class="gwrow" data-act="gwsel" data-side="gym" data-id="' + t.id + '" aria-pressed="false"><div class="l1"><span><b class="mono">' + esc(t.code) + '</b> <span class="muted small">' + esc(D.PURPOSE[t.purpose]) + '</span></span><span class="num"><b>' + fm(t.amount) + '</b></span></div>' +
      '<div class="l2"><span>' + esc(D.STATUS[t.status]) + ' · ghi sổ ' + fm(D.ledgerTotal(t)) + '</span>' + chip(m.tone, m.label) + '</div></button>';
  }
  function tabGateway() {
    return blk(460, 'dữ liệu đối chiếu', () => {
      const evs = D.events, gy = D.gymRows;
      const stc = (s) => evs.filter((e) => D.eventState(e) === s).length;
      const okN = stc('match'), needN = evs.filter((e) => ['amount', 'gw_only', 'duplicate'].includes(D.eventState(e))).length + gy.filter((t) => D.txState(t) === 'gym_only').length;
      const sw = st.side;
      return '<div class="callout warning ro-banner" style="margin-bottom:12px">' + ic('info', 16) + '<div>Đối chiếu hai phía cần màn hình ≥ 1024px. Đây là chế độ chỉ đọc một cột.</div></div>' +
        '<div class="lvl" role="note"><span class="lv l2">L2 · cột Cổng = callback/IPN do Gymini lưu (không độc lập)</span><span class="lv l1">Nội bộ · cột Gymini = sổ giao dịch + sổ cái</span><span class="lv l3">L3 · báo cáo độc lập của cổng/ngân hàng: BLOCKED — chưa có nguồn dữ liệu</span></div>' +
        '<div class="callout warning" style="margin-bottom:12px">' + ic('info', 16) + '<div><b>DESIGN EXPLORATION — EXTERNAL DATA SOURCE NOT IMPLEMENTED.</b> Prototype của hợp đồng backend mới — cần API mới (G-04, G-05, G-07). Chỉ “Lệch số tiền” có dữ liệu thật hôm nay; các trạng thái còn lại được <b>suy ra để hiển thị</b>. Chọn một khoản để đi theo chuỗi: bằng chứng → bút toán → chênh lệch → giải thích → bước tiếp theo.</div></div>' +
        '<div class="card dimmable" style="padding:0"><div class="gwhead"><div class="muted small">Nguồn<b style="font-size:14px">VNPay · ZaloPay · PayOS</b></div><div class="muted small">Kỳ<b style="font-size:14px">25/10 – 26/10/2026</b></div><div class="muted small">Sự kiện cổng<b>' + evs.length + '</b></div><div class="muted small">Giao dịch Gymini<b>' + gy.length + '</b></div><div class="muted small">Khớp<b style="color:var(--st-success)">' + okN + '</b></div><div class="muted small">Cần xem<b style="color:var(--st-danger)">' + needN + '</b></div></div></div>' +
        '<div class="gw-switch seg" role="group" aria-label="Chọn phía hiển thị" style="margin-top:12px"><button data-act="gwside" data-v="gw" aria-pressed="' + (sw === 'gw') + '">Cổng</button><button data-act="gwside" data-v="gym" aria-pressed="' + (sw === 'gym') + '">Gymini</button></div>' +
        '<div class="gwcols ro" id="gwcols"><div class="gwcol ' + (sw === 'gym' ? 'hidden-s' : '') + '"><h3>Từ cổng thanh toán ' + lv('l2', 'L2 · callback đã lưu') + G('G-07') + '</h3><div class="gwlist" id="gwL">' + evs.map(gwRowHtml).join('') + '</div></div>' +
        '<div class="gwcol ' + (sw === 'gw' ? 'hidden-s' : '') + '"><h3>Trong Gymini ' + lv('l1', 'Nội bộ') + G('G-04') + '</h3><div class="gwlist" id="gwR">' + gy.map(gymRowHtml).join('') + '</div></div></div>' +
        '<div id="cmpBox" aria-live="polite"></div>' +
        '<div class="legend-box"><b style="color:var(--foreground)">Chú giải:</b>' + Object.keys(D.MATCH).map((k) => '<span>' + chip(D.MATCH[k].tone, D.MATCH[k].label) + ' ' + BASIS[k] + '</span>').join('') + '</div>';
    });
  }
  const CAUSE = {
    match: ['Mã giao dịch cổng, số tiền và cổng thanh toán đều trùng giữa callback đã lưu và giao dịch Gymini.', ''],
    amount: ['Callback cổng báo số tiền khác số Gymini chờ, nên giao dịch chuyển sang Thất bại và không ghi sổ.', 'Số tiền của phiên thanh toán bị đổi sau khi tạo; hoặc số tiền thực thu ở cổng khác số đã gửi.'],
    gw_only: ['Có callback đã lưu nhưng Gymini không tìm thấy giao dịch tương ứng.', 'Mã tham chiếu không khớp; hoặc giao dịch bị huỷ trước đó.'],
    gym_only: ['Gymini ghi nhận đã thu tiền nhưng chưa có callback đã lưu cho giao dịch này.', 'Callback chưa tới hoặc không được lưu; hoặc giao dịch được xử lý bằng đường khác.'],
    duplicate: ['Có nhiều callback đã lưu cùng mã giao dịch cổng.', 'Cổng gửi lại cùng một thông báo.'],
    pending: ['Giao dịch ở trạng thái Chờ thanh toán; chưa có kết quả cuối từ cổng.', '']
  };
  const BASIS = {
    match: 'suy ra hiển thị (derived display state): cùng providerTransactionId + cùng số tiền + cùng cổng — không phải trạng thái của backend',
    amount: 'có thật: metadata.gatewayDiscrepancy',
    pending: 'có thật: status PENDING',
    gw_only: 'suy ra hiển thị: có callback đã lưu nhưng không tìm thấy giao dịch',
    gym_only: 'suy ra hiển thị: không thấy callback đã lưu cho giao dịch đã thu',
    duplicate: 'suy ra hiển thị: nhiều callback cùng mã giao dịch cổng'
  };
  const XULY = '<div class="state-note">' + ic('info', 16) + '<div><b>Xử lý:</b> chưa có quy trình xử lý sai lệch được duyệt (G-15). <b>Bằng chứng cần thu thập:</b> sao kê cổng cho mã này, lịch sử callback, trạng thái giao dịch.</div></div>';
  function postTable(rows) {
    return '<div class="tw" style="border-radius:8px"><table><thead><tr><th scope="col">Ví · ngăn</th><th scope="col" class="r">Nợ</th><th scope="col" class="r">Có</th></tr></thead><tbody>' +
      rows.map((l) => '<tr><td>' + esc(l.wallet) + ' · <span class="muted">' + l.comp + '</span><div class="muted small">' + esc(l.desc) + '</div></td><td class="money">' + (l.debit ? fm(l.debit) : '—') + '</td><td class="money">' + (l.credit ? fm(l.credit) : '—') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function ledgerNote(t, e) {
    if (!t) return '<div class="state-note missing">' + ic('help', 16) + '<div><b>Thiếu bằng chứng nội bộ:</b> không có giao dịch Gymini ứng với callback này nên không có bút toán nào để tra.</div></div>';
    if (t.variant === 'mismatch') return '<div class="state-note fail">' + ic('tri', 16) + '<div><b>Callback cổng THẤT BẠI — không ghi sổ.</b> Số tiền cổng báo ' + fm(e ? e.gwAmount : t.gwAmount) + ' khác số Gymini chờ ' + fm(t.amount) + ', nên giao dịch chuyển sang Thất bại và <b>không có bút toán nào</b>. Đúng thiết kế; tiền khách trả đang ở cổng.</div></div>';
    if (t.flags.noLedger) return '<div class="state-note missing">' + ic('tri', 16) + '<div><b>Thiếu bản ghi (bất thường):</b> giao dịch đã thanh toán nhưng không tìm thấy bút toán nào.</div></div>';
    return '<div class="state-note">' + ic('info', 16) + '<div>Chưa phát sinh bút toán vì giao dịch chưa thu tiền.</div></div>';
  }
  function cmpHtml(sel) {
    let e = null, t = null;
    if (sel.side === 'gw') { e = D.events.find((x) => x.id === sel.id); t = e && e.txId ? D.txs.find((x) => x.id === e.txId) : null; }
    else { t = D.txs.find((x) => x.id === sel.id); e = D.events.find((x) => x.txId === t.id) || null; }
    const state = e ? D.eventState(e) : D.txState(t);
    const m = D.MATCH[state], gwA = e ? e.gwAmount : null, gyA = t ? t.amount : null;
    const dif = (gwA != null && gyA != null) ? gwA - gyA : null;
    const prov = (e || t).provider, kn = KEYNAME[prov];
    const keys = [
      ['providerTransactionId = ' + kn + (e ? ' (' + e.gwId + ')' : ''), !!(e && t && e.gwId === t.gwId), e && t ? '' : 'thiếu một bên'],
      ['Số tiền cổng = số tiền Gymini', dif === 0, dif == null ? 'thiếu một bên' : ''],
      ['Cùng cổng thanh toán', !!(e && t && e.provider === t.provider), e && t ? '' : 'thiếu một bên']
    ];
    const dupN = e ? D.events.filter((x) => x.txId && x.txId === e.txId).length : 0;
    const led = t ? D.detail(t).ledger : [];
    const step = (n, ttl, val, d) => '<div class="inv-step"><div class="sn">' + n + ' · ' + ttl + '</div><b>' + val + '</b><div class="d">' + d + '</div></div>';
    const steps = '<div class="inv-steps">' +
      step(1, 'Khoản đã chọn', esc((t && t.code) || (e && e.gwId)), t ? fm(gyA) + ' · ' + esc(D.STATUS[t.status]) : 'Không có giao dịch Gymini') +
      step(2, 'Bằng chứng', (t ? 'Nội bộ' : '—') + ' + ' + (e ? 'L2' : '—'), 'Gymini: ' + (t ? 'có' : 'thiếu') + ' · callback đã lưu: ' + (e ? 'có' : 'thiếu')) +
      step(3, 'Bút toán liên quan', led.length ? led.length + ' dòng' : 'Không có', '1 giao dịch → N bút toán') +
      step(4, 'Chênh lệch', dif == null ? '—' : (dif ? '<span style="color:var(--st-danger)">' + fm(dif) + '</span>' : fm(0)), esc(m.label)) + '</div>';
    const evInt = '<div><h3>Bằng chứng nội bộ ' + lv('l1', 'Nội bộ') + '</h3>' + (t ? '<dl class="dl" style="grid-template-columns:120px 1fr"><dt>Mã</dt><dd class="mono">' + esc(t.code) + '</dd><dt>Trạng thái</dt><dd>' + statusChip(t.status) + '</dd><dt>Số tiền chờ</dt><dd class="num">' + fm(t.amount) + '</dd><dt>Tạo lúc</dt><dd>' + fdt(t.at) + '</dd></dl>' : '<div class="state-note missing">' + ic('help', 16) + '<div>Thiếu bản ghi nội bộ cho callback này.</div></div>') + '</div>';
    const evGw = '<div><h3>Callback cổng đã lưu ' + lv('l2', 'L2') + '</h3>' + (e ? '<dl class="dl" style="grid-template-columns:130px 1fr"><dt>Cổng · mã</dt><dd class="mono">' + D.PROVIDER[e.provider] + ' ' + esc(e.gwId) + '</dd><dt>Số tiền cổng báo</dt><dd class="num">' + fm(gwA) + '</dd><dt>Trạng thái cổng</dt><dd>' + esc(e.gwStatus) + '</dd><dt>Đến lúc</dt><dd>' + fdt(e.at) + '</dd><dt>Số lần gửi</dt><dd>' + (dupN > 1 ? dupN + ' sự kiện cùng mã' : e.attempts + ' lần') + '</dd><dt>Gymini xử lý lúc</dt><dd>' + (e.processedAt ? fdt(e.processedAt) : 'Chưa xử lý') + '</dd></dl>' : '<div class="state-note missing">' + ic('help', 16) + '<div><b>Chưa có callback đã lưu</b> cho khoản này — thiếu bằng chứng từ cổng.</div></div>') + '</div>';
    return '<div class="card cmp inv"><div class="inv-h"><h2>Điều tra khoản thanh toán</h2>' + chip(m.tone, m.label) + '<span class="muted small">' + BASIS[state] + '</span><span class="muted small mono" style="margin-left:auto">' + esc((t && t.code) || (e && e.gwId)) + '</span></div>' + steps +
      '<div class="inv-ev">' + evInt + evGw + '</div>' +
      '<h3 style="font-size:13px;margin:0 0 6px">Bút toán liên quan (1 giao dịch → N dòng) ' + G('G-05') + '</h3>' + (led.length ? postTable(led) : ledgerNote(t, e)) +
      '<div class="grid g2" style="margin-top:14px"><div><h3 style="font-size:13px;margin-bottom:6px">Khoá khớp và chênh lệch</h3><div class="keys">' + keys.map((k) => '<div>' + (k[1] ? '<span style="color:var(--st-success)">' + ic('check', 16) + '</span>' : '<span style="color:var(--st-danger)">' + ic('x', 16) + '</span>') + '<span class="mono" style="overflow-wrap:anywhere">' + esc(k[0]) + '</span>' + (k[2] ? '<span class="muted small">(' + k[2] + ')</span>' : '') + '</div>').join('') + '</div></div>' +
      '<div><h3 style="font-size:13px;margin-bottom:6px">Điều đã xảy ra</h3><p>' + CAUSE[state][0] + '</p>' + (CAUSE[state][1] ? '<h3 style="font-size:13px;margin:10px 0 6px">Nguyên nhân có thể (chỉ là khả năng, chưa kết luận)</h3><p>' + CAUSE[state][1] + '</p>' : '') + '</div></div>' + (state === 'match' ? '' : XULY) +
      '<div class="state-note">' + ic('info', 16) + '<div>Chưa thể xác nhận độc lập với báo cáo của cổng/ngân hàng (<b>L3 BLOCKED</b>). Chưa có nút “Đánh dấu đã đối soát”: việc ghi nhận xử lý cần API G-15 kèm nhật ký kiểm toán.</div></div>' +
      '<div class="nextlink"><b>Bước tiếp theo trong chuỗi truy vết:</b>' + (t ? '<a class="btn sm primary" href="#/finance/transactions/' + t.id + '">' + ic('arrow', 13) + 'Mở hành trình tiền của ' + esc(t.code) + '</a>' : '<span class="muted">Không có giao dịch Gymini để mở — cần tra mã ' + esc(e.gwId) + ' trên cổng.</span>') + '</div></div>';
  }
  function selectGw(side, id) {
    st.sel = { side, id };
    const e = side === 'gw' ? D.events.find((x) => x.id === id) : null;
    let pairGw = [], pairGym = [];
    if (side === 'gw') { pairGw = D.events.filter((x) => x.id === id || (e.txId && x.txId === e.txId)).map((x) => x.id); pairGym = e.txId ? [e.txId] : []; }
    else { pairGym = [id]; pairGw = D.events.filter((x) => x.txId === id).map((x) => x.id); }
    $$('.gwrow').forEach((r) => {
      const isGw = r.dataset.side === 'gw', rid = r.dataset.id;
      const selfSel = r.dataset.side === side && rid === id;
      const pair = !selfSel && (isGw ? pairGw : pairGym).includes(rid);
      r.classList.toggle('sel', selfSel); r.classList.toggle('pair', pair); r.setAttribute('aria-pressed', String(selfSel));
    });
    ['gwL', 'gwR'].forEach((x) => { const l = $('#' + x); if (l) l.classList.add('has-sel'); });
    const target = $('.gwrow.pair'); if (target) target.scrollIntoView({ block: 'nearest' });
    const box = $('#cmpBox'); if (box) { box.innerHTML = cmpHtml(st.sel); fixScroll(); }
    // đồng bộ phía đang xem trên mobile
    const want = side === 'gw' ? 'gym' : 'gw';
    if (window.innerWidth <= 640) { st.side = side; }
  }
  function pageRecon() {
    const tab = ['books', 'exceptions', 'gateway'].includes(st.q.get('tab')) ? st.q.get('tab') : 'books';
    const body = tab === 'books' ? tabBooks() : tab === 'exceptions' ? tabExceptions() : tabGateway();
    return '<div class="page content ' + (st.scenario === 'stale' ? 'stale-on' : '') + '">' + staleChip() + reconTabs(tab) + body + '</div>';
  }

  // ---------- S4 Giao dịch ----------
  const FILT = {
    status: [['', 'Tất cả'], ['PAID', 'Đã thanh toán'], ['PENDING', 'Chờ thanh toán'], ['FAILED', 'Thất bại'], ['REFUNDED', 'Đã hoàn về ví'], ['CANCELLED', 'Đã huỷ']],
    provider: [['', 'Tất cả'], ['VNPAY', 'VNPay'], ['ZALOPAY', 'ZaloPay'], ['PAYOS', 'PayOS']],
    purpose: [['', 'Tất cả'], ['PT_CONTRACT', 'Hợp đồng PT'], ['GYM_MEMBERSHIP', 'Hội viên gym'], ['WALLET_TOPUP', 'Nạp ví'], ['PERSONALIZED_SERVICE_PURCHASE', 'Dịch vụ cá nhân hoá']],
    period: [['', 'Tất cả'], ['7d', '7 ngày'], ['3d', '3 ngày']]
  };
  const PAGE_SIZE = 15;
  function txFiltered() {
    const q = st.q, qq = (q.get('q') || '').trim().toLowerCase(), now = D.NOW;
    return D.txs.filter((t) => (!q.get('status') || t.status === q.get('status')) && (!q.get('provider') || t.provider === q.get('provider')) && (!q.get('purpose') || t.purpose === q.get('purpose')) &&
      (!q.get('period') || t.at >= now - (q.get('period') === '7d' ? 7 : 3) * 86400000) && (!qq || t.code.toLowerCase() === qq || t.id.toLowerCase() === qq || t.gwId.toLowerCase() === qq));
  }
  function txTable() {
    return blk(560, 'danh sách giao dịch', () => {
      const all = txFiltered(), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE)), p = Math.min(pages, Math.max(1, parseInt(st.q.get('page') || '1', 10) || 1));
      const rows = all.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
      const body = rows.length ? rows.map((t) => {
        const extra = (t.flags.mismatch ? ' ' + chip('warning', 'Lệch số tiền') : '') + (t.flags.activationFailed ? ' ' + chip('danger', 'Kích hoạt thất bại') : '') + (t.flags.noLedger ? ' ' + chip('danger', 'Thiếu bút toán') : '');
        return '<tr class="click dimmable" tabindex="0" data-tx="' + t.id + '" aria-label="Mở chi tiết giao dịch ' + t.code + '"><td class="num" style="white-space:nowrap">' + fdt(t.at) + '</td><td><span class="mono">' + t.code + '</span> <button class="copy" data-act="copy" data-v="' + t.id + '" aria-label="Sao chép mã giao dịch ' + t.code + '">' + ic('copy', 13) + '</button></td><td>' + esc(t.payer) + '</td><td class="hide-s">' + esc(D.PURPOSE[t.purpose]) + '</td><td class="money">' + fm(t.amount) + '</td><td>' + statusChip(t.status) + extra + '</td><td class="hide-s">' + D.PROVIDER[t.provider] + '</td>' +
          '<td class="hide-s muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(t.related) + '">' + esc(t.related) + '</td>' + (st.cols.gw ? '<td class="mono hide-s">' + esc(t.gwId) + '</td>' : '') + (st.cols.upd ? '<td class="num hide-s">' + fdt(t.at + 21500) + '</td>' : '') + '</tr>';
      }).join('') : '<tr><td colspan="9" style="text-align:center;padding:36px" class="muted">Không có giao dịch nào khớp bộ lọc. <button class="link" data-act="clearf">Xoá bộ lọc</button></td></tr>';
      return '<div class="tw"><table><thead><tr><th scope="col" aria-sort="descending">Thời gian ↓</th><th scope="col">Mã</th><th scope="col">Người trả</th><th scope="col" class="hide-s">Loại</th><th scope="col" class="r">Số tiền</th><th scope="col">Trạng thái</th><th scope="col" class="hide-s">Cổng</th><th scope="col" class="hide-s">Liên quan</th>' + (st.cols.gw ? '<th scope="col" class="hide-s">Mã giao dịch cổng</th>' : '') + (st.cols.upd ? '<th scope="col" class="hide-s">Cập nhật</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
        '<div class="pager"><span>Trang ' + p + '/' + pages + ' · ' + all.length + ' giao dịch ' + G('G-04') + '</span><span class="chips"><button class="btn sm" data-act="page" data-v="' + (p - 1) + '"' + (p <= 1 ? ' disabled' : '') + '>Trước</button><button class="btn sm" data-act="page" data-v="' + (p + 1) + '"' + (p >= pages ? ' disabled' : '') + '>Sau</button></span></div>';
    });
  }
  function chipRow(key, label) {
    const cur = st.q.get(key) || '';
    return '<div class="chips"><span class="small muted" style="min-width:62px">' + label + '</span>' + FILT[key].map((o) => '<button class="fchip" data-act="filt" data-k="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + '</button>').join('') + '</div>';
  }
  function pageTx() {
    const qv = st.q.get('q') || '';
    return '<div class="page content ' + (st.scenario === 'stale' ? 'stale-on' : '') + '">' + staleChip() +
      '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px"><div class="chips" style="justify-content:space-between"><div class="search" style="flex:1 1 240px;max-width:380px">' + ic('search', 16) + '<input class="fi" id="txSearch" type="search" placeholder="Tìm đúng mã giao dịch" aria-label="Tìm theo mã giao dịch chính xác" value="' + esc(qv) + '"></div>' +
      '<div style="position:relative"><button class="btn" data-act="cols" aria-expanded="' + st.popCols + '">' + ic('cols', 15) + 'Cột</button>' + (st.popCols ? '<div class="pop"><label><input type="checkbox" data-col="gw"' + (st.cols.gw ? ' checked' : '') + '> Mã giao dịch cổng</label><label><input type="checkbox" data-col="upd"' + (st.cols.upd ? ' checked' : '') + '> Cập nhật lúc</label></div>' : '') + '</div></div>' +
      chipRow('status', 'Trạng thái') + chipRow('provider', 'Cổng') + chipRow('purpose', 'Mục đích') + chipRow('period', 'Kỳ') + '</div>' +
      '<div class="table-load" id="txWrap">' + txTable() + '</div></div>';
  }
  function updateTxTable() {
    const w = $('#txWrap'); if (!w) return;
    w.style.minHeight = w.offsetHeight + 'px'; w.classList.add('is-loading');
    const fresh = () => { w.innerHTML = txTable(); fixScroll(); w.classList.remove('is-loading'); w.style.minHeight = ''; $$('.fchip[data-act="filt"]').forEach((b) => b.setAttribute('aria-pressed', String((st.q.get(b.dataset.k) || '') === b.dataset.v))); const s = $('#txSearch'); if (s && document.activeElement !== s) s.value = st.q.get('q') || ''; };
    clearTimeout(st.txT); st.txT = setTimeout(fresh, 420);
  }

  // ---------- Drawer giao dịch ----------
  const STEP = { warn: ['warning', 'tri', 'Số tiền khác nhau / cần chú ý'], fail: ['danger', 'x', 'Thất bại, không ghi sổ'], done: ['success', 'check', 'Đã xảy ra'], wait: ['pending', 'clock', 'Đang chờ'], na: ['neutral', 'ban', 'Không áp dụng'], unread: ['info', 'help', 'Không đọc được dữ liệu'], missing: ['danger', 'tri', 'Thiếu bản ghi (bất thường)'] };
  function evidenceHtml(t) {
    const e = D.events.find((x) => x.txId === t.id) || null;
    const known = !!e || D.gymRows.some((x) => x.id === t.id);
    if (!known) return '<div class="state-note missing">' + ic('help', 16) + '<div><b>Không đủ bằng chứng:</b> dữ liệu mẫu chưa nạp callback đã lưu cho giao dịch này, nên chưa so được số tiền cổng báo. <span class="muted">L3 (báo cáo độc lập) BLOCKED.</span></div></div>';
    const state = D.txState(t), m = D.MATCH[state], dif = e ? e.gwAmount - t.amount : null;
    return '<div class="chips" style="margin-bottom:8px">' + chip(m.tone, m.label) + lv('l2', 'L2 · callback đã lưu') + lv('l1', 'Nội bộ') + '</div>' +
      '<dl class="dl"><dt>Nội bộ: số tiền chờ</dt><dd class="num">' + fm(t.amount) + ' · ' + esc(D.STATUS[t.status]) + '</dd><dt>Callback: số tiền cổng báo</dt><dd class="num">' + (e ? fm(e.gwAmount) + ' · ' + esc(e.gwStatus) : '<span class="muted">chưa có callback đã lưu</span>') + '</dd><dt>Chênh lệch</dt><dd class="num" style="' + (dif ? 'color:var(--st-danger);font-weight:650' : '') + '">' + (dif == null ? '—' : fm(dif)) + '</dd></dl>' +
      (t.variant === 'mismatch' ? '<div class="state-note fail">' + ic('tri', 16) + '<div><b>Callback THẤT BẠI — không ghi sổ.</b> ' + CAUSE.amount[0] + '</div></div>' + XULY : '<p class="small muted" style="margin-top:8px">' + CAUSE[state][0] + '</p>') +
      '<p class="small muted" style="margin-top:6px">Cơ sở: ' + BASIS[state] + '</p>' +
      '<div class="nextlink"><b>Bước trước trong chuỗi:</b><button class="btn sm" data-act="gwjump" data-id="' + t.id + '">' + ic('scale', 13) + 'Xem trong Đối chiếu cổng ↔ Gymini</button></div>';
  }
  function drawerHtml(t) {
    const close = '<button class="icon-btn dr-x" data-act="dclose" aria-label="Đóng chi tiết giao dịch">' + ic('x', 16) + '</button>';
    if (!isOk()) {
      return '<div class="dr-head"><h2 id="drTitle" style="font-size:16px">Giao dịch ' + esc(t.code) + '</h2>' + close + '</div><div class="dr-body" style="padding-top:16px">' + (st.scenario === 'error' ? errBlock('chi tiết giao dịch') : st.scenario === 'forbidden' ? forbidden() : skel(420)) + '</div>';
    }
    const d = D.detail(t);
    const extra = (t.flags.mismatch ? ' ' + chip('warning', 'Lệch số tiền') : '') + (t.flags.activationFailed ? ' ' + chip('danger', 'Kích hoạt thất bại') : '') + (t.flags.noLedger ? ' ' + chip('danger', 'Thiếu bút toán') : '');
    const head = '<div class="dr-head"><div class="small muted">Giao dịch</div><h2 id="drTitle" style="font-size:15px;font-weight:600;display:flex;gap:6px;align-items:center"><span class="mono">' + esc(t.code) + '</span><button class="copy" data-act="copy" data-v="' + t.id + '" aria-label="Sao chép mã đầy đủ">' + ic('copy', 14) + '</button></h2>' + close +
      '<div class="dr-amt">' + fm(t.amount) + '</div><div class="chips" style="gap:6px">' + statusChip(t.status) + extra + '<span class="chip">' + esc(D.PURPOSE[t.purpose]) + '</span><span class="chip">' + D.PROVIDER[t.provider] + '</span></div>' +
      '<dl class="dl" style="margin-top:12px"><dt>Mã đầy đủ</dt><dd class="mono small">' + t.id + '</dd><dt>Người trả</dt><dd>' + esc(t.payer) + '</dd><dt>Tạo lúc</dt><dd>' + fdt(t.at) + '</dd></dl></div>';
    const tl = '<ol class="tl">' + d.journey.map((s) => {
      const k = STEP[s.st];
      return '<li><span class="dot ' + s.st + '">' + ic(k[1], 14) + '</span><div><div class="tt ' + (s.st === 'na' ? 'na' : '') + '">' + esc(s.title) + chip(k[0], k[2], k[1]) + '</div>' +
        (s.note ? '<div class="note">' + esc(s.note) + '</div>' : '') + '<div class="meta">' + [s.at ? fdt(s.at) : null, s.ref ? 'Mã: ' + s.ref : null, s.verif ? s.verif : null].filter(Boolean).map(esc).join(' · ') + (s.src ? SG(s.src) : '') + '</div></div></li>';
    }).join('') + '</ol>';
    let split = '';
    if (d.split) {
      const sh = d.split.sh, rel = d.split.rel, rows = [['PT ' + (t.pt || ''), 'pt', 't-held'], [t.gym || 'Phòng gym', 'gym', 't-locked'], ['Nền tảng', 'platform', 't-revenue']].filter((r) => sh[r[1]] > 0);
      split = '<div class="splitbar" role="img" aria-label="Tỷ lệ chia">' + rows.map((r) => '<span class="' + r[2] + '" style="flex:' + sh[r[1]] + ' 1 0"></span>').join('') + '</div><div class="tw" style="border-radius:8px"><table><thead><tr><th scope="col">Bên</th><th scope="col" class="r">Tỷ lệ</th><th scope="col" class="r">Số tiền</th><th scope="col" class="r">Đã giải phóng</th><th scope="col" class="r">Còn chờ</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td><span class="sw ' + r[2] + '"></span>' + esc(r[0]) + '</td><td class="money">' + sh.rates[r[1]] + '%</td><td class="money">' + fm(sh[r[1]]) + '</td><td class="money">' + fm(rel[r[1]]) + '</td><td class="money">' + fm(sh[r[1]] - rel[r[1]]) + '</td></tr>').join('') + '</tbody></table></div><p class="small muted" style="margin-top:6px">Tỷ lệ được đóng băng lúc thanh toán' + (rel.total ? ' · ' + rel.done + '/' + rel.total + ' buổi đã hoàn thành' : '') + '.</p>';
    } else split = '<p class="muted">Giao dịch này không chia cho các bên (' + (t.purpose === 'WALLET_TOPUP' ? 'nạp ví khách' : 'chưa thu tiền') + ').</p>';
    let led;
    if (d.ledger.length) {
      const dsum = d.ledger.reduce((a, l) => a + l.debit, 0), csum = d.ledger.reduce((a, l) => a + l.credit, 0);
      led = '<div class="postsum"><b>' + d.ledger.length + ' bút toán</b><span class="muted small">cho 1 giao dịch · tổng Nợ ' + fm(dsum) + ' · tổng Có ' + fm(csum) + '</span><button class="btn sm" data-act="post" aria-expanded="' + !!st.postOpen + '" aria-controls="postBox">' + ic(st.postOpen ? 'chevD' : 'chevR', 13) + (st.postOpen ? 'Thu gọn bút toán' : 'Xem ' + d.ledger.length + ' bút toán') + '</button></div><div class="reveal ' + (st.postOpen ? 'open' : '') + '" id="postBox"><div><div class="tw" style="border-radius:8px"><table><thead><tr><th scope="col">Ví · ngăn</th><th scope="col" class="r">Nợ</th><th scope="col" class="r">Có</th><th scope="col" class="r">Số dư trước → sau</th></tr></thead><tbody>' +
        d.ledger.map((l) => '<tr><td>' + esc(l.wallet) + ' · <span class="muted">' + l.comp + '</span><div class="muted small">' + esc(l.desc) + '</div></td><td class="money">' + (l.debit ? fm(l.debit) : '—') + '</td><td class="money">' + (l.credit ? fm(l.credit) : '—') + '</td><td class="money small">' + nf.format(l.before) + ' → ' + nf.format(l.after) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    } else led = '<div class="callout ' + (t.flags.noLedger ? 'danger' : '') + '">' + ic(t.flags.noLedger ? 'tri' : 'info', 16) + '<div>' + (t.flags.noLedger ? '<b>Thiếu bản ghi (bất thường):</b> giao dịch đã thanh toán nhưng không có bút toán nào.' : t.variant === 'mismatch' ? 'Không có bút toán — đúng thiết kế khi lệch số tiền. Tiền khách trả đang ở cổng.' : 'Chưa phát sinh bút toán vì giao dịch chưa thu tiền.') + '</div></div>';
    const rel = '<dl class="dl">' + d.links.map((l) => '<dt>' + esc(l.k) + '</dt><dd>' + esc(l.v) + '</dd>').join('') + '</dl>';
    const tech = '<button class="btn sm" data-act="tech" aria-expanded="' + !!st.techOpen + '" aria-controls="techBox">' + ic(st.techOpen ? 'chevD' : 'chevR', 13) + 'Chi tiết kỹ thuật</button><div class="reveal ' + (st.techOpen ? 'open' : '') + '" id="techBox"><div><pre class="tech">' + esc(JSON.stringify({ idempotencyKey: d.tech.idempotencyKey, providerTransactionId: d.tech.providerTransactionId, metadata: JSON.parse(JSON.stringify(d.tech.metadata)) }, null, 2)) + '</pre><p class="small muted" style="margin-top:6px">Không hiển thị đường dẫn thanh toán (redirectUrl) ' + G('G-14') + '</p></div></div>';
    return head + '<div class="dr-body"><div class="dsec"><h3>Bằng chứng và chênh lệch ' + G('G-04') + '</h3>' + evidenceHtml(t) + '</div><div class="dsec"><h3>Hành trình tiền ' + G('G-05') + '</h3>' + tl + '</div><div class="dsec"><h3>Phân chia ' + G('G-05') + '</h3>' + split + '</div><div class="dsec"><h3>Bút toán ' + G('G-05') + G('G-10') + '</h3>' + led + '</div><div class="dsec"><h3>Liên quan</h3>' + rel + '</div><div class="dsec">' + tech + '</div></div>';
  }
  function openDrawer(id) {
    const t = D.txs.find((x) => x.id === id);
    if (!t) { toast('Không tìm thấy giao dịch này'); location.hash = '#/finance/transactions'; return; }
    st.drawerTx = id; st.techOpen = false; st.postOpen = false;
    const dr = $('#drawer'); dr.innerHTML = drawerHtml(t); dr.setAttribute('aria-hidden', 'false'); dr.classList.add('on'); $('#scrim').classList.add('on');
    document.body.style.overflow = 'hidden'; fixScroll();
    setTimeout(() => { const c = $('.dr-x', dr); if (c) c.focus(); }, 40);
    markRows();
  }
  function markRows() {
    const t = st.drawerTx && D.txs.find((x) => x.id === st.drawerTx);
    $$('tr[data-tx]').forEach((r) => { const rt = D.txs.find((x) => x.id === r.dataset.tx); r.classList.toggle('hl', !!t && rt.id === t.id); r.classList.toggle('rel', !!t && rt.id !== t.id && rt.payer === t.payer); });
  }
  function closeDrawer(restore) {
    if (!st.drawerTx) return;
    const id = st.drawerTx; st.drawerTx = null;
    $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on'); document.body.style.overflow = ''; markRows();
    if (restore) { const row = $('[data-tx="' + id + '"]'); if (row) row.focus(); }
  }
  function syncDrawer(txId) { if (txId && txId !== st.drawerTx) openDrawer(txId); else if (!txId && st.drawerTx) closeDrawer(true); }

  // ---------- S5 Rút tiền ----------
  const WD_TABS = [['PENDING', 'Chờ duyệt', ''], ['APPROVED', 'Đã duyệt – chờ chuyển khoản', ''], ['PAID', 'Đã chuyển', 'G-08'], ['REJECTED', 'Từ chối', 'G-08']];
  function pageWd() {
    const cur = WD_TABS.some((x) => x[0] === st.q.get('s')) ? st.q.get('s') : 'PENDING';
    const cnt = (s) => st.wd.filter((w) => w.status === s).length;
    const chips = '<div class="chips" role="group" aria-label="Trạng thái rút tiền" style="margin-bottom:14px">' + WD_TABS.map((x) => '<button class="fchip" data-act="wdtab" data-v="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '">' + x[1] + '<span class="badge soft">' + (isOk() ? cnt(x[0]) : '—') + '</span>' + (x[2] ? G(x[2]) : '') + '</button>').join('') + '</div>';
    let body;
    if (st.scenario === 'error') body = '<div class="errblk" role="alert">' + ic('tri', 18) + '<div><div class="t">Không tải được hàng đợi rút tiền — lỗi máy chủ</div><div class="ref">Điều này KHÔNG có nghĩa là hàng đợi trống. Chưa biết có bao nhiêu yêu cầu đang chờ. Mã tham chiếu mẫu: ' + ref() + '</div><button class="btn sm" style="margin-top:8px" data-act="retry">' + ic('refresh', 13) + 'Thử lại</button></div></div>';
    else body = blk(300, 'hàng đợi rút tiền', () => {
      const rows = st.wd.filter((w) => w.status === cur).sort((a, b) => b.ageMin - a.ageMin);
      const apprNote = cur === 'APPROVED' ? '<div class="callout" style="margin-bottom:12px">' + ic('info', 16) + '<div><b>Đã duyệt ≠ đã chuyển.</b> Tiền đã khoá chờ chuyển khoản nhưng <b>chưa rời nền tảng</b> cho tới khi bạn xác nhận đã chuyển và nhập mã tham chiếu ngân hàng.</div></div>' : '';
      const note = apprNote + (cur === 'PAID' || cur === 'REJECTED') ? '<div class="callout warning" style="margin-bottom:12px">' + ic('info', 16) + '<div>Backend hiện chỉ trả các yêu cầu chờ duyệt và đã duyệt. Danh sách này là dữ liệu minh hoạ cho hợp đồng mới ' + G('G-08') + '</div></div>' : '';
      if (!rows.length) return apprNote + note + '<div class="card" style="text-align:center;padding:36px"><b>Không có yêu cầu nào ở trạng thái này</b><p class="muted small" style="margin-top:4px">Danh sách đã tải thành công và đang trống.</p></div>';
      return apprNote + note + '<div class="tw"><table><thead><tr><th scope="col">Người yêu cầu</th><th scope="col" class="r">Số tiền</th><th scope="col" class="r hide-s">Khả dụng hiện tại <span class="muted small" style="font-weight:400">(đề xuất)</span>' + G('G-08') + '</th><th scope="col">Tuổi yêu cầu</th><th scope="col" class="hide-s">Thông tin nhận tiền</th><th scope="col" class="r">' + (cur === 'PAID' ? 'Mã tham chiếu' : cur === 'REJECTED' ? 'Lý do' : 'Thao tác') + '</th></tr></thead><tbody>' +
        rows.map((w) => '<tr class="dimmable" data-w="' + w.id + '"><td><b>' + esc(w.name) + '</b><div class="muted small">' + esc(w.role) + (w.approvedBy ? ' · duyệt bởi ' + esc(w.approvedBy.replace('Quản trị viên ', '')) : '') + '</div></td><td class="money"><b>' + fm(w.amount) + '</b></td><td class="money hide-s">' + fm(w.available) + '</td><td>' + (w.status === 'PAID' ? 'Chuyển ' + fdt(w.paidAt).slice(0, 10) : ageText(w.ageMin)) + '</td><td class="hide-s muted small" style="max-width:260px">' + esc(w.bank) + '</td><td class="r">' +
          (w.status === 'PENDING' ? '<button class="btn sm primary" data-act="wdapprove" data-id="' + w.id + '">Duyệt</button>' : w.status === 'APPROVED' ? '<button class="btn sm primary" data-act="wdpay" data-id="' + w.id + '">Đã chuyển khoản</button>' : w.status === 'PAID' ? '<span class="mono">' + esc(w.ref) + '</span>' : '<span class="muted small">' + esc(w.reason) + '</span>') + '</td></tr>').join('') + '</tbody></table></div>' + S('GET /admin/payments/withdrawals · P7') + '<div class="srcrow">' + S('POST /admin/payments/withdrawals/:id/approve · P8') + S('POST …/withdrawals/:id/mark-paid · P10') + G('G-02') + '</div>';
    });
    return '<div class="page content ' + (st.scenario === 'stale' ? 'stale-on' : '') + '">' + staleChip() + chips + body + '</div>';
  }

  // ---------- Dialog ----------
  function openDialog(o) {
    const root = $('#dlgRoot'), opener = document.activeElement;
    root.innerHTML = '<div class="dlg-wrap"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h2 id="dlgT">' + esc(o.title) + '</h2><div class="body" id="dlgBody">' + o.body + '</div><div class="foot" id="dlgFoot"><button class="btn" data-dlg="cancel">Huỷ</button><button class="btn ' + (o.tone || 'primary') + '" data-dlg="ok" id="dlgOk">' + esc(o.ok) + '</button></div></div></div>';
    st.dlg = { o, opener, busy: false, conflict: false };
    setTimeout(() => { const f = $('#dlgRef') || $('#dlgOk'); if (f) f.focus(); }, 30);
  }
  function closeDialog() {
    if (!st.dlg) return; const op = st.dlg.opener; st.dlg = null; $('#dlgRoot').innerHTML = '';
    if (op && document.contains(op)) op.focus(); else { const m = $('#main'); if (m) m.focus(); }
  }
  function dlgSubmit() {
    const d = st.dlg; if (!d || d.busy) return;
    if (d.conflict) { const fn = d.o.afterConflict; closeDialog(); fn && fn(); return; }
    let val = null;
    if (d.o.needRef) {
      const inp = $('#dlgRef'); val = inp.value.trim();
      if (val.length < 6) { inp.classList.add('err'); $('#refErr').textContent = 'Cần nhập mã tham chiếu ngân hàng (ít nhất 6 ký tự).'; inp.focus(); return; }
    }
    d.busy = true; const ok = $('#dlgOk'); ok.classList.add('busy'); ok.innerHTML = '<span class="spinner"></span>Đang gửi…'; ok.setAttribute('aria-busy', 'true');
    $('[data-dlg="cancel"]').disabled = true;
    setTimeout(() => {
      const res = d.o.run(val);
      if (res.conflict) {
        d.busy = false; d.conflict = true; ok.classList.remove('busy'); ok.removeAttribute('aria-busy'); ok.className = 'btn primary'; ok.textContent = 'Tải lại dòng'; $('[data-dlg="cancel"]').disabled = false;
        $('#dlgBody').innerHTML = '<div class="callout danger" role="alert">' + ic('tri', 16) + '<div><b>Không thực hiện được (409).</b> ' + esc(res.conflict) + '</div></div>'; ok.focus();
      } else {
        $('#dlgBody').innerHTML = '<div class="callout" style="background:var(--st-success-bg)" role="status"><span style="color:var(--st-success)">' + ic('check', 18) + '</span><div><b>' + esc(res.msg) + '</b><div class="muted small">Máy chủ đã xác nhận.</div></div></div>';
        $('#dlgFoot').innerHTML = '';
        setTimeout(() => { closeDialog(); toast(res.msg); rerender(); }, 1000);
      }
    }, 800);
  }
  function wdDialog(kind, id) {
    const w = st.wd.find((x) => x.id === id); if (!w) return;
    const sum = '<div class="sumbox"><div><b style="font-size:15px">' + esc(w.name) + '</b><div class="muted small">' + esc(w.role) + '</div></div><b>' + fm(w.amount) + '</b></div>';
    if (kind === 'approve') {
      openDialog({ title: 'Duyệt yêu cầu rút tiền', ok: 'Duyệt yêu cầu', body: sum + '<div class="callout warning">' + ic('info', 16) + '<div>Số tiền sẽ chuyển từ <b>khả dụng</b> sang <b>đã khoá</b>. Tiền <b>CHƯA</b> được chuyển cho người nhận.</div></div><div class="muted small">Khả dụng hiện tại của ví: ' + fm(w.available) + ' · Nhận tại: ' + esc(w.bank) + '</div>',
        run: () => {
          if (w.conflict) return { conflict: 'Yêu cầu này đã được quản trị viên Đoàn Minh Tâm duyệt lúc 14:20.' };
          w.status = 'APPROVED'; w.approvedBy = 'Quản trị viên Phạm Thu Hương'; return { msg: 'Đã duyệt yêu cầu của ' + w.name };
        },
        afterConflict: () => { w.status = 'APPROVED'; w.approvedBy = 'Quản trị viên Đoàn Minh Tâm'; w.conflict = false; toast('Đã tải lại: yêu cầu của ' + w.name + ' đã ở trạng thái “Đã duyệt”'); rerender(); } });
    } else {
      openDialog({ title: 'Xác nhận đã chuyển khoản', ok: 'Xác nhận đã chuyển', tone: 'danger', needRef: true, body: sum + '<div class="muted small">Nhận tại: ' + esc(w.bank) + '</div><div class="field"><label for="dlgRef">Mã tham chiếu ngân hàng</label><input id="dlgRef" autocomplete="off" placeholder="Ví dụ: FT26102612345678"><div class="errt" id="refErr"></div></div><div class="callout danger">' + ic('tri', 16) + '<div>Thao tác này ghi <b>tiền đã rời nền tảng</b> và <b>không hoàn tác được</b>.</div></div>',
        run: (v) => { w.status = 'PAID'; w.ref = v; w.paidAt = vnow(); return { msg: 'Đã ghi nhận chuyển khoản ' + fm(w.amount) + ' cho ' + w.name }; } });
    }
  }

  // ---------- Vẽ trang ----------
  function curKey() { return st.pageKey; }
  function fixScroll() { $$('.tw, pre.tech').forEach((el) => { el.tabIndex = 0; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Bảng dữ liệu, cuộn ngang được'); }); }
  function render(animate) {
    const key = st.pageKey, main = $('#main'), y = window.scrollY;
    let body;
    if (st.scenario === 'forbidden') body = '<div class="page content">' + forbidden() + '</div>';
    else body = key === 'overview' ? pageOverview() : key === 'finance' ? pageFinance() : key === 'finance/reconciliation' ? pageRecon() : key === 'finance/transactions' ? pageTx() : pageWd();
    main.innerHTML = header(key) + body;
    if (!animate) { const p = $('.page', main); if (p) p.style.animation = 'none'; }
    updateSidebar(PAGES[key].nav); posTabInd(animate); drawChart(); fixScroll();
    if (key === 'finance/reconciliation' && st.q.get('tab') === 'gateway' && st.sel && isOk()) selectGw(st.sel.side, st.sel.id);
    if (!animate) window.scrollTo(0, y);
    renderProto();
  }
  const rerender = () => render(false);
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, ''), i = raw.indexOf('?');
    const path = i < 0 ? raw : raw.slice(0, i), q = new URLSearchParams(i < 0 ? '' : raw.slice(i + 1));
    return { segs: path.split('/').filter(Boolean), q };
  }
  function route() {
    const { segs, q } = parseHash();
    const key = !segs.length ? 'overview' : segs[0] === 'finance' ? ['finance', segs[1]].filter(Boolean).join('/') : segs[0];
    if (!PAGES[key]) { location.replace('#/overview'); return; }
    const txId = key === 'finance/transactions' && segs[2] ? segs[2] : null;
    const qs = q.toString(), same = st.pageKey === key;
    st.q = q; st.navOpen = false; $('#sidebar').classList.remove('open'); $('#mscrim').classList.remove('on');
    if (same && key === 'finance/transactions' && $('#txWrap')) { if (qs !== st.lastQs) { st.lastQs = qs; updateTxTable(); } syncDrawer(txId); return; }
    if (same && qs === st.lastQs && key !== 'finance/transactions') { syncDrawer(null); return; }
    const prev = st.pageKey; st.pageKey = key; st.lastQs = qs;
    if (st.drawerTx && !txId) closeDrawer(false);
    render(!same || prev == null);
    syncDrawer(txId);
    if (!same) window.scrollTo(0, 0);
  }
  function setQ(k, v) {
    const q = new URLSearchParams(st.q); if (v) q.set(k, v); else q.delete(k); if (k !== 'page') q.delete('page');
    const base = '#/' + st.pageKey, s = q.toString(); location.hash = base + (s ? '?' + s : '');
  }
  function listHash() { const s = st.q.toString(); return '#/finance/transactions' + (s ? '?' + s : ''); }
  function doRefresh(done) {
    st.retrying = true; const b = $('#refreshBtn'); if (b) b.classList.add('spin'); rerender();
    setTimeout(() => { st.retrying = false; st.updAt = vnow(); st.rev++; if (st.scenario === 'stale') st.scenario = 'normal'; rerender(); if (isOk()) toast('Đã làm mới dữ liệu'); done && done(); }, 600);
  }

  // ---------- Sự kiện ----------
  function visible(el) { return el.getClientRects().length > 0; }
  function trap(e, c) {
    const f = $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', c).filter(visible); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !c.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !c.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  function copyText(v) { try { navigator.clipboard.writeText(v).catch(() => {}); } catch (e) { /* bỏ qua */ } toast('Đã sao chép'); }
  document.addEventListener('click', (ev) => {
    const dl = ev.target.closest('[data-dlg]');
    if (dl) { if (dl.dataset.dlg === 'cancel') closeDialog(); else dlgSubmit(); return; }
    if (ev.target.classList && ev.target.classList.contains('dlg-wrap') && st.dlg && !st.dlg.busy) { closeDialog(); return; }
    if (ev.target.id === 'scrim') { location.hash = listHash(); return; }
    if (ev.target.id === 'mscrim') { toggleNav(false); return; }
    const nav = ev.target.closest('.nav-item[data-oos]');
    if (nav) { ev.preventDefault(); toggleNav(false); toast(nav.dataset.oos === 'refund' ? 'Hoàn tiền nằm ngoài phạm vi prototype' : 'Màn này giữ nguyên chức năng hiện tại, chỉ đổi vị trí điều hướng'); return; }
    const a = ev.target.closest('[data-act]');
    if (!a) {
      const row = ev.target.closest('tr[data-tx]'); if (row) { location.hash = '#/finance/transactions/' + row.dataset.tx + (st.q.toString() ? '?' + st.q.toString() : ''); return; }
      if (st.popCols && !ev.target.closest('.pop')) { st.popCols = false; const p = $('.pop'); if (p) p.remove(); }
      return;
    }
    const act = a.dataset.act, v = a.dataset.v;
    switch (act) {
      case 'copy': ev.stopPropagation(); copyText(v); break;
      case 'refresh': doRefresh(); break;
      case 'retry': doRefresh(); break;
      case 'theme': st.theme = st.theme === 'dark' ? 'light' : 'dark'; applyTheme(); rerender(); break;
      case 'collapse': st.collapsed = !st.collapsed; lsSet('collapsed', st.collapsed ? '1' : '0'); updateSidebar(PAGES[st.pageKey].nav); setTimeout(() => { posTabInd(); drawChart(); }, 260); break;
      case 'hamb': toggleNav(true); break;
      case 'protomin': st.protoMin = !st.protoMin; renderProto(); break;
      case 'scen': st.scenario = v; st.retrying = false; if (v === 'stale') st.updAt = D.NOW; rerender(); if (st.drawerTx) { const id = st.drawerTx; openDrawer(id); } break;
      case 'togglesrc': st.showSrc = !st.showSrc; document.body.classList.toggle('show-src', st.showSrc); renderProto(); break;
      case 'queue': { const q = queueList().find((x) => x.id === a.dataset.id); if (q.route) location.hash = q.route; else toast('Màn này giữ nguyên chức năng hiện tại, chỉ đổi vị trí điều hướng'); break; }
      case 'period': case 'group': {
        if (act === 'period') st.period = v; else st.group = v;
        $$('[data-act="' + act + '"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
        if (act === 'period' && (v === 'custom' || $('#cFrom'))) { rerender(); } else reloadPeriod();
        break;
      }
      case 'tbl': st.tableOpen = !st.tableOpen; $('#serTbl').classList.toggle('open', st.tableOpen); a.setAttribute('aria-expanded', String(st.tableOpen)); a.innerHTML = ic(st.tableOpen ? 'chevD' : 'chevR', 13) + (st.tableOpen ? 'Thu gọn bảng theo kỳ' : 'Xem bảng theo kỳ'); break;
      case 'rtab': { const q = new URLSearchParams(st.q); q.set('tab', v); location.hash = '#/finance/reconciliation?' + q.toString(); break; }
      case 'expl': st.explOpen = !st.explOpen; $('#expl').classList.toggle('open', st.explOpen); a.setAttribute('aria-expanded', String(st.explOpen)); a.innerHTML = ic(st.explOpen ? 'chevD' : 'chevR', 13) + 'Quy tắc cân đối là gì?'; break;
      case 'exg': { const id = a.dataset.id; st.expOpen[id] = !st.expOpen[id]; const g = a.closest('.exgroup'); g.classList.toggle('open', st.expOpen[id]); $('.reveal', g).classList.toggle('open', st.expOpen[id]); a.setAttribute('aria-expanded', String(st.expOpen[id])); break; }
      case 'exall': st.expAll[a.dataset.id] = true; rerender(); break;
      case 'gwsel': selectGw(a.dataset.side, a.dataset.id); break;
      case 'gwside': st.side = v; rerender(); break;
      case 'filt': setQ(a.dataset.k, v); break;
      case 'clearf': location.hash = '#/finance/transactions'; break;
      case 'page': setQ('page', v === '1' ? '' : v); break;
      case 'cols': st.popCols = !st.popCols; rerender(); break;
      case 'tech': st.techOpen = !st.techOpen; $('#techBox').classList.toggle('open', st.techOpen); a.setAttribute('aria-expanded', String(st.techOpen)); a.innerHTML = ic(st.techOpen ? 'chevD' : 'chevR', 13) + 'Chi tiết kỹ thuật'; break;
      case 'dclose': location.hash = listHash(); break;
      case 'userc': toast('Tài khoản và đăng xuất nằm ngoài phạm vi prototype'); break;
      case 'post': st.postOpen = !st.postOpen; $('#postBox').classList.toggle('open', st.postOpen); a.setAttribute('aria-expanded', String(st.postOpen)); a.innerHTML = ic(st.postOpen ? 'chevD' : 'chevR', 13) + (st.postOpen ? 'Thu gọn bút toán' : 'Xem ' + $$('#postBox tbody tr').length + ' bút toán'); break;
      case 'gwjump': st.sel = { side: 'gym', id: a.dataset.id }; location.hash = '#/finance/reconciliation?tab=gateway'; break;
      case 'wdtab': { location.hash = '#/finance/withdrawals?s=' + v; break; }
      case 'wdapprove': wdDialog('approve', a.dataset.id); break;
      case 'wdpay': wdDialog('pay', a.dataset.id); break;
      default: break;
    }
  });
  function reloadPeriod() {
    const w = $('#periodInner'); if (!w) return;
    w.style.minHeight = w.offsetHeight + 'px'; w.classList.add('is-loading');
    clearTimeout(st.pT); st.pT = setTimeout(() => { w.innerHTML = blk(520, 'số liệu trong kỳ', periodInner); fixScroll(); w.classList.remove('is-loading'); w.style.minHeight = ''; drawChart(); }, 450);
  }
  function toggleNav(open) {
    st.navOpen = open; $('#sidebar').classList.toggle('open', open); $('#mscrim').classList.toggle('on', open);
    if (open) setTimeout(() => { const f = $('.nav-item[aria-current="page"]') || $('.nav-item'); if (f) f.focus(); }, 40); else { const h = $('.hamb'); if (h && visible(h)) h.focus(); }
  }
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'cFrom' || t.id === 'cTo') { st.cFrom = $('#cFrom').value || st.cFrom; st.cTo = $('#cTo').value || st.cTo; reloadPeriod(); }
    if (t.dataset && t.dataset.col) { st.cols[t.dataset.col] = t.checked; updateTxTable(); }
  });
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (ev.key === 'Escape') {
      if (st.dlg) { if (!st.dlg.busy) closeDialog(); ev.preventDefault(); return; }
      if (st.drawerTx) { location.hash = listHash(); ev.preventDefault(); return; }
      if (st.navOpen) { toggleNav(false); return; }
      if (st.popCols) { st.popCols = false; rerender(); return; }
    }
    if (ev.key === 'Tab') {
      if (st.dlg) trap(ev, $('.dlg')); else if (st.drawerTx) trap(ev, $('#drawer')); else if (st.navOpen) trap(ev, $('#sidebar'));
    }
    if (ev.key === 'Enter' || ev.key === ' ') {
      if (t.matches && t.matches('tr[data-tx]')) { ev.preventDefault(); location.hash = '#/finance/transactions/' + t.dataset.tx + (st.q.toString() ? '?' + st.q.toString() : ''); return; }
      if (ev.key === 'Enter' && t.id === 'txSearch') { setQ('q', t.value.trim()); return; }
      if (ev.key === 'Enter' && st.dlg && t.id === 'dlgRef') { dlgSubmit(); return; }
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
      const tl = t.closest && t.closest('[role="tablist"]'); if (!tl) return;
      const tabs = $$('[role="tab"]', tl), i = tabs.indexOf(t); if (i < 0) return; ev.preventDefault();
      const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const nt = tabs[n];
      if (nt.dataset.tab) { const id = nt.id; location.hash = nt.getAttribute('href'); setTimeout(() => { const x = document.getElementById(id); if (x) x.focus(); }, 30); }
      else { const v = nt.dataset.v; nt.click(); setTimeout(() => { const x = $('#rtabs [data-v="' + v + '"]'); if (x) x.focus(); }, 30); }
    }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('tr[data-seg]')) ev.preventDefault(); });
  // rê chuột / focus: bản đồ tiền + biểu đồ
  function segOn(key, on) {
    $$('[data-seg]').forEach((x) => x.classList.toggle('on', on && x.dataset.seg === key));
    const bar = $('#mmBar'); if (bar) bar.classList.toggle('dim', on);
  }
  document.addEventListener('mouseover', (ev) => { const s = ev.target.closest('[data-seg]'); if (s) segOn(s.dataset.seg, true); const g = ev.target.closest('.bargrp'); if (g) showTip(g); });
  document.addEventListener('mouseout', (ev) => { const s = ev.target.closest('[data-seg]'); if (s) segOn(null, false); if (ev.target.closest('.bargrp')) hideTip(); });
  document.addEventListener('focusin', (ev) => { const s = ev.target.closest('[data-seg]'); if (s) segOn(s.dataset.seg, true); const g = ev.target.closest('.bargrp'); if (g) showTip(g); });
  document.addEventListener('focusout', (ev) => { if (ev.target.closest('[data-seg]')) segOn(null, false); if (ev.target.closest('.bargrp')) hideTip(); });
  function showTip(g) {
    const x = st._ser[+g.dataset.i], tip = $('#chartTip'), box = $('#chartBox'); if (!x || !tip) return;
    tip.innerHTML = '<b>' + esc(x.label) + '</b><div class="r"><span>Tiền vào</span><span>' + fm(x.income) + '</span></div><div class="r"><span>Tiền ra</span><span>' + fm(x.expense) + '</span></div><div class="r"><span>Doanh thu</span><span>' + fm(x.net) + '</span></div>';
    const gb = g.getBoundingClientRect(), bb = box.getBoundingClientRect();
    let left = gb.left - bb.left + gb.width / 2 - 90; left = Math.max(0, Math.min(bb.width - 180, left));
    tip.style.left = left + 'px'; tip.style.top = '8px'; tip.classList.add('on');
  }
  function hideTip() { const t = $('#chartTip'); if (t) t.classList.remove('on'); }
  window.addEventListener('hashchange', route);
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawChart(); posNavInd(); posTabInd(); }, 120); });

  // ---------- Khởi động ----------
  applyTheme(); buildSidebar(); renderProto();
  if (!location.hash) location.replace('#/overview');
  route();
  window.__proto = { st, route };
})();
