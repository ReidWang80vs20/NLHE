/**
 * 直接解析 Windows 快捷方式(.lnk)二进制，读取其真实属性。
 * Parse the Windows shortcut (.lnk) binary directly to read its real properties.
 *
 * 为什么不用 PowerShell/COM 回读：
 * Why not read it back via PowerShell/COM:
 * powershell.exe 经 -File 传非 ASCII（中文）参数不可靠 —— 实测参数到手为空值，
 * Passing non-ASCII (Chinese) arguments to powershell.exe via -File is unreliable —— in testing the arguments arrived empty,
 * 而快捷方式名恰好是中文。二进制解析不涉及任何参数传递，稳定且无需启动额外进程。
 * and the shortcut name happens to be Chinese. Binary parsing involves no argument passing, is stable, and needs no extra process.
 *
 * .lnk 结构（简化）：
 * .lnk structure (simplified):
 *   0..75    ShellLinkHeader（20 处为 LinkFlags）
 *   0..75    ShellLinkHeader (offset 20 holds LinkFlags)
 *   之后     若 HasLinkTargetIDList，是 IDList（前 2 字节为总长度，含对齐填充）
 *   then     if HasLinkTargetIDList, an IDList (first 2 bytes are the total length, including alignment padding)
 *   之后     若 HasLinkInfo，是 LinkInfo
 *   then     if HasLinkInfo, a LinkInfo
 *   之后     为 StringData（UTF-16LE），Arguments / IconLocation 等都在这里
 *   then     StringData (UTF-16LE), where Arguments / IconLocation etc. live
 *
 * 结论：逐字段解析 LinkInfo 偏移既繁琐又容易因对齐规则出错（实测在含 IDList 时
 * Conclusion: parsing LinkInfo offsets field by field is tedious and error-prone due to alignment rules (in testing, when an IDList was present we could not
 * 拿不到 LocalBasePath）。因此判定改为**按字节搜索**已知字符串 —— 目标路径在文件里
 * obtain LocalBasePath). So the check was changed to **byte-search** for known strings —— the target path always
 * 一定以完整形式存在（ANSI 或 UTF-16LE），命中即可确认，无需关心内部布局。
 * exists in full form in the file (ANSI or UTF-16LE); a hit confirms it, with no need to care about the internal layout.
 */
import fs from "node:fs";

export const HDR = 76;

export function inspectLnk(file) {
  const b = fs.readFileSync(file);
  const flags = b.readUInt32LE(20);

  const hasTargetIdList = (flags & 0x0001) !== 0;
  const hasLinkInfo = (flags & 0x0002) !== 0;
  const hasIconLocation = (flags & 0x0040) !== 0;
  const isUnicode = (flags & 0x0080) !== 0;

  /* --- 尽力解析 LinkInfo.LocalBasePath（ANSI），失败也不影响判定 --- */
  /* --- Best-effort parse of LinkInfo.LocalBasePath (ANSI); failure does not affect the verdict --- */
  let localBasePath = "";
  if (hasLinkInfo) {
    let li = HDR;
    if (hasTargetIdList) {
      const idlSize = b.readUInt16LE(li);
      // IDList 长度含末尾 2 字节终止符，且后续结构需要 4 字节对齐
      // The IDList length includes the trailing 2-byte terminator, and later structures need 4-byte alignment
      li += idlSize + ((4 - (idlSize % 4)) % 4);
    }
    try {
      const liFlags = b.readUInt32LE(li + 8);
      if (liFlags & 0x0001) {                    // VolumeIDAndLocalBasePath
        const lbp = b.readUInt32LE(li + 16);
        let e = li + lbp;
        while (e < b.length && b[e] !== 0) e++;
        if (lbp > 0 && lbp < b.length) localBasePath = b.toString("latin1", li + lbp, e);
      }
    } catch { /* 解析失败时留空，由搜索法兜底 / On parse failure leave it empty; the search method is the fallback */ }
  }

  const ansi = (s) => b.includes(Buffer.from(s, "latin1"));
  const utf16 = (s) => b.includes(Buffer.from(s, "utf16le"));

  /* --- 抓 --window-size=W,H ---
   * --- Capture --window-size=W,H ---
   * 启动参数在 .lnk 里是 UTF-16LE 的字符串字段，但偏移随 IDList/LinkInfo 变长而变，
   * Launch arguments are UTF-16LE string fields in the .lnk, but their offset shifts as IDList/LinkInfo grow,
   * 逐字段定位易错。整块按 UTF-16LE 解码后正则匹配最省事，且不受对齐规则影响。
   * so field-by-field location is error-prone. Decoding the whole block as UTF-16LE and regex-matching is the simplest approach and is unaffected by alignment rules. */
  let windowSize = null;
  try {
    const text = b.toString("utf16le");
    const m = /--window-size=(\d+),(\d+)/.exec(text);
    if (m) windowSize = { w: Number(m[1]), h: Number(m[2]), raw: m[1] + "," + m[2] };
  } catch { /* 忽略 / Ignore */ }

  return {
    size: b.length,
    flags,
    hasTargetIdList,
    hasLinkInfo,
    hasIconLocation,
    isUnicode,
    localBasePath,
    windowSize,
    ansi,
    utf16,
    /** 两种编码任一命中即算存在 / A hit in either encoding counts as present */
    hasAny: (s) => ansi(s) || utf16(s),
    /**
     * StringData（Arguments/IconLocation/Description）是 UTF-16LE
     * StringData (Arguments/IconLocation/Description) is UTF-16LE
     */
    has: (s) => utf16(s),
  };
}
