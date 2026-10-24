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
/** Chính sách, địa chỉ, giờ làm việc... (cột chu_de, noi_dung) để bot trả lời câu hỏi về shop. Không bắt buộc. */
const TRANG_THONG_TIN = 'ThongTinShop';
const TRANG_DANH_MUC = 'DanhMuc';
const TRANG_NHAT_KY = 'NhatKy';
const TRANG_DON_HANG = 'DonHang';
// Cột trang DonHang. trang_thai là của nhân viên: bot chỉ ghi lúc thêm dòng, không bao giờ ghi đè.
const COT_DON = ['ma_don', 'thoi_gian', 'ten', 'sdt', 'dia_chi', 'cac_mon', 'tien_hang', 'ghi_chu', 'trang_thai', 'khach_huy', 'hoi_thoai'];
const COT_CHU_DON = ['ma_don', 'thoi_gian', 'sdt', 'khach_huy'];
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
  try { tuTrinhBay_(); } catch (e) { console.warn('Trình bày bảng tính: ' + e.message); }
}

/** Sửa ô nào ở các trang dữ liệu thì đánh dấu để lần tự đồng bộ tới gửi lên; ở SanPham thì tự điền mã cho món mới. */
function onEdit(e) {
  const sh = e.range.getSheet();
  const ten = sh.getName();
  if ([TRANG_SAN_PHAM, TRANG_BIEN_THE, TRANG_BANG_SIZE, TRANG_THONG_TIN].indexOf(ten) < 0) return;
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
  let diaChi = url.getResponseText().trim().replace(/\/+$/, '');
  if (diaChi && !/^https?:\/\//i.test(diaChi)) diaChi = 'https://' + diaChi;
  if (diaChi && !/^https?:\/\/[^\/]+\.[^\/]+$/i.test(diaChi)) {
    ui.alert('Địa chỉ "' + diaChi + '" chưa đủ. Cần dán nguyên địa chỉ, VD https://chatbot-thoi-trang.ten.workers.dev');
    return;
  }
  if (diaChi) props.setProperty('WORKER_URL', diaChi);
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
    // Chưa có trang ThongTinShop thì không gửi, bot giữ nguyên thông tin cũ.
    if (SpreadsheetApp.getActive().getSheetByName(TRANG_THONG_TIN)) duLieu.thong_tin_shop = docTrang_(TRANG_THONG_TIN);
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
      sh.getRange(1, 1, 1, COT_DON.length).setValues([COT_DON.map(function (c) { return TEN_COT_DON[c]; })]);
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
      // Ghi dạng chữ, không thì Sheets bỏ số 0 đầu số điện thoại và đọc dd/MM theo locale của bảng tính.
      COT_CHU_DON.forEach(function (c) { sh.getRange(2, COT_DON.indexOf(c) + 1, moi.length, 1).setNumberFormat('@'); });
      const vung = sh.getRange(2, 1, moi.length, COT_DON.length);
      vung.setValues(moi.slice().reverse().map(function (d) { return COT_DON.map(function (c) { return d[c]; }); }));
    }
    // Đơn đã có (kể cả vừa thêm) mà khách hủy: ghi lúc hủy (cả dòng tự đỏ nhạt nhờ định dạng có điều kiện).
    const dong = dongCua();
    let coHuy = false;
    kq.don.forEach(function (d) {
      if (!d.khach_huy || !dong[d.ma_don]) return;
      sh.getRange(dong[d.ma_don], cotHuy).setNumberFormat('@').setValue(d.khach_huy);
      coHuy = true;
    });
    // Dòng chèn dưới tiêu đề kế thừa kiểu của tiêu đề, nên trình bày lại cả trang.
    if (moi.length || coHuy || sh.getLastRow() < 2) lamDepTrang_(sh);
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
  }
  const chiTiet = kq.loi ? 'LỖI: ' + kq.loi : (kq.canh_bao || []).slice(0, 30).join('\n');
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 7).setValues([[new Date(), kq.san_pham || '', kq.bien_the || '', kq.bang_size || '',
    kq.o_loi ? kq.o_loi.length : '', kq.dang_xu_ly === undefined ? '' : kq.dang_xu_ly, chiTiet]]);
  if (sh.getLastRow() > 501) sh.deleteRows(502, sh.getLastRow() - 501); // giữ 500 lần gần nhất
  lamDepTrang_(sh);
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
  lamDepTrang_(dm);

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

// ---------------- Trình bày ----------------

/** Tăng số này khi đổi TRINH_BAY: lần mở bảng tính kế tiếp tự trình bày lại mọi trang. */
const PHIEN_BAN_TRINH_BAY = '1';
const MAU_TIEU_DE = '#1f3a5f';
const MAU_GIAI_THICH = '#eef3f8';
const MAU_SOC = '#f5f7fa';
/** Tên cột trang DonHang cho nhân viên đọc. Script đọc trang này theo vị trí cột (thứ tự COT_DON), không theo tên. */
const TEN_COT_DON = {
  ma_don: 'Mã đơn', thoi_gian: 'Thời gian đặt', ten: 'Khách', sdt: 'Số điện thoại', dia_chi: 'Địa chỉ',
  cac_mon: 'Các món', tien_hang: 'Tiền hàng', ghi_chu: 'Ghi chú', trang_thai: 'Trạng thái',
  khach_huy: 'Khách hủy lúc', hoi_thoai: 'Hội thoại trước khi đặt',
};
/** Gợi ý trong ô Trạng thái của DonHang; nhân viên vẫn gõ được chữ khác. */
const TRANG_THAI_DON = ['Mới', 'Đã gọi xác nhận', 'Đang giao', 'Hoàn thành', 'Khách hủy', 'Shop hủy'];

/**
 * Cách trình bày từng trang. dau: số dòng tiêu đề (dòng 1 tên cột, dòng 2 giải thích). cot: {tên cột: [độ rộng px, kiểu]},
 * kiểu gồm: tien (số tiền), giua (căn giữa), dam (chữ đậm), xuong (xuống dòng), ngay (ngày giờ). Cột không nêu thì
 * rộng theo `rong`, chữ dài được cắt gọn trong ô (bấm vào ô để đọc hết).
 */
const TRINH_BAY = {
  SanPham: { dau: 2, coDinh: 2, tab: '#3c78d8', rong: 110, cot: {
    ma_sp: [80, 'giua dam'], ten_sp: [260], anh_chinh_url: [160], anh_phu_url: [140], gia_ban: [100, 'tien'],
    gia_goc: [100, 'tien'], dip: [150], chi_tiet: [150], mo_ta_tu_do: [280], trang_thai: [95, 'giua'], gan_boi: [70, 'giua'] } },
  BienThe: { dau: 2, coDinh: 1, tab: '#3c78d8', rong: 100, cot: {
    ma_bien_the: [160, 'dam'], ma_sp: [90, 'giua'], size: [70, 'giua'], ton_kho: [75, 'giua'], gia_rieng: [100, 'tien'],
    anh_url: [160] } },
  BangSize: { dau: 2, coDinh: 1, tab: '#3c78d8', rong: 110, canGiua: true, cot: { size: [80, 'dam'] } },
  ThongTinShop: { dau: 2, coDinh: 1, tab: '#3c78d8', rong: 180, cot: { chu_de: [190, 'dam'], noi_dung: [640, 'xuong'] } },
  DonHang: { dau: 1, coDinh: 1, tab: '#6aa84f', rong: 120, xoaNen: true, cot: {
    ma_don: [120, 'dam'], thoi_gian: [125, 'giua'], ten: [150], sdt: [115, 'giua'], dia_chi: [240, 'xuong'],
    cac_mon: [260, 'xuong'], tien_hang: [105, 'tien'], ghi_chu: [170, 'xuong'], trang_thai: [135, 'giua dam'],
    khach_huy: [125, 'giua'], hoi_thoai: [300] } },
  NhatKy: { dau: 1, tab: '#999999', rong: 95, canGiua: true, xoaNen: true, cot: {
    'Thời gian': [140, 'ngay'], 'Chi tiết': [520, 'xuong'] } },
  DanhMuc: { dau: 1, tab: '#999999', rong: 130, xoaNen: true },
};

/** Gọi từ onOpen: trình bày lại mọi trang một lần cho mỗi phiên bản TRINH_BAY. Không đụng dữ liệu và ô bot tô đỏ. */
function tuTrinhBay_() {
  const props = PropertiesService.getDocumentProperties();
  if (props.getProperty('PHIEN_BAN_TRINH_BAY') === PHIEN_BAN_TRINH_BAY) return;
  const ss = SpreadsheetApp.getActive();
  Object.keys(TRINH_BAY).forEach(function (ten) {
    const sh = ss.getSheetByName(ten);
    if (sh) lamDepTrang_(sh);
  });
  props.setProperty('PHIEN_BAN_TRINH_BAY', PHIEN_BAN_TRINH_BAY);
}

function lamDepTrang_(sh) {
  const tb = TRINH_BAY[sh.getName()];
  if (!tb || sh.getLastColumn() < 1) return;
  const laDon = sh.getName() === TRANG_DON_HANG;
  if (laDon) sh.getRange(1, 1, 1, COT_DON.length).setValues([COT_DON.map(function (c) { return TEN_COT_DON[c]; })]);
  const soCot = laDon ? COT_DON.length : sh.getLastColumn();
  const header = laDon ? COT_DON
    : sh.getRange(1, 1, 1, soCot).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  const dau = tb.dau;
  const soDong = Math.max(sh.getMaxRows() - dau, 0);

  sh.setTabColor(tb.tab);
  sh.setFrozenRows(dau);
  sh.setFrozenColumns(tb.coDinh || 0);
  sh.getRange(1, 1, dau + soDong, soCot).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
  sh.getRange(1, 1, 1, soCot).setBackground(MAU_TIEU_DE).setFontColor('#ffffff').setFontWeight('bold')
    .setFontStyle('normal').setHorizontalAlignment('center').setWrap(true);
  sh.setRowHeight(1, 34);
  if (dau === 2) {
    sh.getRange(2, 1, 1, soCot).setBackground(MAU_GIAI_THICH).setFontColor('#5f6b7a').setFontWeight('normal')
      .setFontStyle('italic').setFontSize(9).setHorizontalAlignment('left').setVerticalAlignment('top').setWrap(true);
  }

  sh.getBandings().forEach(function (b) { b.remove(); });
  if (soDong) {
    const duLieu = sh.getRange(dau + 1, 1, soDong, soCot);
    duLieu.setFontColor('#202124').setFontWeight('normal').setFontStyle('normal')
      .setHorizontalAlignment(tb.canGiua ? 'center' : 'left').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    if (tb.xoaNen) duLieu.setBackground(null);
    duLieu.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
      .setFirstRowColor('#ffffff').setSecondRowColor(MAU_SOC);
  }
  header.forEach(function (h, i) {
    const k = (tb.cot || {})[h];
    sh.setColumnWidth(i + 1, k ? k[0] : tb.rong);
    if (!k || !k[1] || !soDong) return;
    const o = sh.getRange(dau + 1, i + 1, soDong, 1);
    const kieu = k[1].split(' ');
    if (kieu.indexOf('tien') >= 0) o.setNumberFormat('#,##0" ₫"').setHorizontalAlignment('right');
    if (kieu.indexOf('ngay') >= 0) o.setNumberFormat('dd/MM/yyyy HH:mm').setHorizontalAlignment('center');
    if (kieu.indexOf('giua') >= 0) o.setHorizontalAlignment('center');
    if (kieu.indexOf('dam') >= 0) o.setFontWeight('bold');
    if (kieu.indexOf('xuong') >= 0) o.setWrap(true).setHorizontalAlignment('left');
  });

  if (laDon) toMauDonHang_(sh, soDong);
  if (sh.getName() === TRANG_BIEN_THE) toMauTheoCot_(sh, header, 'ton_kho', dau, soDong, [
    ['=AND(ISNUMBER(#3),#3<=0)', '#fce8e6', '#c5221f'],
    ['=AND(ISNUMBER(#3),#3<=2)', '#fef7e0', '#b06000'],
  ]);
  if (sh.getName() === TRANG_SAN_PHAM) toMauTheoCot_(sh, header, 'trang_thai', dau, soDong, [
    ['=#3="hết hàng"', '#fef7e0', '#b06000'],
    ['=#3="ngừng bán"', '#f1f3f4', '#80868b'],
  ]);
  if (laDon && soDong) sh.autoResizeRows(2, soDong);
}

/** DonHang (trang của bot): màu theo trạng thái, cả dòng đỏ nhạt khi khách đã hủy, ô Trạng thái có danh sách chọn. */
function toMauDonHang_(sh, soDong) {
  if (!soDong) return;
  const chu = function (c) { return String.fromCharCode(65 + COT_DON.indexOf(c)); };
  const tt = chu('trang_thai');
  const oTT = sh.getRange(2, COT_DON.indexOf('trang_thai') + 1, soDong, 1);
  const quyTac = function (congThuc, vung, nen, mauChu) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(congThuc).setRanges([vung])
      .setBackground(nen).setFontColor(mauChu).build();
  };
  sh.setConditionalFormatRules([
    quyTac('=$' + tt + '2="Mới"', oTT, '#e8f0fe', '#1967d2'),
    quyTac('=$' + tt + '2="Đã gọi xác nhận"', oTT, '#f3e8fd', '#8430ce'),
    quyTac('=$' + tt + '2="Đang giao"', oTT, '#fef7e0', '#b06000'),
    quyTac('=$' + tt + '2="Hoàn thành"', oTT, '#e6f4ea', '#137333'),
    quyTac('=ISNUMBER(SEARCH("hủy",$' + tt + '2))', oTT, '#fce8e6', '#c5221f'),
    quyTac('=$' + chu('khach_huy') + '2<>""', sh.getRange(2, 1, soDong, COT_DON.length), MAU_LOI, '#a50e0e'),
  ]);
  oTT.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(TRANG_THAI_DON, true)
    .setAllowInvalid(true).build());
}

/**
 * Tô màu một cột theo giá trị (VD tồn kho sắp hết). quyTac: [[công thức, màu nền, màu chữ]], '#' là chữ cái của cột,
 * 3 là dòng dữ liệu đầu. Chỉ thay quy tắc do script này đặt, giữ quy tắc chủ shop tự thêm.
 */
function toMauTheoCot_(sh, header, tenCot, dau, soDong, quyTac) {
  const c = header.indexOf(tenCot);
  if (c < 0 || !soDong) return;
  const chu = String.fromCharCode(65 + c);
  const congThuc = quyTac.map(function (q) { return q[0].replace(/#/g, '$' + chu); });
  const cu = sh.getConditionalFormatRules().filter(function (r) {
    const b = r.getBooleanCondition();
    return !(b && b.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA
      && congThuc.indexOf(b.getCriteriaValues()[0]) >= 0);
  });
  const vung = sh.getRange(dau + 1, c + 1, soDong, 1);
  sh.setConditionalFormatRules(quyTac.map(function (q, i) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(congThuc[i]).setRanges([vung])
      .setBackground(q[1]).setFontColor(q[2]).build();
  }).concat(cu));
}
