import { Module } from '@nestjs/common';
import { DiningAreasController } from './dining-areas.controller';
import { DiningAreasService } from './dining-areas.service';

@Module({
  controllers: [DiningAreasController],
  providers: [DiningAreasService],
})
export class DiningAreasModule {}
