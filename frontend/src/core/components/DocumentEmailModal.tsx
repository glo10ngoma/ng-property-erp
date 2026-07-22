import { FormEvent, useEffect, useState } from 'react';
import { Modal } from './Modal';

type Props = {
  title: string;
  open: boolean;
  defaultRecipient?: string;
  defaultSubject: string;
  defaultMessage: string;
  attachmentName: string;
  sending?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (payload: { recipient: string; cc: string; subject: string; message: string }) => Promise<void> | void;
};

export function DocumentEmailModal({
  title,
  open,
  defaultRecipient,
  defaultSubject,
  defaultMessage,
  attachmentName,
  sending = false,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [recipient, setRecipient] = useState(defaultRecipient ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);

  useEffect(() => {
    if (!open) return;
    setRecipient(defaultRecipient ?? '');
    setCc('');
    setSubject(defaultSubject);
    setMessage(defaultMessage);
  }, [open, defaultRecipient, defaultSubject, defaultMessage]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({ recipient, cc, subject, message });
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary" onClick={onClose} disabled={sending}>Annuler</button>
          <button type="submit" form="document-email-form" disabled={sending}>{sending ? 'Envoi...' : 'Envoyer'}</button>
        </>
      )}
    >
      <form id="document-email-form" className="form-grid document-email-form" onSubmit={(event) => void submit(event)}>
        <label className="full">
          <span>À</span>
          <input type="email" required value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="destinataire@exemple.com" />
        </label>
        <label className="full">
          <span>CC</span>
          <input value={cc} onChange={(event) => setCc(event.target.value)} placeholder="copie@exemple.com; autre@exemple.com" />
        </label>
        <label className="full">
          <span>Objet</span>
          <input required value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <label className="full">
          <span>Message</span>
          <textarea rows={6} required value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
        <label className="full">
          <span>Pièce jointe</span>
          <input readOnly value={attachmentName} />
        </label>
        {error ? <div className="error-message full">{error}</div> : null}
      </form>
    </Modal>
  );
}
