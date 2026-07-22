export type CommunicationLog = {
  id: number;
  organization_id: number;
  channel: string;
  provider: string | null;
  recipient: string;
  subject: string | null;
  status: string;
  document_type: string | null;
  document_id: number | null;
  delivery_trigger: string | null;
  idempotency_key: string | null;
  external_message_id: string | null;
  error: string | null;
  created_at: string;
};
