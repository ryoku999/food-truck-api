import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envSchema } from './config/env.config';
import { AuthModule } from './modules/auth/auth.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { UsersModule } from './modules/users/users.module';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { BusinessModule } from './modules/business/business.module';
import { FilesModule } from './modules/files/files.module';
import { ProductionAreasModule } from './modules/production-areas/production-areas.module';
import { DiningAreasModule } from './modules/dining-areas/dining-areas.module';
import { TablesModule } from './modules/tables/tables.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ModifiersModule } from './modules/modifiers/modifiers.module';
import { ProductsModule } from './modules/products/products.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProductionQueueModule } from './modules/production-queue/production-queue.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CashRegistersModule } from './modules/cash-registers/cash-registers.module';
import { PrintingModule } from './modules/printing/printing.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validationSchema: envSchema,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.getOrThrow<number>('RATE_LIMIT_TTL'),
          limit: configService.getOrThrow<number>('RATE_LIMIT_LIMIT'),
        },
      ],
    }),
    DatabaseModule,
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    BusinessModule,
    FilesModule,
    ProductionAreasModule,
    DiningAreasModule,
    TablesModule,
    CategoriesModule,
    ModifiersModule,
    ProductsModule,
    PaymentMethodsModule,
    OrdersModule,
    ProductionQueueModule,
    RealtimeModule,
    PaymentsModule,
    CashRegistersModule,
    PrintingModule,
    AuditLogsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
