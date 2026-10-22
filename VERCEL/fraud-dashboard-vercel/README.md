# FraudScope — Dashboard IEEE-CIS Fraud Detection

Dashboard hậu kiểm dành cho hai vai trò:

1. **Quản lý rủi ro:** theo dõi quy mô, tỷ lệ, giá trị giao dịch có nhãn fraud, xu hướng theo tuần tương đối và phân khúc để ưu tiên nguồn lực kiểm soát.
2. **Chuyên viên điều tra:** so sánh phân phối số tiền, missing, ProductCD × DeviceType và truy vết một tập giao dịch mẫu.

## Kiến trúc

```text
fraud_train_clean.parquet (590.540 dòng × 437 cột)
        │
        │ scripts/build_data.py chỉ đọc 17 cột
        ▼
data/dashboard.json (~73 KiB)
        ├── api/dashboard.js  ← backend serverless trên Vercel
        └── index.html + app.js + styles.css ← frontend
```

Không đọc Parquet trong Vercel Function. Bước tiền tổng hợp giúp tránh thiếu bộ nhớ, giảm thời gian tải và giữ mọi mẫu số/CI nhất quán.

## Chạy trên máy

Từ thư mục `fraud-dashboard-vercel`:

```powershell
python -m http.server 8000
```

Mở `http://localhost:8000`. Khi chạy bằng máy chủ Python, frontend tự dùng `data/dashboard.json` vì endpoint `/api/dashboard` chỉ hoạt động trên Vercel.

## Tạo lại dữ liệu

Từ thư mục gốc của đồ án:

```powershell
python fraud-dashboard-vercel/scripts/build_data.py `
  --source data/processed/fraud_train_clean.parquet `
  --output fraud-dashboard-vercel/data/dashboard.json
```

Phụ thuộc Python nằm trong `requirements.txt`.

## Deploy lên Vercel

### Cách 1 — giao diện Vercel

1. Đưa thư mục `fraud-dashboard-vercel` lên một repository GitHub.
2. Chọn **Add New → Project** trong Vercel và import repository.
3. Chọn thư mục gốc của project là `fraud-dashboard-vercel` nếu repository chứa toàn bộ đồ án.
4. Framework Preset: **Other**; không cần Build Command; Output Directory để trống.
5. Deploy. Vercel tự nhận `index.html` và hai function trong `api/`.

### Cách 2 — Vercel CLI

```powershell
cd fraud-dashboard-vercel
vercel
```

## Diễn giải đúng dữ liệu

- `TransactionDayIndex` là ngày tương đối từ mốc ẩn. Chu kỳ 0–6 không phải Thứ Hai–Chủ Nhật.
- `TOTAL_FRAUD_TX_VALUE` được trình bày là **giá trị giao dịch có nhãn fraud**, không gọi là thiệt hại xác nhận.
- Khoảng tin cậy tỷ lệ dùng Wilson 95% và luôn đi cùng mẫu số `n`.
- Dashboard mô tả tập train đã có nhãn. Đây không phải mô hình dự báo hay hệ thống cảnh báo thời gian thực.
- Dataset không có trường tọa độ/địa danh đủ căn cứ, nên không thêm bản đồ.

## Cấu trúc tệp

- `index.html`: khung giao diện và nội dung cho hai user stories.
- `styles.css`: layout responsive, màu và trạng thái truy cập.
- `app.js`: nạp dữ liệu, vẽ SVG, bộ lọc và bảng giao dịch.
- `api/dashboard.js`: API serverless trả JSON tiền tổng hợp.
- `api/health.js`: endpoint kiểm tra dịch vụ.
- `data/dashboard.json`: dữ liệu đã tổng hợp để deploy.
- `scripts/build_data.py`: backend ETL tạo lại JSON từ Parquet.
- `vercel.json`: cache header và cấu hình Vercel.

