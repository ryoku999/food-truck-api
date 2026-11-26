const thermalTicketDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Lima',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h12',
});

export function formatThermalTicketDate(date: Date): string {
  return thermalTicketDateFormatter
    .format(date)
    .replace(/[\u00a0\u202f]/g, ' ')
    .toUpperCase();
}
