// Zero-dependency PNG dimension reader (IHDR chunk: width@16, height@20, big-endian)
function pngSize(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("not a PNG file");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

module.exports = { pngSize };
