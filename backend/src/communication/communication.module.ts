import { Module } from '@nestjs/common';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';
import { DocumentResolverService } from './document-resolver.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [CommunicationController],
  providers: [CommunicationService, DocumentResolverService],
  exports: [CommunicationService],
})
export class CommunicationModule {}
