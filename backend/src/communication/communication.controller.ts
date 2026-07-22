import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { SendDocumentDto } from './dto/send-document.dto';
import { SendTestEmailDto } from './email/dto/send-test-email.dto';
import { UpdateEmailSettingsDto } from './email/dto/update-email-settings.dto';

@Controller('communications')
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Get('email/settings')
  settings() {
    return this.communicationService.getEmailSettings();
  }

  @Patch('email/settings')
  updateSettings(@Body() body: UpdateEmailSettingsDto) {
    return this.communicationService.updateEmailSettings(body);
  }

  @Post('email/test-connection')
  testConnection() {
    return this.communicationService.testEmailConnection();
  }

  @Post('email/send-test')
  sendTest(@Body() body: SendTestEmailDto) {
    return this.communicationService.sendTestEmail(body);
  }

  @Post('send-document')
  sendDocument(@Body() body: SendDocumentDto) {
    return this.communicationService.sendDocument(body);
  }

  @Get('email/logs')
  logs(@Query('limit') limit?: string) {
    return this.communicationService.emailLogs(limit ? Number(limit) : undefined);
  }
}
