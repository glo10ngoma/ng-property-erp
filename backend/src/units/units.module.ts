import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

@Module({
  imports: [DatabaseModule],
  controllers: [UnitsController],
  providers: [UnitsService],
})
export class UnitsModule {}
