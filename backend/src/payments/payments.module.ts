import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CommunicationModule } from '../communication/communication.module';
import { EmailModule } from '../email/email.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SaasModule } from '../saas/saas.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [DatabaseModule, InvoicesModule, SaasModule, EmailModule, CommunicationModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
