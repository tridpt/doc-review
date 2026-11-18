# 📋✍️ DocReview Studio (`doc-review` — Port 4185)

**Trạm Rà Soát Chất Lượng Tài Liệu 5 Trục, Bình Luận Nội Tuyến (Inline Comments), Đề Xuất Sửa Đổi (Track Changes), Đối Chiếu Phiên Bản (Word Diff) & Luồng Phê Duyệt Đa Cấp (`.DOCX` / `.MD` / `.TXT`)**.

Ứng dụng chạy **100% độc lập không phụ thuộc thư viện ngoài (Zero-Dependency Node.js)**, tích hợp trực tiếp vào bàn điều khiển **NexusHub Command Center (Port 4000)**.

---

## 🚀 Khởi chạy nhanh

```powershell
cd d:\AI_App\doc-review
node server.js
```

Hoặc nhấp đúp tệp `start.bat` và truy cập: **http://localhost:4185**

Chạy bộ kiểm thử tự động (Unit + End-to-End API + Roundtrip `.DOCX`):

```powershell
npm test
```

---

## 🌟 5 Trụ Cột Cốt Lõi (Khác biệt hoàn toàn với `word-checker` & `contract-intelligence`)

### 1. 🎯 Bộ Chấm Điểm Chất Lượng 5 Trục & 4 Chuẩn Đánh Giá (`lib/quality-engine.js`)
- Đánh giá trên **5 trục Rada**: *Cấu trúc & Đủ mục*, *Độ rõ ràng & Định lượng*, *Nhất quán & Logic*, *Khả năng Thực thi*, *An toàn Bảo mật*.
- Hỗ trợ **4 bộ tiêu chuẩn chuyên biệt**:
  1. `PRD_SPEC` (**PRD & Thiết kế Kỹ thuật RFC**): Bắt cam kết hiệu năng mơ hồ thiếu ngưỡng SLA (*"xử lý thật nhanh"*, *"tối ưu sau"*), mâu thuẫn số liệu giữa các mục (VD: `250ms` ở mục SLA nhưng `2 giây` ở bảng KPI), thiếu kịch bản Rollback.
  2. `SOP_OPERATIONS` (**Quy trình Vận hành Chuẩn SOP**): Bắt các bước quy trình thiếu chủ thể chịu trách nhiệm (PIC), mốc thời gian cảm tính (*"càng sớm càng tốt"*) và các ô nháp `[Điền ...]` bỏ quên.
  3. `ACADEMIC_REPORT` (**Báo cáo Nghiên cứu / Luận văn**): Bắt nhận định khái quát thiếu nguồn tham chiếu, lỗi nhảy số trích dẫn (`[1]` ➔ `[3]` thiếu `[2]`) và nhảy cấp tiêu đề.
  4. `GENERAL_EDITORIAL` (**Đề xuất Kinh doanh / Proposal**): Kiểm tra lộ trình, ROI, nhất quán thuật ngữ và phát hiện **rò rỉ khóa API / Secret Token / Connection String** trực tiếp trong văn bản.
- **1-Click Sửa ngay**, **Đẩy sang Track Change** hoặc **Chèn khung các mục còn thiếu**.

### 2. 💬 Rà Soát Bôi Đen & Luồng Bình Luận Nội Tuyến (Inline Comment Threads)
- Quét chọn bất kỳ câu chữ nào trên trang giấy để gắn bình luận theo phân loại: `🔴 BLOCKER`, `🟠 CLARITY`, `🔵 QUESTION`, `⚪ NITPICK`, `🟢 PRAISE`.
- Hỗ trợ chuỗi thảo luận phản hồi (Threaded Replies), lọc nhanh các điểm nghẽn và nhấp để cuộn sáng đúng đoạn văn gốc (`¶n`).

### 3. ✏️ Đề Xuất Sửa Đổi Trực Tiếp — Track Changes (`Suggest` / `Accept` / `Reject`)
- Đề xuất thay thế câu chữ hiển thị trực quan (`gạch bỏ đỏ` ➔ `chèn mới xanh`) ngay trên mặt văn bản.
- Bấm **✓ Chấp nhận** để tự động ghép nội dung mới vào tài liệu và lưu vết kiểm toán, hoặc **✅ Duyệt tất cả** trong 1 cú nhấp.

### 4. 🔀 Quản Lý Snapshot Phiên Bản & So Sánh Từng Từ (`lib/diff-engine.js`)
- Đóng gói mốc phiên bản bất kỳ lúc nào (`v1.0`, `v1.1`, `v1.2`...), khôi phục phiên bản cũ an toàn.
- Đối chiếu 2 phiên bản ở cả 2 chế độ **Gộp dòng (Unified Word Diff)** và **Song song 2 cột (Side-by-Side)** kèm thống kê độ tương đồng `%` và số từ thêm/bớt.

### 5. 🛡️ Cổng Kiểm Soát Phê Duyệt Đa Cấp & Xuất/Nhập `.DOCX` Chuẩn OOXML (`lib/docx-codec.js`)
- **Readiness Gatekeeper**: Tự động chặn ký `APPROVED` (HTTP `409 GATE_BLOCKED`) nếu còn `Blocker` chưa đóng, `Track Change` chưa xử lý hoặc lỗi `CRITICAL` (trừ khi người duyệt tích chọn *Phê duyệt ngoại lệ có lưu vết*).
- **Đọc `.DOCX` thông minh**: Giải nén qua Central Directory (hỗ trợ cả Word, Google Docs, LibreOffice), giữ nguyên Heading, Bảng biểu và **tự động nhập cả các Comment sẵn có trong Word (`word/comments.xml`)** vào luồng thảo luận!
- **Xuất đa định dạng**: Tệp `.DOCX` kèm chú thích Word native & Phụ lục Nghiệm thu, `.DOCX` sạch, `.MD`, Biên bản HTML/In PDF và gói kiểm toán `.JSON`.

---

## 🤖 Tùy chọn Mở rộng: AI Deep Review (OpenAI / Google Gemini)
Mặc định ứng dụng vận hành **Offline 100%** không cần tài khoản hay khóa API. Nếu muốn kết hợp thêm LLM để tự động sinh nhận xét và Track Changes, bạn có thể khai báo `GEMINI_API_KEY` hoặc `OPENAI_API_KEY` trong tệp `.env` (xem `.env.example`) hoặc nhập tạm trong hộp thoại **🤖 AI Review** trên giao diện.

---

## 🚀 Nâng Cấp Mới Trong Bản v2.0 (Enterprise Governance & Realtime)

1. **🔒 Niêm Phong Chữ Ký Số SHA-256 + HMAC Chống Sửa Ngầm (`lib/seal.js`)**
   - Ngay khi tài liệu đạt trạng thái `APPROVED`, hệ thống tự động cấp con dấu `SEAL-XXXXXXXX` chứa mã băm `SHA-256` của văn bản và chữ ký `HMAC-SHA256`.
   - Nếu văn bản bị chỉnh sửa sau khi ký dù chỉ 1 ký tự, thanh cảnh báo đỏ **🚨 CẢNH BÁO GIẢ MẠO / SỬA NGẦM SAU KHI KÝ DUYỆT** bật sáng tức thì, hỗ trợ **🔍 Đối chiếu từng từ bị sửa** so với bản niêm phong và **⏪ Khôi phục nguyên trạng 1-Click**.

2. **📕 Bộ Đọc Trích Xuất `.PDF` Thuần Node.js (`lib/pdf-codec.js`)**
   - Giải nén trực tiếp luồng `/FlateDecode`, giải mã bảng `/ToUnicode` CMap và UTF-16BE tiếng Việt từ tệp `.pdf` mà không cần cài đặt bất kỳ thư viện nhị phân ngoài nào.

3. **⚡ Cộng Tác Thời Gian Thực Qua SSE & Live Presence (`lib/realtime-hub.js`)**
   - Mở 2 hoặc nhiều tab/trình duyệt cùng lúc: Hiển thị trực tiếp số phiên & tên người đang xem tài liệu trên thanh trên cùng; mọi bình luận, Track Change, chuẩn hóa thuật ngữ hay chữ ký phê duyệt đều đồng bộ tức thì sang các tab khác không cần `F5`.

4. **🛠️ Trình Tạo Bộ Tiêu Chí Riêng & Từ Điển Thuật Ngữ Chuẩn (`lib/governance-store.js`)**
   - **Custom Rubric Builder**: Tự thiết kế chuẩn đánh giá riêng (tên mục bắt buộc, từ khóa nhận diện, cụm từ cấm) ngay trong hộp thoại **🛠️ Chuẩn & Từ điển**.
   - **Glossary Enforcer**: Tự động phát hiện các thuật ngữ viết sai quy ước (VD: `Smartpay` ➔ `SmartPay`, `CMND` ➔ `Căn cước (CCCD)`, `user cuối` ➔ `người dùng cuối`), tự động bỏ qua vùng code `` `...` `` và cho phép **✨ Chuẩn hóa toàn bộ 1-Click**.

---

## 🌟 Nâng Cấp Mới Trong Bản v3.0 (Ecosystem Intelligence & Reviewer Power Tools)

1. **⚡ Command Palette (`Ctrl+K` / `Cmd+K`), Cây Mục Lục (`Outline TOC`) & Vẽ Sơ Đồ Luồng SVG**
   - Bấm **`Ctrl+K`** ở bất kỳ đâu để tìm nhanh tài liệu, nhảy tới đề mục `¶n`, bật Heatmap, ẩn PII, gọi cầu nối liên ứng dụng hoặc đổi giao diện.
   - Tự động dựng các khối ` ```mermaid ` / ` ```diagram ` thành **Sơ đồ Luồng Kiến trúc SVG** sắc nét ngay trên trang giấy Review không cần mạng.

2. **🕵️‍♂️ Két Sắt Ẩn Dữ Liệu Nhạy Cảm Có Thể Khôi Phục (`lib/pii-vault.js`)**
   - Tự động nhận diện `CCCD`, `Số điện thoại`, `Email`, `Mã số thuế`, `Số tài khoản`, `IP nội bộ` và `API Secret`, mã hóa tạm thành thẻ `[PII_TYPE_XX]` lưu trong Két sắt cục bộ và khôi phục lại 100% bất kỳ lúc nào (tích hợp cả chế độ **Tự động che PII trước khi gửi lên Cloud AI Review**).

3. **🎨 Ma Trận Đọc Hiểu (`Readability Heatmap`) & Đọc Soát Giọng Nói Tiếng Việt (`TTS`) (`lib/readability-engine.js`)**
   - Tô màu trực quan các câu dày ý (`28–40 từ`) và các câu quá dài dễ vấp (`> 40 từ`), kèm bộ đọc phát âm tiếng Việt tự động cuộn sáng từng đoạn `¶n` để bắt lỗi hành văn bằng thính giác.

4. **🔗 Liên Thông Hệ Sinh Thái `d:\AI_App` & Dashboard Thống Kê SLA Toàn Kho (`lib/ecosystem-bridge.js`)**
   - Tab **📊 SLA, Két PII & Liên Thông** tổng hợp điểm trung bình toàn kho, bảng xếp hạng điểm nghẽn `Blocker` và kết nối 1-Click sang **ContractShield (`Port 4175`)** quét bẫy pháp lý + **OmniTrace OSINT (`Port 4090`)** thẩm tra đối tác + **Pipeline Tự Động số 7** trên **NexusHub (`Port 4000`)**.
