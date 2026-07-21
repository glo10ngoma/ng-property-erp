export type CommunicationLog = {
  id: number;
  organization_id: number;
  channel: string;
  provider: string | null;
  recipient: string;
  subject: string | null;
  status: string;
  external_message_id: string | null;
  error: string | null;
  created_at: string;
};
