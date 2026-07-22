import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CommunicationModule } from '../communication/communication.module';
import { EmailModule } from '../email/email.module';
import { SaasModule } from '../saas/saas.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

@Module({
  imports: [DatabaseModule, forwardRef(() => SaasModule), EmailModule, CommunicationModule],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
