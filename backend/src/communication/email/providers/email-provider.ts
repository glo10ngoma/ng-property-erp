export type EmailProviderSendInput = {
  apiKey: string;
  fromEmail: string;
  fromName?: string | null;
  replyTo?: string | null;
  to: string;
  subject: string;
  html: string;
  text?: string | null;
};

export type EmailProviderSendResult = {
  provider: string;
  externalMessageId: string | null;
};

export type EmailProviderTemplateInput = Omit<EmailProviderSendInput, 'html' | 'text'> & {
  htmlTemplate: string;
  textTemplate?: string | null;
  variables: Record<string, string>;
};

export type EmailProviderConnectionInput = {
  apiKey: string;
};

export type EmailProviderConnectionResult = {
  provider: string;
  success: boolean;
  message: string;
};

export interface EmailProvider {
  send(input: EmailProviderSendInput): Promise<EmailProviderSendResult>;
  sendTemplate(input: EmailProviderTemplateInput): Promise<EmailProviderSendResult>;
  testConnection(input: EmailProviderConnectionInput): Promise<EmailProviderConnectionResult>;
}
