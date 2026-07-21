import { Module } from '@nestjs/common';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';
import { EmailModule } from './email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [CommunicationController],
  providers: [CommunicationService],
})
export class CommunicationModule {}
