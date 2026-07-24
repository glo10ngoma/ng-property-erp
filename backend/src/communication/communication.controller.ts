import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
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
  logs(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
    @Query('trigger') trigger?: string,
    @Query('documentType') documentType?: string,
    @Query('recipient') recipient?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.communicationService.emailLogs({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      status,
      trigger,
      documentType,
      recipient,
      search,
      from,
      to,
    });
  }

  @Get('email/logs/:id')
  log(@Param('id', ParseIntPipe) id: number) {
    return this.communicationService.emailLog(id);
  }
}
