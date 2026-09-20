import { PrismaClient } from '@/generated/prisma/client';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    this.logger.log('Conectando a la base de datos...');
    await this.$connect();
    this.logger.log('Conexión establecida con éxito.');
  }

  async onModuleDestroy() {
    this.logger.warn('Cerrando conexiones de base de datos...');
    await this.$disconnect();
    await this.pool.end();
    this.logger.log('Pool y cliente desconectados correctamente.');
  }
}
