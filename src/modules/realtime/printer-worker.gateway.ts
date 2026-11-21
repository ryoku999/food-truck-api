import { DatabaseService } from '@/database/database.service';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createHash } from 'node:crypto';
import type { Namespace, Socket } from 'socket.io';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@WebSocketGateway({ namespace: '/printer-worker' })
export class PrinterWorkerGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
      client.disconnect(true);
      return;
    }
    const agents = await this.db.printerAgent.updateManyAndReturn({
      where: { tokenHash: hash(token), active: true },
      data: { lastSeenAt: new Date() },
      select: { id: true },
    });
    if (!agents.length) {
      client.disconnect(true);
      return;
    }
    const agentId = agents[0].id;
    await client.join(`agent:${agentId}`);
    const heartbeat = setInterval(() => {
      void this.db.printerAgent.update({
        where: { id: agentId },
        data: { lastSeenAt: new Date() },
      });
    }, 10_000);
    client.once('disconnect', () => {
      clearInterval(heartbeat);
    });
    client.emit('printer-worker.ready', {
      occurredAt: new Date().toISOString(),
      data: { agentId },
    });
  }

  notifyAll(): void {
    if (!this.server) return;
    this.server.emit('printer.jobs.available', {
      occurredAt: new Date().toISOString(),
    });
  }
}
