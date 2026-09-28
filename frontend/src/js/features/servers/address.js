export const DEFAULT_SERVER_PORT = 27015;

// 直连输入除纯地址外，还允许直接粘贴控制台命令或 Steam 链接
const CONNECT_PREFIXES = [/^steam:\/\/connect\//iu, /^connect[\s:]+/iu];

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
