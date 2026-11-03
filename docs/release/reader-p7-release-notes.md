# EvoBR Reader P7: bản ghi phát hành và hướng dẫn nghiệm thu cuối

**Trạng thái:** P7 đang nghiệm thu. Chưa merge vào `main`, chưa gắn tag/release production. Repo: `rabpitvn1-create/EvoBR`, nhánh tích hợp `feat/import-storyforge-longform`; mọi sửa P7 phải qua PR riêng `feat/p7-release-verification`.

## Chạy Reader

Yêu cầu Node.js 24 và npm. Dùng trình duyệt có IndexedDB và giữ nguyên origin để không mất liên kết tới dữ liệu đã lưu.

```sh
npm ci
npm run dev
```

Mở `http://localhost:5173/storyforge/long`, tạo hoặc chọn một tác phẩm Long Form, rồi nhấn **Mở Reader · Đọc truyện**. Trong Reader, nhấn **+ Tạo mới** để sinh turn mở đầu; các lần tiếp theo chọn một lựa chọn thực của turn đã xuất bản hoặc **Đọc tiếp** nếu hệ thống chỉ có Continue. Mở lại session từ danh sách hoặc tải lại trang để đọc tiếp. Chọn **Rẽ nhánh từ đây** ở một trang cũ để fork mà không sửa lịch sử parent.

Tất cả prose hiển thị lấy từ Reader turn có receipt đã commit. Không có streaming candidate. Nếu kết nối gián đoạn và màn hình báo trạng thái chưa rõ, chọn **Kiểm tra biên nhận**; nút này không tự gọi lại model. Không nhấn tạo lượt mới khi một request cũ chưa được xác định là đã commit hay chưa.

## Provider và model

Vào mục **通用设置** của ứng dụng, điền provider, model và Base URL thực tế. Ví dụ không có key thật: [reader-provider.example.json](./reader-provider.example.json). Trường `apiKey` để rỗng khi proxy tự quản lý xác thực hoặc nhập giá trị ở cấu hình cục bộ theo yêu cầu của provider. Không commit API key hay endpoint bí mật vào tệp test/gợi ý. Đường Reader đi qua client chính thức `src/lib/ai/client.ts`, entry/Skill formal P4 và coordinator P5, không có một bộ HTTP thay thế trong production.

Theo D2: mặc định transport retry bằng 0, choice retry bằng 0 (cho phép 0..2 khi cấu hình), trần cứng 6 model call trong một lượt. V3 review là **correlated judge**, dùng cùng provider/model với người viết, không được mô tả là kiểm duyệt độc lập. Provider thật sẽ được Muse gọi trên máy của Muse, ngoài CI; không suy từ HTTP mock ra giá trị chi phí/độ trễ thực.

## Kiến trúc P0–P6

| Chặng | Vai trò |
| --- | --- |
| P0 | Hợp đồng D1–D10, ma trận Q/D/C/V/P, quyền Canon và quyết định release |
| P1 | Giọng văn Việt `restrained_intimate`, 20 lượt mỗi hồ sơ, phê duyệt chất lượng Muse |
| P2 | Dexie 9 bảng Reader; baseline Canon bất biến, registry, import/export và fork |
| P3 | Effective lineage, Context Gateway phân vùng session, confirmed facts, memory readiness/saga |
| P4 | Sinh prose → V3 review/revision khi cần → lựa chọn trích dẫn nguyên văn → choice-verifier |
| P5 | Publication coordinator, một transaction adopt/CAS/receipt, replay theo requestKey, saga hậu commit |
| P6 | Mobile-first Reader, đọc từ receipt, session/fork, sân khấu tĩnh với hint allowlist và asset slot |

Không đưa quests, combat, Game Master, inventory, forced ending hoặc chức năng editor mới vào Reader.

## Kiểm chứng release và EVOBR_BASE_PATH

Mặc định Vite có base `/storyforge/`. Với GitHub Pages dưới repo `EvoBR`, **phải** build bằng đúng subpath `/EvoBR/`, không dùng asset URL gốc `/storyforge/`:

```sh
npm run ci
npx playwright install --with-deps chromium
npm run ci:e2e
git diff --check
EVOBR_BASE_PATH=/EvoBR/ npm run build
node scripts/verify-reader-production-build.mjs dist /EvoBR/
```

Dùng `npm run preview` với base của lần build đang thử nếu kiểm tra thủ công. Script cuối kiểm tra đường dẫn hashed JS/CSS và base trong `dist/index.html`; CI P7 cũng chạy bản build production với `EVOBR_BASE_PATH=/EvoBR/`, đồng thời kiểm `git diff --check` cho PR. **Không push sang Pages/main khi chưa được chủ nhân quyết định.**

Ảnh nền và overlay chỉ là ô đăng ký trong [reader-stage-assets.md](../reader-stage-assets.md); không có artwork thật. Khi thiếu ảnh/hint, Reader chuyển về văn bản thuần. Hints chỉ là dữ liệu trình bày, không được nâng lên thành Canon.

## Runbook provider thật: Muse P7, tối thiểu 10 turn trên active lineage

**Không chạy bằng fake HTTP hoặc mock.** Muse dùng browser/Node24 trên môi trường của Muse và proxy thật; bắt đầu từ HEAD P7 đã xanh CI, trong origin thử nghiệm có data riêng. Ghi SHA và cấu hình đã ẩn secret; không ghi đầy đủ prompt, API key hay URL riêng tư.

1. Tạo Work + World với Canon xác nhận; khởi tạo root Reader. Sinh **6 turn đã publish** bằng provider thật, gồm opening và 5 lựa chọn. Sau mỗi lượt kiểm `readerPublicationRuns`, `readerTurns`, choices và decision theo ID/receipt, V3 PASS trước choices; tổng model call mỗi lượt không vượt 6.
2. **Fork từ turn thứ 4** để tạo child session. Kiểm child chỉ có prefix 1–4, không nhìn thấy turn thứ 5–6 của root. Ở child sinh **6 lượt tiếp theo** bằng provider thật: active lineage child lúc cuối có đúng **10 turn** (4 inherited + 6 mới). Tổng cộng có **12 lượt thật đã xuất bản** qua hai session; không đánh đồng 12 lượt với độ dài lineage 10.
3. Sau ít nhất turn child thứ 3, **tải lại trang** và đọc lại receipt, head, thứ tự lựa chọn, session revision và trạng thái pending. Không có model call thêm do replay. Đảm bảo root vẫn giữ nguyên 6 turn.
4. Ở turn cuối, kiểm tra P3 `readerMemory`, `readerFacts`, `readerKnowledge` và retrieval nếu đã phát sinh: mỗi đoạn trích phải thuộc lineage hợp lệ; pending summary được phép dùng full-text khi đủ budget (C11), còn khi phải nén thì chỉ summary ready của prefix chính xác + suffix mới được chạy (C12). Không đặt độ dài cố định để giả tạo việc nén; nếu chưa chạm giới hạn context, ghi **C12 compression long-run: chưa phát sinh**, vẫn có regression riêng.
5. Mỗi lượt ghi topology stage và status, model thực do provider trả về, usage input/output, thời gian per-call, retry thực, hash prose và manifest, số branch sống sót, số Continue fallback, mọi lỗi. Cùng model làm reviewer thì `correlatedJudge=true`. Giá token hoặc billed cost không được cung cấp thì ghi `null`. Với trường hợp V3 tự phát sinh revision/rereview, ghi nhận hashes/stage thật; **không** chỉnh tay output provider để gọi đó là revision tự nhiên.
6. Cuối phiên kiểm lịch sử bất biến, không xuất hiện candidate mồ côi, số receipt so với turn xuất bản, trạng thái memory saga sau reload và các lỗi còn mở. Nếu lỗi xảy ra, gửi Muse chính xác turn/session, stage, dấu hiệu, log đã che thông tin nhạy cảm cho PR P7 sửa và chạy CI lại.

**Mẫu báo cáo được khuyến nghị:** SHA, branch, provider/model (đã ẩn auth), số root/child/effective turns, tổng API calls, số stage PASS/BLOCK, số revision thực, token tổng, latency p50/p95, billed/estimated USD hoặc `null`, fork/refresh PASS/FAIL, full-text vs ready-summary, pending saga, vấn đề phát hiện. Muse phải tự xác nhận và ký kết quả; em không tự gọi một phiên mock là provider thật.

## Danh sách nợ/rủi ro còn mở

* **Art thật:** chưa có background/ảnh Cao Minh/ảnh thực thể trong các slot `public/reader-assets`. Chỉ hợp đồng mapping và fallback đã kiểm thử; giao diện sẽ ở chế độ chữ thuần cho tới khi art thật được thêm.
* **V3 natural revision:** P4 Muse đã kiểm V13 bằng provider thật, review pass và 3 branch sống sót; callback revision/rereview thật chưa tự phát sinh. Nếu P7 long-run vẫn không phát sinh, ghi rủi ro tồn dư chứ không ép tạo lỗi.
* **Correlated judge:** reviewer cùng model với prose writer; đúng thiết kế nhưng không đảm bảo đánh giá độc lập.
* **Chi phí thực:** P1 chưa có đơn giá/billing; thống kê mock không thay thế USD thực. Cần kết quả đo P7, để `null` nếu thiếu.
* **P7 real long-run:** Muse chưa nộp biên bản xác nhận trong repo; chặng này chưa đạt cho tới khi có bằng chứng.
* **IndexedDB cục bộ:** không có cross-device sync. Đổi browser/origin có thể khiến dữ liệu cũ không còn truy cập cùng nơi; cần backup/restore theo hợp đồng P2.

Chi tiết 51 ca ở [reader-p7-51-case-matrix.md](./reader-p7-51-case-matrix.md).

**Gate cuối:** CI xanh chưa đủ để khẳng định kiểm thử dài hạn provider thật. Muse review PR P7 và trình chủ nhân quyết định có merge nhánh tích hợp vào `main` hay phát hành; **không tự merge**.
