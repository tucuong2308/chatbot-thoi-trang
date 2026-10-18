/**
 * Nối Google Sheets (bản gốc danh mục) với chatbot trên Cloudflare Worker.
 * Dán file này vào Tiện ích > Apps Script của bảng tính, xem apps-script/README.md.
 *
 * Menu "Bot":
 *  - Đồng bộ ngay: gửi SanPham, BienThe, BangSize lên Worker; ô lỗi được tô đỏ kèm ghi chú; ghi một dòng vào NhatKy.
 *  - Xem tiến độ: số món đang chờ tải ảnh / tạo vector và các món bị lỗi.
 *  - Cập nhật danh sách giá trị: dựng lại trang DanhMuc và danh sách thả xuống từ danh sách của bot.
 *  - Bật / tắt tự đồng bộ: cứ 5 phút gửi lên nếu có ô bị sửa.
 */

const TRANG_SAN_PHAM = 'SanPham';
const TRANG_BIEN_THE = 'BienThe';
const TRANG_BANG_SIZE = 'BangSize';
const TRANG_DANH_MUC = 'DanhMuc';
const TRANG_NHAT_KY = 'NhatKy';
const TRANG_DON_HANG = 'DonHang';
// Cột trang DonHang. trang_thai là của nhân viên: bot chỉ ghi lúc thêm dòng, không bao giờ ghi đè.
const COT_DON = ['ma_don', 'thoi_gian', 'ten', 'sdt', 'dia_chi', 'cac_mon', 'tien_hang', 'ghi_chu', 'trang_thai', 'khach_huy', 'hoi_thoai'];
/** Dòng 1 là tên cột, dòng 2 là giải thích (như file mẫu); dữ liệu bắt đầu từ dòng 3. */
const DONG_DAU = 3;
const MAU_LOI = '#f4cccc';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bot')
    .addItem('Đồng bộ ngay', 'dongBoNgay')
    .addItem('Xem tiến độ tải ảnh, tạo vector', 'xemTienDo')
    .addItem('Lấy đơn mới ngay', 'layDonNgay')
    .addSeparator()
    .addItem('Cập nhật danh sách giá trị', 'capNhatDanhMuc')
    .addItem('Bật tự đồng bộ (5 phút)', 'batTuDongBo')
    .addItem('Tắt tự đồng bộ', 'tatTuDongBo')
    .addSeparator()
    .addItem('Cài đặt kết nối', 'caiDat')
    .addToUi();
}

/** Sửa ô nào ở 3 trang dữ liệu thì đánh dấu để lần tự đồng bộ tới gửi lên; ở SanPham thì tự điền mã cho món mới. */
function onEdit(e) {
  const sh = e.range.getSheet();
  const ten = sh.getName();
  if ([TRANG_SAN_PHAM, TRANG_BIEN_THE, TRANG_BANG_SIZE].indexOf(ten) < 0) return;
  PropertiesService.getDocumentProperties().setProperty('CO_THAY_DOI', '1');
  if (ten === TRANG_SAN_PHAM) tuSinhMa_(sh, e.range);
}

// ---------------- Kết nối ----------------

function caiDat() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const url = ui.prompt('Địa chỉ Worker', 'VD https://chatbot-thoi-trang.ten.workers.dev\nĐang dùng: ' +
    (props.getProperty('WORKER_URL') || '(chưa đặt)'), ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  const key = ui.prompt('ADMIN_KEY', 'Khóa quản trị của bot (giống ADMIN_KEY đã đặt bằng wrangler secret).\n' +
    'Lưu trong Script Properties, không ghi vào ô nào.', ui.ButtonSet.OK_CANCEL);
  if (key.getSelectedButton() !== ui.Button.OK) return;
  const email = ui.prompt('Email nhận báo đơn mới', 'Để trống thì giữ: ' + emailThongBao_(), ui.ButtonSet.OK_CANCEL);
  if (email.getSelectedButton() !== ui.Button.OK) return;
  if (url.getResponseText().trim()) props.setProperty('WORKER_URL', url.getResponseText().trim().replace(/\/$/, ''));
  if (key.getResponseText().trim()) props.setProperty('ADMIN_KEY', key.getResponseText().trim());
  if (email.getResponseText().trim()) props.setProperty('EMAIL_THONG_BAO', email.getResponseText().trim());
  const kq = goi_('/admin/trang-thai', {});
  ui.alert('Đã kết nối. Bot đang có ' + kq.tong_mon + ' món.');
}

/** Gọi một đường dẫn /admin/... của Worker, trả về JSON; lỗi thì ném Error có thông báo của Worker. */
function goi_(duongDan, duLieu) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('WORKER_URL');
  const key = props.getProperty('ADMIN_KEY');
  if (!url || !key) throw new Error('Chưa cài đặt kết nối: vào menu Bot > Cài đặt kết nối.');
  const res = UrlFetchApp.fetch(url + duongDan, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-admin-key': key },
    payload: JSON.stringify(duLieu),
    muteHttpExceptions: true,
  });
  const text = res.getContentText();
  let json;
  try { json = JSON.parse(text); } catch (err) { json = null; }
  if (res.getResponseCode() !== 200) {
    throw new Error('Bot báo lỗi ' + res.getResponseCode() + ': ' + ((json && json.loi) || text.slice(0, 300)));
  }
  return json;
}

// ---------------- Đồng bộ ----------------

function dongBoNgay() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Đang gửi dữ liệu lên bot...', 'Bot', 30);
  try {
    const kq = dongBo_(true);
    ss.toast(kq.san_pham + ' món, ' + kq.o_loi.length + ' ô lỗi, ' + kq.dang_xu_ly + ' món đang tải ảnh / tạo vector.',
      'Đồng bộ xong', 10);
  } catch (err) {
    ghiNhatKy_({ loi: err.message });
    SpreadsheetApp.getUi().alert('Đồng bộ lỗi: ' + err.message);
  }
}

/** Chạy theo lịch: luôn lấy đơn mới; danh mục chỉ gửi khi có ô bị sửa kể từ lần trước. */
function tuDongBo() {
  try {
    keoDonHang_();
  } catch (err) {
    ghiNhatKy_({ loi: 'Lấy đơn: ' + err.message });
  }
  const props = PropertiesService.getDocumentProperties();
  if (props.getProperty('CO_THAY_DOI') !== '1') return;
  try {
    dongBo_(false);
  } catch (err) {
    ghiNhatKy_({ loi: err.message });
  }
}

/** thuLaiLoi: thử lại cả các món đã lỗi mà chưa sửa (VD vừa mở quyền chia sẻ ảnh trên Drive). */
function dongBo_(thuLaiLoi) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30 * 1000)) throw new Error('Đang có một lần đồng bộ khác chạy, thử lại sau ít phút.');
  try {
    // Xóa dấu trước khi đọc: ô sửa trong lúc đang gửi sẽ được gửi ở lần sau.
    PropertiesService.getDocumentProperties().deleteProperty('CO_THAY_DOI');
    const duLieu = {
      san_pham: docTrang_(TRANG_SAN_PHAM),
      bien_the: docTrang_(TRANG_BIEN_THE),
      bang_size: docTrang_(TRANG_BANG_SIZE),
      thu_lai_loi: thuLaiLoi,
    };
    const kq = goi_('/admin/import', duLieu);
    toLoi_(kq.o_loi || []);
    ghiNhatKy_(kq);
    return kq;
  } catch (err) {
    PropertiesService.getDocumentProperties().setProperty('CO_THAY_DOI', '1'); // lỗi thì lần sau gửi lại
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Đọc một trang thành mảng {tên cột: giá trị đang hiển thị}; bỏ dòng trống. Worker tự bỏ dòng giải thích. */
function docTrang_(ten) {
  const sh = SpreadsheetApp.getActive().getSheetByName(ten);
  if (!sh) return [];
  const values = sh.getDataRange().getDisplayValues();
  const header = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1)
    .filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
    .map(function (r) {
      const o = {};
      header.forEach(function (h, i) { if (h) o[h] = r[i]; });
      return o;
    });
}

// ---------------- Đơn hàng ----------------

function layDonNgay() {
  try {
    const moi = keoDonHang_();
    SpreadsheetApp.getActive().toast(moi + ' đơn mới.', 'Đơn hàng', 5);
  } catch (err) {
    SpreadsheetApp.getUi().alert('Lấy đơn lỗi: ' + err.message);
  }
}

function emailThongBao_() {
  return PropertiesService.getScriptProperties().getProperty('EMAIL_THONG_BAO') || Session.getEffectiveUser().getEmail();
}

/**
 * Kéo đơn mới / vừa bị khách hủy về trang DonHang. Đơn mới thêm lên đầu và gửi email; đơn đã có chỉ cập nhật cột
 * khach_huy và tô đỏ cả dòng. Trả về số đơn mới. Con trỏ chỉ lưu sau khi đã ghi xong, nên lỗi giữa chừng thì lần sau
 * kéo lại (đơn đã có được bỏ qua theo mã).
 */
function keoDonHang_() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30 * 1000)) throw new Error('Đang có một lần lấy đơn / đồng bộ khác chạy.');
  try {
    const docProps = PropertiesService.getDocumentProperties();
    const kq = goi_('/admin/don-hang', { tu: Number(docProps.getProperty('CON_TRO_DON') || 0) });
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(TRANG_DON_HANG);
    if (!sh) {
      sh = ss.insertSheet(TRANG_DON_HANG);
      sh.getRange(1, 1, 1, COT_DON.length).setValues([COT_DON]);
      sh.setFrozenRows(1);
      sh.getRange('1:1').setFontWeight('bold');
    }
    const cotHuy = COT_DON.indexOf('khach_huy') + 1;
    const dongCua = function () {
      const out = {};
      if (sh.getLastRow() < 2) return out;
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r, i) { out[r[0]] = i + 2; });
      return out;
    };
    const daCo = dongCua();
    const moi = [];
    kq.don.forEach(function (d) {
      if (daCo[d.ma_don] || moi.some(function (m) { return m.ma_don === d.ma_don; })) return;
      moi.push(d);
    });
    if (moi.length) {
      sh.insertRowsAfter(1, moi.length);
      const vung = sh.getRange(2, 1, moi.length, COT_DON.length);
      vung.setValues(moi.slice().reverse().map(function (d) { return COT_DON.map(function (c) { return d[c]; }); }));
      vung.setFontWeight('normal').setBackground(null); // dòng chèn dưới tiêu đề kế thừa chữ đậm
      sh.getRange(2, COT_DON.indexOf('hoi_thoai') + 1, moi.length, 1).setWrap(true);
    }
    // Đơn đã có (kể cả vừa thêm) mà khách hủy: ghi lúc hủy, tô đỏ dòng.
    const dong = dongCua();
    kq.don.forEach(function (d) {
      if (!d.khach_huy || !dong[d.ma_don]) return;
      sh.getRange(dong[d.ma_don], cotHuy).setValue(d.khach_huy);
      sh.getRange(dong[d.ma_don], 1, 1, COT_DON.length).setBackground(MAU_LOI);
    });
    docProps.setProperty('CON_TRO_DON', String(kq.con_tro));
    moi.forEach(guiEmailDon_);
    return moi.length;
  } finally {
    lock.releaseLock();
  }
}

function guiEmailDon_(d) {
  MailApp.sendEmail({
    to: emailThongBao_(),
    subject: 'Đơn mới ' + d.ma_don + ' · ' + Number(d.tien_hang).toLocaleString('de-DE') + 'đ',
    body: [
      'Khách: ' + d.ten + ' · ' + d.sdt,
      'Địa chỉ: ' + d.dia_chi,
      'Món: ' + d.cac_mon,
      'Tiền hàng: ' + Number(d.tien_hang).toLocaleString('de-DE') + 'đ (chưa gồm phí ship, thu COD)',
    ].concat(d.ghi_chu ? ['Ghi chú: ' + d.ghi_chu] : [])
      .concat(['', 'Xem trang DonHang: ' + SpreadsheetApp.getActive().getUrl()]).join('\n'),
  });
}

// ---------------- Tô ô lỗi ----------------

/** Bỏ màu và ghi chú của các ô lỗi lần trước, rồi tô các ô lỗi lần này. */
function toLoi_(oLoi) {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getDocumentProperties();
  const cu = JSON.parse(props.getProperty('O_LOI') || '[]');
  cu.forEach(function (o) {
    const sh = ss.getSheetByName(o.trang);
    if (sh) sh.getRange(o.a1).setBackground(null).clearNote();
  });

  const daTo = [];
  const theoTrang = {};
  oLoi.forEach(function (o) { (theoTrang[o.trang] = theoTrang[o.trang] || []).push(o); });
  Object.keys(theoTrang).forEach(function (ten) {
    const sh = ss.getSheetByName(ten);
    if (!sh) return;
    const values = sh.getDataRange().getDisplayValues();
    const header = values[0].map(function (h) { return String(h).trim(); });
    // SanPham tìm dòng theo ma_sp; BienThe theo ma_bien_the (không có thì theo ma_sp).
    const cotMa = ten === TRANG_SAN_PHAM ? header.indexOf('ma_sp') : header.indexOf('ma_bien_the');
    const cotMaSp = header.indexOf('ma_sp');
    const ghiChu = {};
    theoTrang[ten].forEach(function (o) {
      const cot = header.indexOf(o.cot);
      if (cot < 0) return;
      for (let i = 1; i < values.length; i++) {
        const ma = String(values[i][cotMa] || values[i][cotMaSp] || '').trim();
        if (ma !== o.ma) continue;
        const a1 = sh.getRange(i + 1, cot + 1).getA1Notation();
        ghiChu[a1] = (ghiChu[a1] ? ghiChu[a1] + '\n' : '') + o.loi;
        // "trùng mã": tô mọi dòng mang mã đó để chủ shop thấy cả hai; lỗi khác chỉ tô dòng đầu tiên khớp.
        if (o.loi.indexOf('trùng mã') < 0) break;
      }
    });
    Object.keys(ghiChu).forEach(function (a1) {
      sh.getRange(a1).setBackground(MAU_LOI).setNote('Bot: ' + ghiChu[a1]);
      daTo.push({ trang: ten, a1: a1 });
    });
  });
  props.setProperty('O_LOI', JSON.stringify(daTo));
}

// ---------------- Nhật ký, tiến độ ----------------

function ghiNhatKy_(kq) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TRANG_NHAT_KY);
  if (!sh) {
    sh = ss.insertSheet(TRANG_NHAT_KY);
    sh.appendRow(['Thời gian', 'Số món', 'Biến thể', 'Bảng size', 'Ô lỗi', 'Đang tải ảnh / tạo vector', 'Chi tiết']);
    sh.setFrozenRows(1);
    sh.getRange('1:1').setFontWeight('bold');
  }
  const chiTiet = kq.loi ? 'LỖI: ' + kq.loi : (kq.canh_bao || []).slice(0, 30).join('\n');
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 7).setValues([[new Date(), kq.san_pham || '', kq.bien_the || '', kq.bang_size || '',
    kq.o_loi ? kq.o_loi.length : '', kq.dang_xu_ly === undefined ? '' : kq.dang_xu_ly, chiTiet]]);
  if (sh.getLastRow() > 501) sh.deleteRows(502, sh.getLastRow() - 501); // giữ 500 lần gần nhất
}

function xemTienDo() {
  const kq = goi_('/admin/trang-thai', {});
  const dong = ['Tổng số món: ' + kq.tong_mon, 'Đang chờ tải ảnh / tạo vector: ' + kq.cho_xu_ly,
    'Đồng bộ lần cuối: ' + (kq.dong_bo_lan_cuoi || 'chưa')];
  if (kq.loi.length) {
    dong.push('', 'Món bị lỗi (sửa link ảnh hoặc quyền chia sẻ, rồi bấm Đồng bộ ngay):');
    kq.loi.slice(0, 20).forEach(function (l) { dong.push('- ' + l.ma_sp + ': ' + l.loi); });
  }
  SpreadsheetApp.getUi().alert(dong.join('\n'));
}

// ---------------- Danh sách giá trị, mã sản phẩm ----------------

/** Dựng lại trang DanhMuc từ danh sách của bot và gắn danh sách thả xuống cho các cột một giá trị. */
function capNhatDanhMuc() {
  const kq = goi_('/admin/danh-sach', {});
  const ss = SpreadsheetApp.getActive();
  const dm = ss.getSheetByName(TRANG_DANH_MUC) || ss.insertSheet(TRANG_DANH_MUC);
  const cot = Object.assign({}, kq.mot_gia_tri, kq.nhieu_gia_tri, { trang_thai: kq.trang_thai, size: kq.size });
  const ten = Object.keys(cot);
  const dai = Math.max.apply(null, ten.map(function (t) { return cot[t].length; }));
  const bang = [ten].concat(Array.from({ length: dai }, function (_, i) {
    return ten.map(function (t) { return cot[t][i] || ''; });
  }));
  dm.clearContents();
  dm.getRange(1, 1, bang.length, ten.length).setValues(bang);
  dm.getRange('1:1').setFontWeight('bold');

  const vungCua = function (t) {
    const c = ten.indexOf(t) + 1;
    return dm.getRange(2, c, cot[t].length, 1);
  };
  ganThaXuong_(TRANG_SAN_PHAM, Object.keys(kq.mot_gia_tri).concat(['trang_thai']), vungCua, false);
  ganThaXuong_(TRANG_BIEN_THE, ['size'], vungCua, false);
  // Cột nhiều giá trị (dip, chi_tiet) gõ cách nhau dấu phẩy: chỉ nhắc danh sách, không chặn.
  const sp = ss.getSheetByName(TRANG_SAN_PHAM);
  const header = sp.getRange(1, 1, 1, sp.getLastColumn()).getDisplayValues()[0];
  Object.keys(kq.nhieu_gia_tri).forEach(function (t) {
    const c = header.indexOf(t) + 1;
    if (!c) return;
    sp.getRange(DONG_DAU, c, sp.getMaxRows() - DONG_DAU + 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireFormulaSatisfied('=TRUE').setAllowInvalid(true)
        .setHelpText('Nhiều giá trị, cách nhau dấu phẩy. Chọn trong: ' + kq.nhieu_gia_tri[t].join(', ')).build());
  });
  SpreadsheetApp.getActive().toast('Đã cập nhật DanhMuc và danh sách thả xuống.', 'Bot', 5);
}

function ganThaXuong_(tenTrang, cacCot, vungCua, choPhepLa) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tenTrang);
  if (!sh) return;
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  cacCot.forEach(function (t) {
    const c = header.indexOf(t) + 1;
    if (!c) return;
    sh.getRange(DONG_DAU, c, sh.getMaxRows() - DONG_DAU + 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(vungCua(t), true).setAllowInvalid(choPhepLa).build());
  });
}

/** Món mới: đã có tên mà chưa có mã thì tự điền mã kế tiếp (SP + số lớn nhất hiện có + 1). */
function tuSinhMa_(sh, range) {
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const cotMa = header.indexOf('ma_sp') + 1;
  const cotTen = header.indexOf('ten_sp') + 1;
  if (!cotMa || !cotTen) return;
  const dau = Math.max(range.getRow(), DONG_DAU);
  const cuoi = range.getLastRow();
  if (cuoi < dau) return;
  let lonNhat = null;
  for (let r = dau; r <= cuoi; r++) {
    if (!String(sh.getRange(r, cotTen).getDisplayValue()).trim() || String(sh.getRange(r, cotMa).getDisplayValue()).trim()) continue;
    if (lonNhat === null) {
      lonNhat = 0;
      sh.getRange(DONG_DAU, cotMa, Math.max(sh.getLastRow() - DONG_DAU + 1, 1), 1).getDisplayValues().forEach(function (v) {
        const m = String(v[0]).match(/^SP(\d+)$/);
        if (m) lonNhat = Math.max(lonNhat, Number(m[1]));
      });
    }
    lonNhat++;
    sh.getRange(r, cotMa).setValue('SP' + String(lonNhat).padStart(4, '0'));
  }
}

// ---------------- Lịch tự đồng bộ ----------------

function batTuDongBo() {
  tatTuDongBo(true);
  ScriptApp.newTrigger('tuDongBo').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActive().toast('Cứ 5 phút: lấy đơn mới, và nếu có ô bị sửa thì gửi lên bot.', 'Đã bật tự đồng bộ', 5);
}

function tatTuDongBo(imLang) {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'tuDongBo'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  if (imLang !== true) SpreadsheetApp.getActive().toast('Đã tắt tự đồng bộ.', 'Bot', 5);
}
