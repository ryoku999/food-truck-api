import { Module } from '@nestjs/common';
import { ModifierGroupsController } from './modifier-groups.controller';
import { ModifierOptionsController } from './modifier-options.controller';
import { ModifiersService } from './modifiers.service';

@Module({
  controllers: [ModifierGroupsController, ModifierOptionsController],
  providers: [ModifiersService],
  exports: [ModifiersService],
})
export class ModifiersModule {}
