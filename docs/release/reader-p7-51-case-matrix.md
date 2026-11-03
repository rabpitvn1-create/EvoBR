# P7 · Ma trận truy vết hợp nhất 51 ca

**Nguồn chuẩn:** [P0.5 §3](../p0/05-implementation-plan-and-regression-matrix.md). Ngày đối chiếu: 2026-11-03. Nhánh nền: `feat/import-storyforge-longform` tại merge P6 `7e01c01d`; kiểm chứng cuối dùng HEAD của PR P7. Bảng là bản đồ **bằng chứng**, không có nghĩa mọi bài test đều là kiểm chứng provider thật.

**Quy ước:** `Tự động` là ca đã có test chạy trong `npm run ci` / `npm run ci:e2e`, chỉ được coi PASS khi run cuối trên PR đạt. `Ngoài CI` là Muse báo cáo chạy real-provider, không được giả làm test local. `Một phần` chỉ rõ khoản nợ và không cho phép đánh dấu hoàn tất tùy tiện. Các ca trước P7 vẫn giữ nguyên chủ sở hữu và hợp đồng, không có ID bị loại khỏi ma trận.

| ID | Bằng chứng / mã thử | Phạm vi đã đối chiếu | Trạng thái |
| --- | --- | --- | --- |
| Q01 | `docs/evaluations/reader-baseline-conclusion.md` + `scripts/quality-evals/reader-voice-tournament.test.mjs` | Muse đã báo cáo đánh giá mù 80 lượt; không có raw score/organizer artifacts ở repo | Báo cáo ngoài CI |
| Q02 | `docs/evaluations/reader-baseline-conclusion.md` + `docs/evaluations/reader-p4-v13-smoke-protocol.md` | P1 có 489.836 token tổng, p50/p95; chưa có giá token và dữ liệu chi tiết P4/P7 | Một phần, P7 provider thật còn thiếu |
| D01 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D01` | Dexie v13 → v14, giữ dữ liệu | Tự động |
| D02 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D02 + D02 negative` | Sibling facts và parent lạ bị từ chối | Tự động |
| D03 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D03` | Nested fork prefix bất biến | Tự động |
| D04 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D04` | Identity/publication immutable | Tự động |
| D05 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D05` | Archive có tham chiếu vẫn giữ FK | Tự động |
| D06 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D06` + `R-READER-D07-portable-lineage.test.ts` | Backup nested fork + decision + receipt | Tự động |
| D07 | `tests/regression/R-READER-D07-portable-lineage.test.ts` | Deferred nullable pointers, self-tree, missing parent rollback | Tự động |
| D08 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D08` + `R-READER-P3-context-memory.test.ts::C06 concurrent` | Baseline pinned confirmed-only và cùng snapshot | Tự động |
| D09 | `tests/regression/R-READER-P2-persistence-contract.test.ts::D09` | Missing source/hard cap fail-closed | Tự động |
| C01 | `tests/regression/R-READER-P3-context-memory.test.ts::C01` | Ancestor cutoff, sibling isolation | Tự động |
| C02 | `tests/regression/R-READER-P3-context-memory.test.ts::C02` | Sibling confirmed facts riêng | Tự động |
| C03 | `tests/regression/R-READER-P3-context-memory.test.ts::C03` | Chỉ confirmed có quote/hash | Tự động |
| C04 | `tests/regression/R-READER-P3-context-memory.test.ts::C04` | Không override Canon | Tự động |
| C05 | `tests/regression/R-READER-P3-context-memory.test.ts::C05` | Baseline thiếu hoặc bị sửa bị chặn | Tự động |
| C06 | `tests/regression/R-READER-P3-context-memory.test.ts::C06 + C06 concurrent` | Work edit không làm thay đổi snapshot | Tự động |
| C07 | `tests/regression/R-READER-P3-context-memory.test.ts::C07` + `R-READER-P4-generation-v3.test.ts::V01/V02` | Shared frozen packet và V3 | Tự động |
| C08 | `tests/regression/R-READER-P3-context-memory.test.ts::C08` | Session/baseline/lineage/policy cache isolation | Tự động |
| C09 | `tests/regression/R-READER-P3-context-memory.test.ts::C09` | Unreachable chunk và hash sai | Tự động |
| C10 | `tests/regression/R-READER-P3-context-memory.test.ts::C10` | Budget thiếu mandatory chặn | Tự động |
| C11 | `tests/regression/R-READER-P3-context-memory.test.ts::C11` | Đường full-text khi saga pending | Tự động |
| C12 | `tests/regression/R-READER-P3-context-memory.test.ts::C12` | Summary phải ready và contiguous | Tự động |
| C13 | `tests/regression/R-READER-P3-context-memory.test.ts::C13` | Fork cutoff của summary | Tự động |
| C14 | `tests/regression/R-READER-P3-context-memory.test.ts::C14` | Saga retry idempotent và prose bất biến | Tự động |
| V01 | `tests/regression/R-READER-P4-generation-v3.test.ts::V01` | Review pass trước choices | Tự động |
| V02 | `tests/regression/R-READER-P4-generation-v3.test.ts::V02` | Revision mock thay final prose | Tự động |
| V03 | `tests/regression/R-READER-P4-generation-v3.test.ts::V03` | Block/fake evidence ngăn choices | Tự động |
| V04 | `tests/regression/R-READER-P4-generation-v3.test.ts::V04` | sourceQuote nguyên văn | Tự động |
| V05 | `tests/regression/R-READER-P4-generation-v3.test.ts::V05` | Choice verifier loại mâu thuẫn | Tự động |
| V06 | `tests/regression/R-READER-P4-generation-v3.test.ts::V06` | Continue hợp lệ + retry có trần | Tự động |
| V07 | `tests/regression/R-READER-P4-generation-v3.test.ts::V07` + `R-READER-P5-publication.test.ts::P6 hints` | Invalid hint không veto | Tự động |
| V08 | `tests/regression/R-READER-P4-generation-v3.test.ts::V08` | Skill/caller quyền cố định | Tự động |
| V09 | `tests/regression/R-READER-P4-generation-v3.test.ts::V09` | Failure không xuất bản | Tự động |
| V10 | `tests/regression/R-READER-P4-generation-v3.test.ts::V10` | correlatedJudge=true | Tự động |
| V11 | `tests/regression/R-READER-P4-generation-v3.test.ts::V11` | Vietnamese reader, editor Chinese unchanged | Tự động |
| V12 | `tests/regression/R-READER-P4-generation-v3.test.ts::V12` | Manifest/head tamper từ chối | Tự động |
| V13 | `docs/evaluations/reader-p4-v13-smoke-protocol.md` + `Muse real-provider V13 2026-11-03` + `R-READER-P4-real-client-transport.test.ts` | Muse đã báo cáo 4 call thật và 3 branch; callback revise/rereview thật chưa tự xảy ra | Một phần: real pass, revision pending |
| P01 | `tests/regression/R-READER-P5-publication.test.ts::P01` | Opening/receipt/no decision | Tự động |
| P02 | `tests/regression/R-READER-P5-publication.test.ts::P02` | Continue là choice có numeric ID | Tự động |
| P03 | `tests/regression/R-READER-P5-publication.test.ts::P03/P09` | CAS hai requestKey | Tự động |
| P04 | `tests/regression/R-READER-P5-publication.test.ts::P04` | Adopt choices short-write rollback | Tự động |
| P05 | `tests/regression/R-READER-P5-publication.test.ts::P05` | CAS skip rollback | Tự động |
| P06 | `tests/regression/R-READER-P5-publication.test.ts::P01/P06/P07` | Receipt replay không model call | Tự động |
| P07 | `tests/regression/R-READER-P5-publication.test.ts::P01/P06/P07` | Fingerprint conflict | Tự động |
| P08 | `tests/regression/R-READER-P5-publication.test.ts::P08` | Reject source/choice ngoại phạm vi | Tự động |
| P09 | `tests/regression/R-READER-P5-publication.test.ts::P03/P09` + `R-READER-P4-generation-v3.test.ts::V12` | Stale candidate không reuse | Tự động |
| P10 | `tests/regression/R-READER-P5-publication.test.ts::P10` + `tests/regression/R-READER-P7-release.test.ts::P10` | CAS và lỗi receipt writer rollback | Tự động |
| P11 | `tests/e2e/reader-p6-ui.spec.ts` + `tests/e2e/reader-p7-recovery.spec.ts` + `tests/regression/R-READER-P5-publication.test.ts::P11/P12` | Reload pending/uncertain + receipt readback, không hiển thị candidate | Tự động |
| P12 | `tests/regression/R-READER-P3-context-memory.test.ts::C11/C12/C14` + `R-READER-P5-publication.test.ts::P11/P12` | Saga hậu commit, memory readiness | Tự động |
| P13 | `tests/e2e/reader-p5-publication.spec.ts::P13` + `reader-p6-ui.spec.ts` | Browser IndexedDB refresh receipt/head/decisions | Tự động |

**Tổng:** 51 ca = Q02 + D09 + C14 + V13 + P13. Không có ca "không áp dụng". Tự động hóa không thể thay thế Q01, Q02 và V13 real-provider.

## Các khoảng trống không được giấu

1. **Q01:** hồ sơ Muse xác nhận blind scoring và giọng thắng `restrained_intimate`, nhưng raw report/organizer không nằm trong repo. Không tuyên bố tái lập độc lập.
2. **Q02:** P1 ghi 489.836 token qua 80 call, p50 6.410 ms, p95 9.983 ms; **cost USD không có giá token nên phải là `null`**. Chưa có bảng giá/cost/latency P7 thực tế. Biên bản P7 ghi usage/cost `null` nếu provider không trả.
3. **V13:** Muse đã xác nhận smoke thật ở P4 với bốn stage, quote nguyên văn và V3 pass; **revision/rereview thật chưa xảy ra tự nhiên**. P7 đánh giá lại nếu có tình huống thực, tuyệt đối không ép model để hợp thức hóa.
4. **P11:** thêm E2E P7 với request bị treo trong prose/review/choices/verifier, reload và tra receipt; không tự gửi lại một request chưa chắc đã commit. P10 bổ sung lỗi ở thời điểm ghi receipt, khác với chỉ CAS skip.
5. **P7 long-run:** yêu cầu ít nhất 10 turn trên lineage đang đọc, fork/tải lại/kiểm tra memory bằng provider thật do Muse chạy. Cho tới khi có báo cáo, nghiệm thu tích hợp P7 **đang chờ**.

## Quy tắc phê duyệt cuối

CI cho phần mã nguồn cần cả `npm run ci`, `npm run ci:e2e`, `git diff --check` và production build `EVOBR_BASE_PATH=/EvoBR/`; log của run mới nhất trên PR là thẩm quyền. Merge P7 chỉ theo Muse; **không hợp nhất `feat/import-storyforge-longform` vào `main`** nếu chủ nhân chưa quyết định.
