import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { SendTestEmailDto } from './email/dto/send-test-email.dto';
import { UpdateEmailSettingsDto } from './email/dto/update-email-settings.dto';

@Controller('communications/email')
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Get('settings')
  settings() {
    return this.communicationService.getEmailSettings();
  }

  @Patch('settings')
  updateSettings(@Body() body: UpdateEmailSettingsDto) {
    return this.communicationService.updateEmailSettings(body);
  }

  @Post('test-connection')
  testConnection() {
    return this.communicationService.testEmailConnection();
  }

  @Post('send-test')
  sendTest(@Body() body: SendTestEmailDto) {
    return this.communicationService.sendTestEmail(body);
  }

  @Get('logs')
  logs(@Query('limit') limit?: string) {
    return this.communicationService.emailLogs(limit ? Number(limit) : undefined);
  }
}
