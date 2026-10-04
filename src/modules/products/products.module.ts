import { FilesModule } from '@/modules/files/files.module';
import { Module } from '@nestjs/common';
import { ComboGroupsController } from './combos.controller';
import { ProductVariantsController } from './product-variants.controller';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [FilesModule],
  controllers: [
    ProductsController,
    ProductVariantsController,
    ComboGroupsController,
  ],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
