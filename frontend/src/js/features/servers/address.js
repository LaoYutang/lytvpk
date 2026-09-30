export const DEFAULT_SERVER_PORT = 27015;

// 直连输入除纯地址外，还允许直接粘贴控制台命令或 Steam 链接
const CONNECT_PREFIXES = [/^steam:\/\/connect\//iu, /^connect[\s:]+/iu];

// 剪贴板自动填入的判定规则：超长文本不当作服务器地址，域名后缀至少两个字母
const CLIPBOARD_INPUT_MAX_LENGTH = 128;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu;
const DOMAIN_TLD_PATTERN = /^[a-z]{2,}$/iu;

// parseServerInput 解析 IP 直连输入，兼容以下写法：
//   127.0.0.1、127.0.0.1:27015、[::1]:27015
//   connect 127.0.0.1:27015、steam://connect/127.0.0.1:27015
export function parseServerInput(rawInput) {
  let address = String(rawInput || "").trim();
  if (!address) {
    throw new Error("请输入服务器 IP 或域名");
  }

  for (const prefix of CONNECT_PREFIXES) {
    if (prefix.test(address)) {
      address = address.replace(prefix, "").trim();
      break;
    }
  }

  address = stripWrappingQuotes(address);
  if (isMissingHost(address)) {
    throw new Error("请输入服务器 IP 或域名");
  }
  return normalizeServerAddress(address);
}

// 只写了 connect 而没写地址时，提示用户补全而不是拿它当主机名
function isMissingHost(address) {
  return !address || /^connect$/iu.test(address);
}

function stripWrappingQuotes(value) {
  return value.replace(/^["'](.*)["']$/su, "$1").trim();
}

export function normalizeServerAddress(rawAddress) {
  const address = String(rawAddress || "").trim();
  if (!address) {
    throw new Error("请输入服务器地址");
  }
  if (/[\s/?#\\]/u.test(address)) {
    throw new Error("服务器地址格式无效");
  }

  if (address.startsWith("[")) {
    return normalizeBracketedIPv6(address);
  }
  if (address.includes("[") || address.includes("]")) {
    throw new Error("IPv6 服务器地址格式无效");
  }

  const colonCount = (address.match(/:/g) || []).length;
  if (colonCount === 0) {
    validateHost(address);
    return `${address}:${DEFAULT_SERVER_PORT}`;
  }
  if (colonCount === 1) {
    const separatorIndex = address.indexOf(":");
    const host = address.slice(0, separatorIndex);
    const port = address.slice(separatorIndex + 1);
    validateHost(host);
    return `${host}:${normalizePort(port)}`;
  }

  if (!isValidIPv6Host(address)) {
    throw new Error("IPv6 服务器地址格式无效");
  }
  return `[${address}]:${DEFAULT_SERVER_PORT}`;
}

function normalizeBracketedIPv6(address) {
  const closingBracket = address.indexOf("]");
  if (closingBracket < 0) {
    throw new Error("IPv6 服务器地址格式无效");
  }

  const host = address.slice(1, closingBracket);
  if (!isValidIPv6Host(host)) {
    throw new Error("IPv6 服务器地址格式无效");
  }

  const remainder = address.slice(closingBracket + 1);
  if (!remainder) {
    return `[${host}]:${DEFAULT_SERVER_PORT}`;
  }
  if (!remainder.startsWith(":") || remainder.slice(1).includes(":")) {
    throw new Error("IPv6 服务器地址格式无效");
  }
  return `[${host}]:${normalizePort(remainder.slice(1))}`;
}

function normalizePort(portText) {
  if (!portText) return DEFAULT_SERVER_PORT;
  if (!/^\d+$/u.test(portText)) {
    throw new Error("服务器端口必须是 1–65535 之间的数字");
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("服务器端口必须是 1–65535 之间的数字");
  }
  return port;
}

function validateHost(host) {
  if (!host || /[:%]/u.test(host)) {
    throw new Error("服务器地址格式无效");
  }
}

function isValidIPv6Host(host) {
  let ip = host;
  const zoneIndex = host.lastIndexOf("%");
  if (zoneIndex >= 0) {
    const zone = host.slice(zoneIndex + 1);
    if (!zone || !/^[\w.-]+$/u.test(zone)) return false;
    ip = host.slice(0, zoneIndex);
  }

  try {
    const parsed = new URL(`http://[${ip}]/`);
    return parsed.hostname.startsWith("[") && ip.includes(":");
  } catch {
    return false;
  }
}

// parseClipboardAddress 判断剪贴板文本能否自动填入直连输入框。
// 比 parseServerInput 更严格：没有 connect/steam 前缀时，只有文本本身
// 看起来就是地址（IPv4/IPv6/localhost/含点域名）才接受，
// 避免把随手复制的普通文字当成主机名。返回规范化地址，不接受时返回 null。
export function parseClipboardAddress(rawText) {
  const text = String(rawText ?? "").trim();
  if (
    !text ||
    text.length > CLIPBOARD_INPUT_MAX_LENGTH ||
    /[\r\n]/u.test(text)
  ) {
    return null;
  }

  const candidate = stripWrappingQuotes(text);
  if (!hasConnectPrefix(candidate) && !looksLikeAddress(candidate)) {
    return null;
  }

  try {
    return parseServerInput(candidate);
  } catch {
    return null;
  }
}

function hasConnectPrefix(value) {
  return CONNECT_PREFIXES.some((prefix) => prefix.test(value));
}

function looksLikeAddress(address) {
  const host = extractHost(address);
  if (!host) return false;
  if (host.toLowerCase() === "localhost") return true;
  if (host.includes(":")) return isValidIPv6Host(host);
  if (IPV4_PATTERN.test(host)) return true;

  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!DOMAIN_TLD_PATTERN.test(labels[labels.length - 1])) return false;
  return labels.every((label) => DOMAIN_LABEL_PATTERN.test(label));
}

// 取出地址中的主机部分：[::1]:27015 取方括号内，example.com:27015 取冒号前，
// 多个冒号按裸 IPv6 处理
function extractHost(address) {
  if (address.startsWith("[")) {
    const closingBracket = address.indexOf("]");
    return closingBracket > 1 ? address.slice(1, closingBracket) : "";
  }

  const colonCount = (address.match(/:/g) || []).length;
  if (colonCount === 0) return address;
  if (colonCount === 1) return address.slice(0, address.indexOf(":"));
  return address;
}
