export const COLORS = {
  bg:           0x0d1117,
  grid:         0x1b2028,
  gridStrong:   0x21262d,
  candleUp:     0x26a69a,
  candleDown:   0xef5350,
  priceLine:    0x1f6feb,
  callGex:      0x4caf50,
  putGex:       0xf44336,
  netGex:       0x00bcd4,
  separator:    0x30363d,
};

export const LAYOUT = {
  marginTop: 30,
  marginBottom: 30,
  marginLeft: 8,
  priceAxisWidth: 60,
  gexSectionRatio: 0.22,
  netGexSectionRatio: 0.13,
  candleGap: 0.3,
};

export const FREQ_MAP = {
  '5m':  { frequencyType: 'minute',  frequency: '5' },
  '15m': { frequencyType: 'minute',  frequency: '15' },
  '30m': { frequencyType: 'minute',  frequency: '30' },
  '1D':  { frequencyType: 'daily',   frequency: '1' },
  '1W':  { frequencyType: 'weekly',  frequency: '1' },
  '1M':  { frequencyType: 'monthly', frequency: '1' },
};

export const RANGE_MAP = {
  '5D':  { periodType: 'day',   period: '5' },
  '1M':  { periodType: 'month', period: '1' },
  '3M':  { periodType: 'month', period: '3' },
  '6M':  { periodType: 'month', period: '6' },
  'YTD': { periodType: 'ytd',   period: '1' },
  '1Y':  { periodType: 'year',  period: '1' },
  '2Y':  { periodType: 'year',  period: '2' },
  '5Y':  { periodType: 'year',  period: '5' },
  '10Y': { periodType: 'year',  period: '10' },
  '20Y': { periodType: 'year',  period: '20' },
};
