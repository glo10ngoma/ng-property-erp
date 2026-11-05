import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { SaasModule } from '../saas/saas.module';
import { InvoiceRegenerationService } from './invoice-regeneration.service';
import { InvoicesController } from './invoices.controller';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [DatabaseModule, EmailModule, forwardRef(() => SaasModule)],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePdfService, InvoiceRegenerationService],
  exports: [InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
