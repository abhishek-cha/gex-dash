export interface GEXLevel {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  totalVolume: number;
  totalOI: number;
}

export function getExpirationDates(optionChain: any): string[] {
  const dates = new Set<string>();
  for (const map of [optionChain.callExpDateMap, optionChain.putExpDateMap]) {
    if (!map) continue;
    for (const key of Object.keys(map)) {
      dates.add(key.split(":")[0]);
    }
  }
  return [...dates].sort();
}

export function calculateGEX(
  optionChain: any,
  selectedExpirations?: Set<string>
): GEXLevel[] {
  const spotPrice =
    optionChain.underlyingPrice || optionChain.underlying?.last || 0;
  if (!spotPrice) return [];

  const shouldInclude = (expKey: string) => {
    if (!selectedExpirations) return true;
    return selectedExpirations.has(expKey.split(":")[0]);
  };

  const gexMap = new Map<
    number,
    { callGex: number; putGex: number; totalVolume: number; totalOI: number }
  >();

  const ensureStrike = (strike: number) => {
    if (!gexMap.has(strike))
      gexMap.set(strike, { callGex: 0, putGex: 0, totalVolume: 0, totalOI: 0 });
    return gexMap.get(strike)!;
  };

  if (optionChain.callExpDateMap) {
    for (const expDate of Object.keys(optionChain.callExpDateMap)) {
      if (!shouldInclude(expDate)) continue;
      const strikes = optionChain.callExpDateMap[expDate];
      for (const strikeStr of Object.keys(strikes)) {
        for (const contract of strikes[strikeStr]) {
          const strike = contract.strikePrice;
          const gamma = Math.abs(contract.gamma || 0);
          const oi = contract.openInterest || 0;
          const gex = gamma * oi * 100 * spotPrice;
          const entry = ensureStrike(strike);
          entry.callGex += gex;
          entry.totalVolume += contract.totalVolume || 0;
          entry.totalOI += oi;
        }
      }
    }
  }

  if (optionChain.putExpDateMap) {
    for (const expDate of Object.keys(optionChain.putExpDateMap)) {
      if (!shouldInclude(expDate)) continue;
      const strikes = optionChain.putExpDateMap[expDate];
      for (const strikeStr of Object.keys(strikes)) {
        for (const contract of strikes[strikeStr]) {
          const strike = contract.strikePrice;
          const gamma = Math.abs(contract.gamma || 0);
          const oi = contract.openInterest || 0;
          const gex = gamma * oi * 100 * spotPrice * -1;
          const entry = ensureStrike(strike);
          entry.putGex += gex;
          entry.totalVolume += contract.totalVolume || 0;
          entry.totalOI += oi;
        }
      }
    }
  }

  const levels: GEXLevel[] = [];
  for (const [strike, { callGex, putGex, totalVolume, totalOI }] of gexMap) {
    levels.push({
      strike,
      callGex,
      putGex,
      netGex: callGex + putGex,
      totalVolume,
      totalOI,
    });
  }

  levels.sort((a, b) => a.strike - b.strike);
  return levels;
}
