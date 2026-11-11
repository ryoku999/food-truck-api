export function orderRoundNumbers(
  items: ReadonlyArray<{ orderId: string; sentAt: Date | null }>,
): Map<string, number> {
  const sent = items
    .filter(
      (item): item is { orderId: string; sentAt: Date } => item.sentAt !== null,
    )
    .sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());
  const counts = new Map<string, number>();
  const rounds = new Map<string, number>();
  for (const item of sent) {
    const key = `${item.orderId}:${item.sentAt.toISOString()}`;
    if (rounds.has(key)) continue;
    const round = (counts.get(item.orderId) ?? 0) + 1;
    counts.set(item.orderId, round);
    rounds.set(key, round);
  }
  return rounds;
}
