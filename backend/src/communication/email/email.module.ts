import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { EmailService } from './email.service';
import { ResendProvider } from './providers/resend.provider';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [EmailService, ResendProvider],
  exports: [EmailService],
})
export class EmailModule {}
