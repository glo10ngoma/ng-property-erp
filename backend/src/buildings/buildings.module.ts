import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BuildingsController } from './buildings.controller';
import { BuildingsService } from './buildings.service';

@Module({
  imports: [DatabaseModule],
  controllers: [BuildingsController],
  providers: [BuildingsService],
})
export class BuildingsModule {}
