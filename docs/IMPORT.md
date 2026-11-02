# Phạm vi chuyển StoryForge Long Form

## Nguồn và phương pháp

Nguồn được chốt tại `9b4cb04be0605f51520fe8fa34eb4e94c2204cd3` của
`yuanbw2025/storyforge`. EvoBR ban đầu chỉ có README tại commit
`6a6a8a438cb27e2c7bc4fe6eec95e62f46a4b05e`.

Đã đọc AGENTS, README.en, Context Routing, Longform and Node, manifest và lockfile.
Truy vết từ trang Library, Workspace, Settings, store khởi động và ba registry,
gồm import/export, import động, type import, Worker URL, CSS và asset.
Một closure thô của các trang upstream kéo theo hơn 2.000 module do các registry
đăng ký cả sản phẩm khác. Bản chuyển tách các điểm dispatch đó trước khi tính lại closure.

Đây là phát triển năng lực sản phẩm Long Form độc lập. Work sở hữu tác phẩm;
World sở hữu thế giới/nhân vật trong workspace; không có runtime S2/S3 của trò chơi.

## Giữ lại

* Library và Workspace Long Form, các panel thế giới, Canon, nhân vật, quan hệ,
  trạng thái, kiến thức, cốt truyện, chương, phân cảnh, bản thảo và sửa bản thảo.
* Agent, Skills, Run Contracts, durable events/checkpoints, candidate, stale,
  revision, xác nhận/từ chối và các receipt kiểm chứng.
* Context Gateway, CONTEXT_SOURCES, FIELD_REGISTRY, AdoptionSchema và adopt().
* Chapter Memory, continuity handoff, plan reconciliation, tóm tắt phân tầng,
  retrieval, fact/knowledge ledger, consistency, phục bút, lịch sử và timeline.
* Story Arc, Storyline Progress, character-driven planning, Future Evolution,
  impact analysis và tái lập kế hoạch các chương tương lai.
* Cấu hình model/provider/Base URL/API key, streaming và JSON adapter thật,
  task routing, usage, proxy Vite và local Codex bridge.
* TipTap, Zustand, Dexie, React 19, TypeScript và Vite theo hệ nguồn.
* Version history, JSON backup/restore, nhập tài liệu, xuất bản thảo và lưu thư mục.
* Node authoring và Agent orchestration dùng chung backend Long Form; không tạo backend thứ hai.
* Projection/codec/query thế giới trung lập cần cho Canon, registry và backup.
  Không cung cấp sản phẩm World Engine độc lập hoặc UI xuất bản thế giới.

## Những chỗ phải thích ứng

* App chỉ mở Library, Workspace và Settings Long Form. Navigation không còn các sản phẩm khác.
* Ba registry và formal AI entry chỉ đăng ký phần còn dùng trong profile này.
  Lifecycle extensions của workspace, world, work và chương giữ nguyên đường ghi,
  chỉ bỏ caller thuộc sản phẩm đã loại.
* Schema 13 dùng chính index upstream của 72 bảng được giữ, trong database mới
  `evobr-longform`. Không mở/migrate database `storyforge-core` của upstream.
* Generic backup/remapping và durable ledger rebinding được giữ; validator/dispatch
  riêng cho sản phẩm bị loại cũng bị loại. Backup có dữ liệu sản phẩm khác bị chặn
  trước transaction, tránh mất dữ liệu do bỏ qua bảng không hỗ trợ.
* Work creation/restore chỉ nhận novel/long. Runtime/Build owner và upper-product
  production bị từ chối rõ ràng, không được giả lập thành kết quả thành công.
* Tool schema được cấp version và fingerprint riêng cho bộ công cụ thu gọn.
* Hai contract hàng narrative beat/choice được tách nguyên bản từ product-release;
  không kéo theo executable game hoặc release pipeline của sản phẩm khác.
* Thêm zod thành dependency trực tiếp với đúng phiên bản đã có trong lockfile nguồn,
  vì adapter lỗi Codex vốn import nó qua dependency bắc cầu của MCP. Bỏ MCP,
  Electron, Android build, Three.js, website docs và các dependency không còn dùng.
* Chỉ giữ 5 ảnh theme nhỏ mà CSS thật tham chiếu và một SVG logo; không có game media.

## Loại bỏ

Text Adventure/Quest, Text Open World, TTRPG, AVG, character chat, AI town,
Motion Drama, comic, screenplay, short novel độc lập; product production/runtime,
game mẫu, tài nguyên nặng, build/cache và website/desktop/mobile packaging upstream.

Các bài kiểm thử trộn nhiều sản phẩm được thu gọn về các assertion Long Form;
không vô hiệu hóa kiểm tra chấp nhận, stale hoặc lỗi dữ liệu. Bốn cổng offline
Narrative World author/reader evaluation cần corpus và lịch sử model riêng không
được chuyển. Các bài codec, hash, narrative context và Long Form tương ứng vẫn giữ.
Hai bài bị skip sẵn trong upstream được ghi nhận riêng khi chạy suite.

## Các điểm để kết nối Backrooms sau này

1. Đưa Canon và danh mục Snapshot có keyword vào nguồn Context được đăng ký,
   kèm owner, version, provenance và ngân sách truy xuất. Chưa thêm nguồn đó ở bước này.
2. Chốt schema kịch bản/sự kiện để Game Core thực thi. Kết quả combat phải có
   chủ sở hữu và luồng xác nhận riêng, không ghi thẳng vào Canon của tác phẩm.
3. Tự động viết chương kế tiếp cần một lớp điều phối có quyền tác giả rõ ràng,
   ngân sách, điều kiện dừng/lỗi và xử lý candidate/stale. Hiện không bỏ nút xác nhận,
   không tự gọi adopt(), không tự thêm nhiệm vụ hoặc ending.
4. Post-adoption memory hiện giữ các chế độ off/suggest/auto-with-budget gốc.
   Quyền tạo ký ức sau chấp nhận không đồng nghĩa quyền tự chấp nhận chương tiếp theo.

## Giới hạn bằng chứng

Kiểm thử tự động dùng provider HTTP giả lập qua adapter thật. Không có báo cáo
chất lượng văn học với model trả phí hoặc tuyên bố tác phẩm có độ dài vô hạn.
Cấu trúc không áp đặt số chương cố định; khả năng tiếp tục phụ thuộc provider,
ngân sách và tài nguyên trình duyệt. Giữ xác nhận của tác giả và fallback hiện hữu.
