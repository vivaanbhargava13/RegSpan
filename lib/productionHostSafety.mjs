import { BlockList, isIP } from "node:net";

const blockedIpv4 = new BlockList();
blockedIpv4.addAddress("0.0.0.0", "ipv4");
blockedIpv4.addSubnet("127.0.0.0", 8, "ipv4");

const blockedIpv6 = new BlockList();
blockedIpv6.addAddress("::", "ipv6");
blockedIpv6.addAddress("::1", "ipv6");

function mappedIpv4Address(address) {
  const match = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!match) return null;
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

export function isUnsafeProductionHostname(hostname) {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "host.docker.internal"
  ) {
    return true;
  }

  const family = isIP(normalized);
  if (family === 4) return blockedIpv4.check(normalized, "ipv4");
  if (family === 6) {
    const mappedIpv4 = mappedIpv4Address(normalized);
    return mappedIpv4
      ? blockedIpv4.check(mappedIpv4, "ipv4")
      : blockedIpv6.check(normalized, "ipv6");
  }
  return false;
}
