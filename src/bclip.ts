export type ClipChannel = { name: string; values: readonly number[] };

/** TouchDesigner legacy bcli: big-endian, length-prefixed packets. See docs/motion-metrics.md. */
export function encodeBclip(channels: readonly ClipChannel[], rate = 30): ArrayBuffer {
  const samples = channels[0]?.values.length ?? 0;
  if (!samples || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(Math.fround(rate))) throw new Error('A bclip needs samples and a positive finite sample rate.');
  const names = new Set<string>();
  for (const channel of channels) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel.name) || channel.name.length > 65535 || names.has(channel.name)) throw new Error('Bclip channel names must be unique ASCII identifiers.');
    names.add(channel.name);
    if (channel.values.length !== samples || channel.values.some(v => !Number.isFinite(Math.fround(v)))) throw new Error('Bclip channels must have equal sample counts and finite float32 values.');
  }
  const trackBytes = channels.reduce((sum, c) => sum + 10 + c.name.length + 36 + 8 + samples * 4 + 8, 0);
  const size = 4 + 12 + 16 + 12 + 12 + trackBytes + 8;
  if (size > 512 * 1024 * 1024) throw new Error('Bclip exceeds the 512 MB export limit. Choose a shorter range.');
  const buffer = new ArrayBuffer(size), view = new DataView(buffer);
  let offset = 0;
  const u32 = (value: number) => { view.setUint32(offset, value); offset += 4; };
  const packet = (size: number, group: number, type: number) => { u32(size); view.setUint16(offset, group); view.setUint16(offset + 2, type); offset += 4; };
  const f32 = (value: number) => { view.setFloat32(offset, value); offset += 4; };
  u32(0x62636c69); // bcli, TouchDesigner's float32 clip variant (not renamed ASCII).
  packet(12, 15, 1); f32(rate);
  packet(16, 15, 2); view.setFloat64(offset, 0); offset += 8;
  packet(12, 15, 3); u32(samples);
  packet(12 + trackBytes, 15, 5); u32(channels.length);
  for (const channel of channels) {
    packet(10 + channel.name.length, 16, 1);
    view.setUint16(offset, channel.name.length); offset += 2;
    for (const char of channel.name) view.setUint8(offset++, char.charCodeAt(0));
    // Native defaults: hold before/after the range, zero default value.
    for (const type of [3, 4, 5]) { packet(12, 16, type); u32(0); }
    packet(8 + samples * 4, 16, 2); channel.values.forEach(f32);
    packet(8, 16, 0);
  }
  packet(8, 15, 0);
  return buffer;
}
