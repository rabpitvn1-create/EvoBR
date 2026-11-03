/**
 * Versioned Vietnamese prose voice instructions for the P1 selection round.
 * Each profile changes STYLE only; scenario, Canon, continuation and transport
 * rules remain identical. IDs are organizer metadata and never in blind packets.
 */
export const VOICE_PROFILES_V1 = Object.freeze({
  cinematic_minimal: {
    version: 1,
    label: 'Lạnh, tối giản, điện ảnh',
    instruction: [
      'Giữ giọng kể lạnh và tiết chế, góc nhìn quan sát gần hành động của Cao Minh.',
      'Ưu tiên vật thể, âm thanh, ánh sáng và chuyển động cụ thể; câu gọn, khoảng lặng có dụng ý.',
      'Nỗi sợ hiện ra qua sai khác nhỏ của không gian, không qua lời giải thích dài hoặc từ ngữ cường điệu.',
      'Đừng biến toàn bộ đoạn thành kịch bản quay phim; vẫn phải là văn xuôi có chiều sâu.',
    ].join('\n'),
  },
  sensory_urgent: {
    version: 1,
    label: 'Giàu hình ảnh, nhịp dồn dập',
    instruction: [
      'Tạo văn xuôi giàu hình ảnh vật chất, nhiều biến thiên nhịp câu và cảm giác trực tiếp.',
      'Dùng sức ép của âm thanh, nhiệt độ, bề mặt và khoảng cách để đẩy diễn tiến cảnh.',
      'Nhịp nhanh nhưng mọi chuyển động phải có nguyên nhân, vị trí và hậu quả rõ ràng.',
      'Tránh tu từ chất đống, ví von vô căn cứ và lặp cùng một chi tiết cảm giác.',
    ].join('\n'),
  },
 psychological_slow: {
    version: 1,
    label: 'Chậm, ám ảnh tâm lý',
    instruction: [
      'Tập trung những chuyển động rất nhỏ của nhận thức, trí nhớ và nghi ngại ở Cao Minh.',
      'Nhịp kể chậm có chủ đích; sự bất an tích lũy từ bất định giữa điều anh thấy và điều anh suy đoán.',
      'Không tự bịa quá khứ, ký ức hoặc tổn thương như sự thật đã có trước khi truyện bắt đầu.',
      'Mỗi đoạn vẫn cần một phát hiện hoặc hành động thực làm biến đổi thế khó.',
    ].join('\n'),
  },
  restrained_intimate: {
    version: 1,
    label: 'Nội tâm tiết chế, giàu sức nặng',
    instruction: [
      'Kể bằng giọng gần người đọc, điềm tĩnh nhưng thấm cảm giác sống còn của Cao Minh.',
      'Cân bằng chi tiết ngoại cảnh chính xác với phản ứng nội tâm ít lời; mỗi hình ảnh phải phục vụ một quyết định hoặc hệ quả.',
      'Để cảm xúc bật ra từ lựa chọn khó và sự thiếu chắc chắn, không phô diễn lời than hoặc tự bình luận văn chương.',
      'Giữ động lực tiến về phía trước, nhịp câu biến thiên tự nhiên, kết đoạn mở một câu hỏi nhân quả.',
    ].join('\n'),
  },
})
export const TOURNAMENT_PROFILES_V1 = Object.freeze([
  'cinematic_minimal',
  'sensory_urgent',
  'psychological_slow',
  'restrained_intimate',
])
export function getVoiceProfileV1(id) {
  if (!Object.hasOwn(VOICE_PROFILES_V1, id)) throw Error('Unregistered P1 voice profile: ' + id)
  return VOICE_PROFILES_V1[id]
}
