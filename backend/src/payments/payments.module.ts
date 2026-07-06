import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SaasModule } from '../saas/saas.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [DatabaseModule, InvoicesModule, SaasModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
