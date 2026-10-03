import { Module } from '@nestjs/common';
import { ProductionAreasController } from './production-areas.controller';
import { ProductionAreasService } from './production-areas.service';

@Module({
  controllers: [ProductionAreasController],
  providers: [ProductionAreasService],
})
export class ProductionAreasModule {}
