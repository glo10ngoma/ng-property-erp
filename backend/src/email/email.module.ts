import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmailService } from './email.service';

@Module({
  imports: [DatabaseModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
