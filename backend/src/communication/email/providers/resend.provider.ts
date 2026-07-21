import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  EmailProvider,
  EmailProviderConnectionInput,
  EmailProviderConnectionResult,
  EmailProviderSendInput,
  EmailProviderSendResult,
  EmailProviderTemplateInput,
} from './email-provider';

function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '');
}

@Injectable()
export class ResendProvider implements EmailProvider {
  private readonly baseUrl = 'https://api.resend.com';

  async send(input: EmailProviderSendInput): Promise<EmailProviderSendResult> {
    const from = input.fromName?.trim()
      ? `${input.fromName.trim()} <${input.fromEmail}>`
      : input.fromEmail;

    const response = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? undefined,
        reply_to: input.replyTo ?? undefined,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : 'Resend email request failed';
      throw new BadGatewayException({
        code: 'RESEND_SEND_FAILED',
        message,
        status: response.status,
      });
    }

    return {
      provider: 'RESEND',
      externalMessageId: typeof payload?.id === 'string' ? payload.id : null,
    };
  }

  async sendTemplate(input: EmailProviderTemplateInput): Promise<EmailProviderSendResult> {
    return this.send({
      ...input,
      html: renderTemplate(input.htmlTemplate, input.variables),
      text: input.textTemplate ? renderTemplate(input.textTemplate, input.variables) : null,
    });
  }

  async testConnection(input: EmailProviderConnectionInput): Promise<EmailProviderConnectionResult> {
    const response = await fetch(`${this.baseUrl}/domains`, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : 'Unable to validate Resend API key';
      return {
        provider: 'RESEND',
        success: false,
        message,
      };
    }

    return {
      provider: 'RESEND',
      success: true,
      message: 'Connexion Resend valide.',
    };
  }
}
