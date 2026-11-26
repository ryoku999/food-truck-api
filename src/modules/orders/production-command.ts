import type { Prisma } from '@/generated/prisma/client';
import {
  OrderItemStatus,
  PrintJobType,
  ProductionAreaCode,
} from '@/generated/prisma/enums';
import { z } from 'zod';

export const commandTypeByArea = {
  KITCHEN: PrintJobType.KITCHEN_COMMAND,
  BAR: PrintJobType.BAR_COMMAND,
} as const;
export const productionCommandTypes = Object.values(commandTypeByArea);
export type CommandArea = keyof typeof commandTypeByArea;

export const commandAreaLabel: Record<CommandArea, string> = {
  KITCHEN: 'COCINA',
  BAR: 'BARRA',
};

const commandItemSchema = z.object({
  orderItemId: z.string(),
  quantity: z.number().int().positive(),
  heading: z.string(),
  details: z.array(z.string()),
});
type CommandItem = z.infer<typeof commandItemSchema>;

const commandPayloadSchema = z.object({
  productionArea: z.enum(['KITCHEN', 'BAR']),
  orderNumber: z.number(),
  roundNumber: z.number().nullable(),
  sentAt: z.string(),
  header: z.array(z.string()),
  headerLines: z.number().int().optional(),
  commandItems: z.array(commandItemSchema),
});

export function renderCommand(payload: z.infer<typeof commandPayloadSchema>) {
  return {
    ...payload,
    lines: [
      ...payload.header,
      ...payload.commandItems.flatMap(({ quantity, heading, details }) => [
        `${quantity} x ${heading}`,
        ...details.map((detail) => `  ${detail}`),
      ]),
    ],
  };
}

interface PrintableItem {
  id: string;
  quantity: number;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  productionArea: ProductionAreaCode;
  notes: string | null;
  modifiers: {
    groupNameSnapshot: string;
    optionNameSnapshot: string;
    quantity: number;
  }[];
  comboSelections: {
    comboGroupItemId: string | null;
    groupNameSnapshot: string;
    productNameSnapshot: string;
  }[];
}

export function groupCommandItems(
  items: PrintableItem[],
  componentAreas: ReadonlyMap<string, ProductionAreaCode>,
) {
  const groups = { KITCHEN: [] as CommandItem[], BAR: [] as CommandItem[] };
  for (const item of items) {
    const primaryArea = item.productionArea;
    const components = item.comboSelections.map((component) => ({
      ...component,
      area: componentAreas.get(component.comboGroupItemId ?? '') ?? primaryArea,
    }));
    const heading = [item.productNameSnapshot, item.variantNameSnapshot]
      .filter(Boolean)
      .join(' · ');
    for (const area of ['KITCHEN', 'BAR'] as const) {
      const primary = area === primaryArea;
      const options = components.filter(
        (component) =>
          component.area === area || (primary && component.area === 'NONE'),
      );
      if (!primary && options.length === 0) continue;
      groups[area].push({
        orderItemId: item.id,
        quantity: item.quantity,
        heading: primary ? heading : `Componentes de ${heading}`,
        details: [
          ...(primary
            ? item.modifiers.map(
                (option) =>
                  `${option.groupNameSnapshot}: ${option.quantity > 1 ? `${option.quantity} x ` : ''}${option.optionNameSnapshot}`,
              )
            : []),
          ...options.map(
            (option) =>
              `${option.groupNameSnapshot}: ${option.productNameSnapshot}`,
          ),
          ...(item.notes ? [`Nota: ${item.notes}`] : []),
        ],
      });
    }
  }
  return groups;
}

export const commandContentsSelect = {
  id: true,
  type: true,
  payload: true,
  order: { select: { number: true } },
  items: {
    select: {
      orderItem: {
        select: {
          id: true,
          quantity: true,
          status: true,
          productNameSnapshot: true,
          notes: true,
        },
      },
    },
  },
} satisfies Prisma.PrintJobSelect;

export function currentCommandPayload(
  job: Prisma.PrintJobGetPayload<{ select: typeof commandContentsSelect }>,
) {
  const remaining = new Map(
    job.items.flatMap(({ orderItem }) =>
      orderItem.status === OrderItemStatus.CANCELLED
        ? []
        : [[orderItem.id, orderItem] as const],
    ),
  );
  if (!remaining.size) return;

  const parsed = commandPayloadSchema.safeParse(job.payload);
  if (parsed.success) {
    const commandItems = parsed.data.commandItems.flatMap((item) => {
      const current = remaining.get(item.orderItemId);
      return current ? [{ ...item, quantity: current.quantity }] : [];
    });
    if (commandItems.length)
      return renderCommand({ ...parsed.data, commandItems });
    return;
  }

  // Jobs created by the previous release only stored rendered lines.
  const data =
    job.payload &&
    typeof job.payload === 'object' &&
    !Array.isArray(job.payload)
      ? job.payload
      : {};
  const area = job.type === commandTypeByArea.BAR ? 'BAR' : 'KITCHEN';
  const orderNumber = job.order?.number ?? 0;
  const oldHeader = Array.isArray(data.lines)
    ? data.lines
        .slice(0, 3)
        .filter((line): line is string => typeof line === 'string')
    : [];
  return renderCommand({
    productionArea: area,
    orderNumber,
    roundNumber: typeof data.roundNumber === 'number' ? data.roundNumber : null,
    sentAt: typeof data.sentAt === 'string' ? data.sentAt : '',
    header: oldHeader.length
      ? oldHeader
      : [`${commandAreaLabel[area]} | Pedido #${orderNumber}`],
    commandItems: [...remaining.values()].map((item) => ({
      orderItemId: item.id,
      quantity: item.quantity,
      heading: item.productNameSnapshot,
      details: item.notes ? [item.notes] : [],
    })),
  });
}
