/** Giá kiểu Việt Nam, VD 289.000đ */
export const vnd = (n: number) => `${n.toLocaleString("de-DE")}đ`;

/**
 * Bỏ Markdown model hay viết (**đậm**, __đậm__, # tiêu đề): Messenger và Telegram (gửi chữ thường) hiện nguyên dấu.
 * Giữ gạch đầu dòng "- " và mã [SP...] vì shop dùng chúng để nhận ra món được gợi ý.
 */
export function boMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}
