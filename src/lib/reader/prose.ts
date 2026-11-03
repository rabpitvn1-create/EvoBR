import type { ChatMessage } from '../types'
import type { ReaderFrozenContextAssemblyV1 } from './context'

/**
 * Exact selected P1 system prompt + restrained_intimate instruction from
 * scripts/quality-evals/reader-voice-profiles.mjs. P1 tournament selection:
 * restrained_intimate. Keep this copy byte-identical to that profile.
 */
export const READER_PROSE_PROMPT_VERSION_V1 = 'reader-prose-restrained-intimate-vi-v1'
export const READER_P1_BASELINE_SYSTEM_PROMPT_V1 = [
  'Bạn là người viết tiểu thuyết kinh dị tâm lý bằng tiếng Việt tự nhiên.',
  'Viết một đoạn văn xuôi hoàn chỉnh, có diễn tiến nhân quả và điểm neo cảm xúc.',
  'Chỉ xuất văn xuôi, không tiêu đề, không Markdown, không phân tích hay lựa chọn.',
  'Giữ nguyên dữ kiện của tất cả những lượt truyện trước.',
  'Không thêm nhân vật có tên hoặc lore được xem là Canon khi chưa có dữ kiện.',
  'Tránh lặp công thức văn, tránh kể lại nguyên văn đoạn vừa rồi.',
  'Mỗi lượt khoảng 180–300 từ nếu khả thi; ưu tiên tính tự nhiên và continuity.',
].join('\n')
export const READER_P1_RESTRAINED_INTIMATE_INSTRUCTION_V1 = [
  'Kể bằng giọng gần người đọc, điềm tĩnh nhưng thấm cảm giác sống còn của Cao Minh.',
  'Cân bằng chi tiết ngoại cảnh chính xác với phản ứng nội tâm ít lời; mỗi hình ảnh phải phục vụ một quyết định hoặc hệ quả.',
  'Để cảm xúc bật ra từ lựa chọn khó và sự thiếu chắc chắn, không phô diễn lời than hoặc tự bình luận văn chương.',
  'Giữ động lực tiến về phía trước, nhịp câu biến thiên tự nhiên, kết đoạn mở một câu hỏi nhân quả.',
].join('\n')
export const READER_PROSE_SYSTEM_PROMPT_V1 =
  READER_P1_BASELINE_SYSTEM_PROMPT_V1
  + '\n\nCHỈ ĐẠO GIỌNG VĂN (không sửa Canon):\n'
  + READER_P1_RESTRAINED_INTIMATE_INSTRUCTION_V1

export function buildReaderProseMessagesV1(
  frozen: ReaderFrozenContextAssemblyV1,
  selectedDecision: string | null,
): ChatMessage[] {
  return [
    { role: 'system', content: READER_PROSE_SYSTEM_PROMPT_V1 },
    { role: 'user', content: [
      'TIẾP NỐI TIỂU THUYẾT READER. Chỉ văn xuôi tiếng Việt, không lựa chọn.',
      'Các nguồn sau đã được Gateway xác thực và đóng băng cho đúng session.',
      'Tuyệt đối không thêm dữ kiện Canon có tên hoặc dự đoán tương lai như sự thật.',
      'Dữ kiện World/Work chỉ lấy từ reader.baseline, không suy diễn từ tác phẩm biên tập đang thay đổi.',
      'NGUỒN READER ĐÃ ĐÓNG BĂNG:',
      frozen.assembly.text,
      'QUYẾT ĐỊNH VỪA CHỌN:',
      selectedDecision ?? '(mở đầu truyện, chưa có quyết định)',
      'Hãy viết một lượt tiếp diễn có nhân quả và cảm xúc, không đưa menu lựa chọn.',
    ].join('\n\n') },
  ]
}

export function assertReaderVietnameseProseV1(text: string): void {
  if (typeof text !== 'string' || text.trim().length < 40) {
    throw Error('[readerProse] candidate must contain nontrivial Vietnamese prose')
  }
  if (!/[ăâđêôơưĂÂĐÊÔƠƯ]/u.test(text) || !/[.!?…]/u.test(text)) {
    throw Error('[readerProse] candidate fails conservative Vietnamese prose gate')
  }
  if (/^\s*(?:```|\{\s*"choices"|\[\s*\{\s*"choiceKey")/u.test(text)
    || /(?:^|\n)\s*(?:lựa chọn|chọn một|options?)\s*:/imu.test(text)) {
    throw Error('[readerProse] prose stage cannot return choices or structured output')
  }
}
