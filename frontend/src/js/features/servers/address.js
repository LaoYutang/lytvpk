export const DEFAULT_SERVER_PORT = 27015;

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
