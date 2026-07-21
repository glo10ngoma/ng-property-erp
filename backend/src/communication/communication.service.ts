import { Injectable } from '@nestjs/common';
import { SendTestEmailDto } from './email/dto/send-test-email.dto';
import { UpdateEmailSettingsDto } from './email/dto/update-email-settings.dto';
import { EmailService } from './email/email.service';

@Injectable()
export class CommunicationService {
  constructor(private readonly emailService: EmailService) {}

  getEmailSettings() {
    return this.emailService.getSettings();
  }

  updateEmailSettings(dto: UpdateEmailSettingsDto) {
    return this.emailService.updateSettings(dto);
  }

  testEmailConnection() {
    return this.emailService.testConnection();
  }

  sendTestEmail(dto: SendTestEmailDto) {
    return this.emailService.sendTestEmail(dto);
  }

  emailLogs(limit?: number) {
    return this.emailService.listLogs(limit);
  }
}
