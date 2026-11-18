/**
 * 📚 DocReview Studio — 4 Hồ Sơ Tài Liệu Mẫu Thực Chiến (Đa Lĩnh Vực)
 * Tích hợp sẵn luồng Bình luận (Inline Threads), Đề xuất sửa (Track Changes), Lịch sử Phiên bản (v1.0 -> v1.1) & Phê duyệt
 */

function createSampleDocuments() {
  const doc1V1 = `# PRD: Cổng Thanh Toán Tức Thì SmartPay QR v2.0

## 1. Bối cảnh & Mục tiêu bài toán
Hiện tại tỷ lệ rớt đơn ở bước thanh toán chuyển khoản thủ công trên ứng dụng đang ở mức 18.4% do khách hàng nhập sai nội dung chuyển khoản. Dự án **SmartPay QR v2.0** xây dựng luồng sinh mã VietQR động theo từng đơn hàng và đối soát tự động qua Webhook ngân hàng.

## 2. Phạm vi & Đối tượng người dùng
- **Trong phạm vi (In-Scope):** Sinh mã QR động chuẩn Napas247, lắng nghe biến động số dư thời gian thực, tự động xuất hóa đơn điện tử.
- **Ngoài phạm vi (Out-of-Scope):** Thanh toán thẻ tín dụng quốc tế Visa/Mastercard và trả góp 0%.

## 3. Yêu cầu Chức năng & Luồng nghiệp vụ
1. Khi người mua bấm **Thanh toán QR**, hệ thống sinh mã đơn duy nhất và trả về ảnh QR có nhúng sẵn số tiền cùng mã tham chiếu.
2. Dịch vụ Webhook Gateway nhận callback từ đối tác ngân hàng, kiểm tra chữ ký HMAC-SHA256 và cập nhật trạng thái đơn hàng.
3. Trong trường hợp ngân hàng gửi trùng gói tin (Duplicate Webhook), hệ thống sẽ tối ưu sau để tránh cộng tiền hai lần.

## 4. Yêu cầu Phi chức năng & Hiệu năng (SLA)
- Độ trễ sinh mã QR tại API tạo đơn đạt tối đa 250ms ở ngưỡng 1.000 người dùng đồng thời.
- Hệ thống đảm bảo xử lý thật nhanh mọi callback gạch nợ trong giờ cao điểm Flash Sale.
- Mục tiêu độ sẵn sàng (Uptime SLA) của cụm dịch vụ thanh toán đạt 99.95% theo tháng.

## 5. Chỉ số Thành công & Nghiệm thu (KPI)
| Chỉ số đo lường | Hiện trạng (v1) | Mục tiêu nghiệm thu (v2) |
| --- | --- | --- |
| Tỷ lệ gạch nợ tự động thành công | 81.6% | >= 99.2% |
| Độ trễ phản hồi API tạo mã QR | 920ms | Tối đa 2 giây |
| Tỷ lệ khiếu nại treo tiền quá hạn | 3.1% | < 0.15% |`;

  const doc1V2 = `# PRD: Cổng Thanh Toán Tức Thì SmartPay QR v2.0

## 1. Bối cảnh & Mục tiêu bài toán
Hiện tại tỷ lệ rớt đơn ở bước thanh toán chuyển khoản thủ công trên ứng dụng đang ở mức 18.4% do khách hàng nhập sai nội dung chuyển khoản. Dự án **SmartPay QR v2.0** xây dựng luồng sinh mã VietQR động theo từng đơn hàng, tự động khóa giá trong 10 phút và đối soát tức thì qua Webhook ngân hàng.

## 2. Phạm vi & Đối tượng người dùng
- **Trong phạm vi (In-Scope):** Sinh mã QR động chuẩn Napas247, lắng nghe biến động số dư thời gian thực, đối soát Idempotent và tự động xuất hóa đơn điện tử.
- **Ngoài phạm vi (Out-of-Scope):** Thanh toán thẻ tín dụng quốc tế Visa/Mastercard, ví trả sau BNPL, v.v.

## 3. Yêu cầu Chức năng & Luồng nghiệp vụ
1. Khi user cuối bấm **Thanh toán QR** trên cổng Smartpay, hệ thống sinh mã đơn duy nhất (\`SP26-XXXX\`) và trả về ảnh QR có nhúng sẵn số tiền cùng mã tham chiếu không thể chỉnh sửa.
2. Dịch vụ Webhook Gateway nhận callback từ đối tác ngân hàng, xác thực chữ ký số HMAC-SHA256 kèm kiểm tra Replay Timestamp (<= 300 giây) trước khi cập nhật trạng thái đơn hàng.
3. Trong trường hợp ngân hàng gửi trùng gói tin (Duplicate Webhook), hệ thống sẽ tối ưu sau để tránh cộng tiền hai lần.
4. Tài liệu đặc tả mã lỗi chi tiết xem tại [Bảng mã lỗi tích hợp Ngân hàng](#).

\`\`\`mermaid
flowchart LR
  A[Ứng dụng Mua sắm] -->|Tạo đơn QR| B[SmartPay API]
  B -->|Sinh VietQR động| C[Ngân hàng Napas247]
  C -->|Webhook HMAC| D[Đối soát Idempotent]
  D -->|Cập nhật Paid| E[Xuất Hóa đơn]
\`\`\`

## 4. Yêu cầu Phi chức năng & Hiệu năng (SLA)
- Độ trễ sinh mã QR tại API tạo đơn đạt tối đa 250ms ở ngưỡng 1.500 RPS.
- Hệ thống đảm bảo xử lý thật nhanh mọi callback gạch nợ trong giờ cao điểm Flash Sale.
- Mục tiêu độ sẵn sàng (Uptime SLA) của cụm dịch vụ thanh toán đạt 99.95% theo tháng.

## 5. Chỉ số Thành công & Nghiệm thu (KPI)
| Chỉ số đo lường | Hiện trạng (v1) | Mục tiêu nghiệm thu (v2) |
| --- | --- | --- |
| Tỷ lệ gạch nợ tự động thành công | 81.6% | >= 99.5% |
| Độ trễ phản hồi API tạo mã QR | 920ms | Tối đa 2 giây |
| Tỷ lệ khiếu nại treo tiền quá hạn | 3.1% | < 0.10% |`;

  const doc2Content = `# SOP-SEC-04: Quy Trình Ứng Cứu Sự Cố Rò Rỉ Dữ Liệu & Khôi Phục Dịch Vụ

## 1. Mục đích ban hành
Quy trình này thiết lập trình tự phản ứng thống nhất nhằm cô lập nhanh vùng nhiễm, bảo toàn bằng chứng pháp y số (Digital Forensics) và khôi phục hoạt động an toàn khi xảy ra sự cố an ninh mạng hoặc nghi ngờ lộ lọt dữ liệu.

## 2. Phạm vi & Đối tượng áp dụng
Áp dụng bắt buộc cho toàn bộ hệ thống máy chủ Production, kho dữ liệu khách hàng, cổng API nội bộ và tất cả nhân sự thuộc khối Kỹ thuật, Vận hành Hệ thống (SRE), Pháp chế và Chăm sóc Khách hàng.

## 3. Vai trò & Trách nhiệm (RACI)
| Vai trò | Phụ trách chính | Nhiệm vụ cốt lõi |
| --- | --- | --- |
| Chỉ huy Sự cố (Incident Commander) | Trưởng phòng An toàn Thông tin | Kích hoạt mức báo động Sev-1/Sev-2, điều phối toàn cục |
| Kỹ sư Trực ca SOC / SRE | Nhóm Trực chiến Hạ tầng | Cô lập mạng, chụp Snapshot RAM/Disk, thu hồi khóa bị lộ |
| Phụ trách Truyền thông & Pháp chế | Trưởng ban Pháp chế | Soạn thông báo gửi cơ quan chức năng theo Nghị định 13/2023/NĐ-CP |

## 4. Các bước thực hiện chi tiết
Bước 1: Kỹ sư Trực ca SOC xác minh cảnh báo từ SIEM trong vòng 15 phút kể từ khi phát hiện dấu hiệu truy cập bất thường và mở phòng trực chiến khẩn cấp.

Bước 2: Bộ phận SRE thực hiện cô lập phân vùng mạng (Network Quarantine) đối với container hoặc máy chủ bị xâm nhập nhưng tuyệt đối không tắt nguồn đột ngột trước khi trích xuất bộ nhớ khả biến.

Bước 3: Tiến hành thu hồi toàn bộ Access Token, khóa phiên đăng nhập trái phép và xoay vòng khóa mã hóa (Key Rotation) càng sớm càng tốt.

Bước 4: Gửi báo cáo sơ bộ về phạm vi ảnh hưởng tới Ban Giám đốc theo mẫu [Điền mã biểu mẫu báo cáo sự cố tại đây].

## 5. Xử lý Ngoại lệ & Báo cáo Sự cố
Trong trường hợp sự cố làm gián đoạn cổng thanh toán chính quá 30 phút, Chỉ huy Sự cố kích hoạt chuyển hướng lưu lượng sang cụm dự phòng DR (Disaster Recovery) tùy tình hình thực tế.

## 6. Biểu mẫu, Nhật ký & Lưu trữ
Toàn bộ biên bản điều tra nguyên nhân gốc rễ (Post-Mortem), ảnh chụp log bất biến (SHA-256 Hash) và danh sách hành động khắc phục được lưu trữ tối thiểu 36 tháng tại kho lưu trữ an toàn.`;

  const doc3Content = `# Đánh Giá Hiệu Năng Kiến Trúc Hybrid-RAG Cho Bài Toán Hỏi Đáp Văn Bản Nội Bộ Tiếng Việt

## 1. Tóm tắt (Abstract)
Báo cáo này trình bày kết quả thực nghiệm kết hợp tìm kiếm từ khóa BM25 có tách từ tiếng Việt với tìm kiếm ngữ nghĩa Dense Embedding (BGE-M3) và tầng xếp hạng lại Cross-Encoder Reranker trên tập 12.500 tài liệu quy chế doanh nghiệp. Kết quả cho thấy phương pháp Hybrid-RAG giúp tăng độ chính xác trích xuất đoạn ngữ cảnh (Recall@5) từ 74.2% lên 91.8% và giảm tỷ lệ suy diễn sai (Hallucination) xuống dưới 3.4% [1].

## 2. Đặt vấn đề & Giới thiệu
Khi triển khai các mô hình ngôn ngữ lớn (LLM) cho kho tri thức doanh nghiệp Việt Nam, thách thức lớn nhất là hiện tượng từ đồng âm khác nghĩa, chữ viết tắt chuyên ngành và cấu trúc bảng biểu phức tạp. Nhiều nghiên cứu chỉ ra rằng việc chỉ sử dụng Vector Search thuần túy thường bỏ sót các mã văn bản, số hiệu nghị định và điều khoản chính xác.

### 2.1. Mục tiêu thực nghiệm trọng tâm
Nghiên cứu tập trung đo lường sự đánh đổi giữa độ trễ truy vấn (Latency) và chất lượng câu trả lời có gắn trích dẫn trên phần cứng máy chủ nội bộ (On-Premise GPU).

## 3. Cơ sở lý thuyết & Phương pháp đề xuất
Quy trình xử lý gồm 3 giai đoạn nối tiếp:
- **Giai đoạn Phân mảnh theo Cấu trúc (Structure-Aware Chunking):** Giữ nguyên vẹn tiêu đề cha (Breadcrumb Header) và bảng Markdown trong từng đoạn 512 tokens (chồng lấn 64 tokens).
- **Giai đoạn Hợp nhất Điểm số (Reciprocal Rank Fusion - RRF):** Kết hợp kết quả từ chỉ mục từ khóa tiếng Việt và chỉ mục vector nhiều chiều [3].
- **Giai đoạn Kiểm chứng Trích dẫn:** Bắt buộc mô hình chỉ sinh câu trả lời từ các đoạn có điểm tương đồng vượt ngưỡng tin cậy >= 0.68.

## 4. Thực nghiệm & Đánh giá Kết quả
| Cấu hình thử nghiệm | Recall@5 (%) | Độ trung thực Faithfulness (%) | Độ trễ trung bình P95 |
| --- | --- | --- | --- |
| Dense Vector thuần túy | 74.2% | 82.5% | 410ms |
| BM25 Tiếng Việt thuần túy | 68.9% | 85.0% | 120ms |
| Hybrid RRF + Reranker (Đề xuất) | 91.8% | 96.6% | 640ms |

## 5. Thảo luận & Hạn chế
Mặc dù kiến trúc Hybrid RRF + Reranker cải thiện vượt bậc độ chính xác, chi phí tính toán tại bước Cross-Encoder làm tăng thêm khoảng 230ms độ trễ mỗi truy vấn. Ngoài ra, tập dữ liệu kiểm thử hiện chưa bao gồm các biểu đồ dạng ảnh quét mờ chưa qua OCR.

## 6. Kết luận & Tài liệu Tham khảo
- [1] Nguyễn Văn An và cộng sự (2025), *Tối ưu hóa truy hồi văn bản hành chính tiếng Việt*, Tạp chí Khoa học Máy tính.
- [3] Cormack, G. V. et al. (2009), *Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods*, SIGIR.`;

  const doc4Content = `# Đề Xuất Triển Khai Trợ Lý AI Đa Kênh Hỗ Trợ Chăm Sóc Khách Hàng 24/7

## 1. Bối cảnh & Nhu cầu hiện trạng
Trung tâm Chăm sóc Khách hàng (CSKH) hiện tiếp nhận trung bình 4.800 lượt chat/ngày qua Website, Zalo OA và Fanpage. Thời gian chờ phản hồi trung bình vào khung giờ tối (19h00 – 23h00) lên tới 14 phút, làm giảm chỉ số hài lòng CSAT xuống mức 78%.

## 2. Giải pháp & Nội dung Đề xuất
Triển khai hệ thống **OmniCare AI Copilot** đóng vai trò tầng lọc thông minh đầu tiên và gợi ý câu trả lời nháp cho tổng đài viên:
- Tự động giải đáp ngay các câu hỏi tra cứu hành trình đơn hàng, chính sách đổi trả và hướng dẫn bảo hành dựa trên kho tri thức đã duyệt.
- Tự động chuyển tiếp mượt mà (Warm Handoff) kèm bản tóm tắt 3 dòng cho nhân viên trực khi phát hiện khách hàng bức xúc hoặc yêu cầu hoàn tiền phức tạp.
- Cấu hình thử nghiệm hiện tại trên môi trường Staging đang dùng khóa kết nối \`sk-proj-9A8b7C6d5E4f3G2h1J0kLmNoPqRsTuVwXyZ\` để kiểm thử định tuyến hội thoại.

## 3. Lộ trình, Nguồn lực & Chi phí / ROI dự kiến
| Giai đoạn | Thời gian | Hạng mục bàn giao | Ngân sách dự kiến |
| --- | --- | --- | --- |
| Pha 1 (Pilot) | Tuần 1 – Tuần 4 | Kết nối Zalo OA & Kho 200 câu hỏi chuẩn | 45.000.000 VNĐ |
| Pha 2 (Mở rộng) | Tuần 5 – Tuần 8 | Tích hợp CRM tra cứu đơn & Copilot cho Agent | 65.000.000 VNĐ |
| Pha 3 (Tối ưu) | Tuần 9 – Tuần 12 | Dashboard kiểm toán chất lượng & Cảnh báo SLA | 30.000.000 VNĐ |

Dự kiến sau 03 tháng vận hành chính thức, giải pháp giúp rút ngắn thời gian phản hồi lần đầu xuống dưới 15 giây, nâng CSAT lên >= 90% và tiết kiệm khoảng 38% chi phí trực ca đêm.

## 4. Kết luận & Đề xuất Phê duyệt
Kính trình Ban Giám đốc và Khối Công nghệ xem xét phê duyệt ngân sách Pha 1 để đội dự án khởi động vào đầu tháng tới.
Đầu mối liên hệ triển khai: Bà Nguyễn Ngọc Lan (CCCD: 079196008899, SĐT: 0987654321, Email: lan.nguyen@omnicare-corp.vn, Mã số thuế: 0316889977, Số tài khoản nhận tạm ứng: 19036688991122).`;

  return [
    {
      id: 'doc-smartpay-prd',
      title: 'PRD: Cổng Thanh Toán Tức Thì SmartPay QR v2.0',
      profileId: 'PRD_SPEC',
      status: 'IN_REVIEW',
      owner: 'Minh Anh (Product Lead)',
      updatedAt: '2026-11-18T07:30:00.000Z',
      content: doc1V2,
      versions: [
        {
          id: 'ver-1',
          label: 'v1.0 — Bản nháp khởi tạo',
          author: 'Minh Anh (Product Lead)',
          createdAt: '2026-11-16T09:15:00.000Z',
          note: 'Khởi tạo đặc tả luồng sinh mã VietQR và bảng KPI ban đầu.',
          content: doc1V1
        },
        {
          id: 'ver-2',
          label: 'v1.1 — Bổ sung Replay Check & Khoá giá 10p',
          author: 'Minh Anh (Product Lead)',
          createdAt: '2026-11-18T07:30:00.000Z',
          note: 'Cập nhật cơ chế chống phát lại gói tin Webhook và nâng ngưỡng RPS.',
          content: doc1V2
        }
      ],
      comments: [
        {
          id: 'cmt-101',
          author: 'Quốc Bảo',
          role: 'Tech Architect',
          category: 'BLOCKER',
          status: 'OPEN',
          quote: 'hệ thống sẽ tối ưu sau để tránh cộng tiền hai lần',
          text: 'Chống cộng tiền trùng (Idempotency Key theo mã giao dịch ngân hàng) là yêu cầu SỐNG CÒN ngay ngày Go-live, tuyệt đối không được để "tối ưu sau"!',
          createdAt: '2026-11-18T07:35:00.000Z',
          replies: [
            {
              id: 'rep-1',
              author: 'Minh Anh',
              role: 'Product Lead',
              text: 'Đồng ý 100%, Bảo giúp mình gửi Đề xuất sửa (Track Change) câu đặc tả Redis/Unique Constraint ngay trên đoạn này nhé!',
              createdAt: '2026-11-18T07:38:00.000Z'
            }
          ]
        },
        {
          id: 'cmt-102',
          author: 'Hải Đăng',
          role: 'QA / Security Lead',
          category: 'CLARITY',
          status: 'OPEN',
          quote: 'Tối đa 2 giây',
          text: 'Ở Mục 4 ghi độ trễ tạo mã QR tối đa 250ms, nhưng xuống Bảng KPI Mục 5 lại ghi "Tối đa 2 giây". Cần chốt 1 con số duy nhất để QA viết kịch bản k6 Load Test.',
          createdAt: '2026-11-18T07:41:00.000Z',
          replies: []
        },
        {
          id: 'cmt-103',
          author: 'Hải Đăng',
          role: 'QA / Security Lead',
          category: 'QUESTION',
          status: 'OPEN',
          quote: 'Mục tiêu độ sẵn sàng (Uptime SLA) của cụm dịch vụ thanh toán đạt 99.95% theo tháng.',
          text: 'Bổ sung thêm mục 6 về Kế hoạch Rollback & Fallback (chuyển về hiển thị số tài khoản copy có kiểm tra mã đơn) khi cổng Webhook ngân hàng bảo trì nhé.',
          createdAt: '2026-11-18T07:43:00.000Z',
          replies: []
        }
      ],
      suggestions: [
        {
          id: 'sug-201',
          author: 'Quốc Bảo',
          role: 'Tech Architect',
          status: 'PENDING',
          originalText: 'hệ thống sẽ tối ưu sau để tránh cộng tiền hai lần.',
          suggestedText: 'hệ thống bắt buộc kiểm tra khóa chống trùng `bank_txn_id` (Unique Index + Redis Lock TTL 24h) để đảm bảo tính Idempotent 100%, trả mã 200 OK mà không cộng tiền lặp.',
          reason: 'Chặn triệt để lỗi cộng tiền 2 lần khi ngân hàng retry webhook.',
          createdAt: '2026-11-18T07:40:00.000Z'
        },
        {
          id: 'sug-202',
          author: 'Hải Đăng',
          role: 'QA / Security Lead',
          status: 'PENDING',
          originalText: 'xử lý thật nhanh mọi callback gạch nợ trong giờ cao điểm Flash Sale.',
          suggestedText: 'xử lý hoàn tất callback gạch nợ với độ trễ P99 <= 500ms ở mức tải đỉnh 2.000 giao dịch/giây trong khung giờ Flash Sale.',
          reason: 'Định lượng rõ ngưỡng P99 và thông lượng để nghiệm thu tải.',
          createdAt: '2026-11-18T07:44:00.000Z'
        }
      ],
      approvals: [
        {
          id: 'app-1',
          reviewer: 'Quốc Bảo',
          role: 'Tech Architect',
          decision: 'CHANGES_REQUESTED',
          note: 'Cần chốt cơ chế Idempotency ở Mục 3.3 và bổ sung phương án Rollback trước khi ký duyệt.',
          decidedAt: '2026-11-18T07:45:00.000Z'
        }
      ],
      auditLog: [
        { id: 'ev-1', time: '2026-11-16T09:15:00.000Z', actor: 'Minh Anh', action: 'Khởi tạo tài liệu v1.0' },
        { id: 'ev-2', time: '2026-11-18T07:30:00.000Z', actor: 'Minh Anh', action: 'Lưu phiên bản v1.1 và chuyển trạng thái sang Đang rà soát (IN_REVIEW)' },
        { id: 'ev-3', time: '2026-11-18T07:45:00.000Z', actor: 'Quốc Bảo', action: 'Gửi quyết định Yêu cầu chỉnh sửa (CHANGES_REQUESTED) kèm 1 đề xuất Track Change' }
      ]
    },
    {
      id: 'doc-sec-sop',
      title: 'SOP-SEC-04: Quy Trình Ứng Cứu Sự Cố Rò Rỉ Dữ Liệu & Khôi Phục Dịch Vụ',
      profileId: 'SOP_OPERATIONS',
      status: 'IN_REVIEW',
      owner: 'Hải Đăng (QA / Security Lead)',
      updatedAt: '2026-11-18T06:50:00.000Z',
      content: doc2Content,
      versions: [
        {
          id: 'ver-sop-1',
          label: 'v1.0 — Dự thảo trình thẩm định ISO 27001',
          author: 'Hải Đăng (QA / Security Lead)',
          createdAt: '2026-11-18T06:50:00.000Z',
          note: 'Bản dự thảo quy trình phản ứng sự cố bảo mật theo chuẩn ISO/IEC 27001.',
          content: doc2Content
        }
      ],
      comments: [
        {
          id: 'cmt-sop-1',
          author: 'Thu Hà',
          role: 'Compliance Auditor',
          category: 'BLOCKER',
          status: 'OPEN',
          quote: '[Điền mã biểu mẫu báo cáo sự cố tại đây]',
          text: 'Chưa điền mã biểu mẫu chuẩn của Ban Pháp chế (BM-SEC-09A). Không được để ngoặc vuông nháp khi ban hành SOP.',
          createdAt: '2026-11-18T07:05:00.000Z',
          replies: []
        }
      ],
      suggestions: [
        {
          id: 'sug-sop-1',
          author: 'Thu Hà',
          role: 'Compliance Auditor',
          status: 'PENDING',
          originalText: 'Bước 3: Tiến hành thu hồi toàn bộ Access Token, khóa phiên đăng nhập trái phép và xoay vòng khóa mã hóa (Key Rotation) càng sớm càng tốt.',
          suggestedText: 'Bước 3: Nhóm Kỹ sư Trực ca SOC phối hợp IAM Admin thu hồi toàn bộ Access Token, khóa phiên đăng nhập trái phép và hoàn tất xoay vòng khóa mã hóa (Key Rotation) trong vòng tối đa 30 phút.',
          reason: 'Chỉ rõ chủ thể thực hiện (PIC) và mốc thời gian SLA 30 phút.',
          createdAt: '2026-11-18T07:08:00.000Z'
        }
      ],
      approvals: [],
      auditLog: [
        { id: 'ev-sop-1', time: '2026-11-18T06:50:00.000Z', actor: 'Hải Đăng', action: 'Tạo quy trình SOP-SEC-04 v1.0 và gửi rà soát nội bộ' }
      ]
    },
    {
      id: 'doc-rag-paper',
      title: 'Báo Cáo Nghiên Cứu: Đánh Giá Hiệu Năng Kiến Trúc Hybrid-RAG Tiếng Việt',
      profileId: 'ACADEMIC_REPORT',
      status: 'CHANGES_REQUESTED',
      owner: 'TS. Trần Minh Quân (AI Research)',
      updatedAt: '2026-11-17T16:20:00.000Z',
      content: doc3Content,
      versions: [
        {
          id: 'ver-rag-1',
          label: 'v1.0 — Bản nộp phản biện nội bộ',
          author: 'TS. Trần Minh Quân',
          createdAt: '2026-11-17T16:20:00.000Z',
          note: 'Bản thảo gửi Hội đồng Khoa học rà soát trước khi xuất bản.',
          content: doc3Content
        }
      ],
      comments: [
        {
          id: 'cmt-rag-1',
          author: 'PGS. Lê Hoàng',
          role: 'Peer Reviewer',
          category: 'CLARITY',
          status: 'OPEN',
          quote: 'Nhiều nghiên cứu chỉ ra rằng việc chỉ sử dụng Vector Search thuần túy thường bỏ sót các mã văn bản',
          text: 'Câu này cần bổ sung trích dẫn cụ thể [2] (ví dụ bài báo của Karpukhin et al. hoặc Robertson & Zaragoza về BM25 vs Dense Retrieval), đồng thời kiểm tra lại danh mục tài liệu tham khảo đang bị nhảy từ [1] sang [3]!',
          createdAt: '2026-11-17T17:10:00.000Z',
          replies: []
        }
      ],
      suggestions: [],
      approvals: [
        {
          id: 'app-rag-1',
          reviewer: 'PGS. Lê Hoàng',
          role: 'Peer Reviewer',
          decision: 'CHANGES_REQUESTED',
          note: 'Số liệu thực nghiệm rất thuyết phục, chỉ cần bổ sung tài liệu tham khảo [2] bị khuyết ở Mục 2 và Mục 6.',
          decidedAt: '2026-11-17T17:15:00.000Z'
        }
      ],
      auditLog: [
        { id: 'ev-rag-1', time: '2026-11-17T16:20:00.000Z', actor: 'TS. Trần Minh Quân', action: 'Nộp bản thảo nghiên cứu v1.0' }
      ]
    },
    {
      id: 'doc-ai-proposal',
      title: 'Đề Xuất Triển Khai Trợ Lý AI Đa Kênh Hỗ Trợ CSKH 24/7',
      profileId: 'GENERAL_EDITORIAL',
      status: 'DRAFT',
      owner: 'Ngọc Lan (Business Operations)',
      updatedAt: '2026-11-18T05:10:00.000Z',
      content: doc4Content,
      versions: [
        {
          id: 'ver-prop-1',
          label: 'v1.0 — Bản nháp trình duyệt ngân sách',
          author: 'Ngọc Lan (Business Operations)',
          createdAt: '2026-11-18T05:10:00.000Z',
          note: 'Tổng hợp chi phí 3 pha và ước tính ROI.',
          content: doc4Content
        }
      ],
      comments: [
        {
          id: 'cmt-prop-1',
          author: 'Hải Đăng',
          role: 'QA / Security Lead',
          category: 'BLOCKER',
          status: 'OPEN',
          quote: 'sk-proj-9A8b7C6d5E4f3G2h1J0kLmNoPqRsTuVwXyZ',
          text: 'CẢNH BÁO BẢO MẬT: Đang dán nhầm API Key Staging thật vào tờ trình gửi rộng rãi! Hãy chấp nhận ngay đề xuất xóa khóa này và thu hồi key trên cổng quản trị.',
          createdAt: '2026-11-18T05:30:00.000Z',
          replies: []
        }
      ],
      suggestions: [
        {
          id: 'sug-prop-1',
          author: 'Hải Đăng',
          role: 'QA / Security Lead',
          status: 'PENDING',
          originalText: 'Cấu hình thử nghiệm hiện tại trên môi trường Staging đang dùng khóa kết nối `sk-proj-9A8b7C6d5E4f3G2h1J0kLmNoPqRsTuVwXyZ` để kiểm thử định tuyến hội thoại.',
          suggestedText: 'Cấu hình thử nghiệm hiện tại trên môi trường Staging quản lý khóa kết nối tập trung qua biến môi trường bảo mật (`OPENAI_API_KEY` lưu trong Secret Vault nội bộ) để kiểm thử định tuyến hội thoại.',
          reason: 'Xóa khóa API nhạy cảm khỏi tài liệu tờ trình.',
          createdAt: '2026-11-18T05:32:00.000Z'
        }
      ],
      approvals: [],
      auditLog: [
        { id: 'ev-prop-1', time: '2026-11-18T05:10:00.000Z', actor: 'Ngọc Lan', action: 'Khởi tạo tờ trình đề xuất dự án v1.0' }
      ]
    }
  ];
}

module.exports = {
  createSampleDocuments
};
