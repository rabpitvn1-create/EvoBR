# EvoBR · StoryForge Long Form

Hệ thống sáng tác tiểu thuyết trường thiên, chạy độc lập từ mã nguồn StoryForge.
Giữ giao diện Long Form gốc, AI adapter thật, xác nhận bản thảo, Canon, ký ức xuyên
chương và lưu trữ IndexedDB. Giao diện hiện giữ ngôn ngữ Trung Quốc của upstream.

## Chạy ứng dụng

Dùng Node.js 24 và npm:

```sh
npm ci
npm run dev
```

Mở `http://localhost:5173/storyforge/long`. Bản build:

```sh
npm run build
npm run preview
```

Đường dẫn mặc định là `/storyforge/` để giữ các đường dẫn kiểm thử upstream.
Có thể đặt `EVOBR_BASE_PATH=/EvoBR/` khi build cho một host có subpath khác.

## Luồng sáng tác

1. Vào **作品库**, chọn **新建长篇**, đặt tên tác phẩm.
2. Trong **通用设置**, cấu hình provider, model, Base URL và API key đang dùng.
   Adapter OpenAI-compatible và cầu nối Codex cục bộ vẫn là đường gọi thật.
3. Thiết lập thế giới ở **世界与设定**, nhân vật ở **人物与关系**, phong cách và quy tắc viết.
4. Tạo quyển và chương ở **大纲与章纲**, tạo phân cảnh ở **场景细纲**.
5. Mở **正文**, gọi AI để tạo hoặc viết tiếp. Kết quả trước tiên là candidate.
6. Kiểm tra, sửa, chấp nhận hoặc từ chối. Chỉ nội dung được chấp nhận mới đi vào bản thảo chính thức.
7. Tạo Chapter Memory và Continuity Handoff; chương sau truy xuất các chương trước,
   Canon, kiến thức nhân vật và kế hoạch tương lai qua Context Gateway.

AI cần cấu hình dịch vụ thực tế. Khi kiểm thử, chỉ phản hồi HTTP của provider được
mock; luồng giao diện, adapter, Harness, database và chấp nhận bản thảo vẫn chạy thật.
Vite giữ các proxy provider gốc. Host tĩnh cần provider cho phép CORS hoặc một proxy tương ứng.

## Dữ liệu

Database riêng: `evobr-longform`. Dữ liệu tồn tại qua tải lại ở cùng trình duyệt,
origin và cổng. Dùng **版本与导出** để tạo backup JSON đầy đủ hoặc xuất bản thảo.
Không đổi origin/cổng rồi kỳ vọng IndexedDB tự di chuyển. Các bản backup chứa dữ liệu
sản phẩm ngoài phạm vi được từ chối thay vì bị âm thầm cắt bỏ.

Không có số chương tối đa hoặc kết thúc bắt buộc. Mục tiêu số chữ và thao tác hoàn
tất tác phẩm là lựa chọn của tác giả.

## Kiểm tra

```sh
npm run ci
npx playwright install --with-deps chromium
npm run ci:e2e
```

CI kiểm tra registry, dependency closure, AI entry, TypeScript, hồi quy, build và
luồng trình duyệt. Các bài E2E chạy trên bản nguồn đóng băng và dữ liệu riêng.
Xem [phạm vi chuyển giao](docs/IMPORT.md), [nguồn và giấy phép](UPSTREAM.md).
