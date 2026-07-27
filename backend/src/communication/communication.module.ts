import { forwardRef, Module } from '@nestjs/common';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';
import { DocumentResolverService } from './document-resolver.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from './email/email.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [DatabaseModule, EmailModule, forwardRef(() => InvoicesModule)],
  controllers: [CommunicationController],
  providers: [CommunicationService, DocumentResolverService],
  exports: [CommunicationService],
})
export class CommunicationModule {}
